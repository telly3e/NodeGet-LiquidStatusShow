import { useEffect, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool, PoolEntry } from '../api/pool'
import type { TaskQueryCondition, TaskQueryResult } from '../types'

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000
const FAST_REFRESH_MS = 10_000
const SLOW_REFRESH_MS = 60_000
const LONG_REFRESH_MS = 5 * 60_000
const REFRESH_FLOOR_MS = 30_000
const INCREMENTAL_OVERLAP_MS = 2 * 60 * 1000
const ACC_CAP = 50_000
const QUERY_TIMEOUT_MS = 20_000
const RAW_QUERY_CONCURRENCY = 2
const AGGREGATE_QUERY_CONCURRENCY = 4

interface NodeLatencyOptions {
  aggregateRoute?: string
  cacheTtlMs?: number
  cronSource?: string
  includePing?: boolean
  includeTcp?: boolean
  limit?: number
  refreshMs?: number
}

interface AccEntry {
  pingRows: TaskQueryResult[]
  tcpRows: TaskQueryResult[]
  lastFetchAt: number
}

export type AggregateRequestPayload = Record<string, string | number | boolean | null | undefined>

const store = new Map<string, AccEntry>()
const inFlight = new Map<string, Promise<AccEntry>>()
const rawQueue: Array<() => void> = []
const aggregateQueue: Array<() => void> = []
let activeRawQueries = 0
let activeAggregateQueries = 0

function runNextRawQuery() {
  if (activeRawQueries >= RAW_QUERY_CONCURRENCY) return
  const next = rawQueue.shift()
  if (!next) return
  activeRawQueries += 1
  next()
}

function scheduleRawQuery<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    rawQueue.push(() => {
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeRawQueries -= 1
          runNextRawQuery()
        })
    })
    runNextRawQuery()
  })
}

function runNextAggregateQuery() {
  if (activeAggregateQueries >= AGGREGATE_QUERY_CONCURRENCY) return
  const next = aggregateQueue.shift()
  if (!next) return
  activeAggregateQueries += 1
  next()
}

function scheduleAggregateQuery<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    aggregateQueue.push(() => {
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeAggregateQueries -= 1
          runNextAggregateQuery()
        })
    })
    runNextAggregateQuery()
  })
}

function tsMs(timestamp: number) {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

function clean(rows: TaskQueryResult[] | undefined): TaskQueryResult[] {
  return (rows ?? [])
    .filter(row => row.cron_source && row.cron_source !== '未知')
    .sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp))
}

function rowKey(row: TaskQueryResult) {
  return row.task_id != null
    ? `i${row.task_id}`
    : `${tsMs(row.timestamp)}|${row.cron_source ?? ''}|${row.success}`
}

function mergePrune(prev: TaskQueryResult[], incoming: TaskQueryResult[], cutoff: number) {
  const map = new Map<string, TaskQueryResult>()
  for (const row of prev) map.set(rowKey(row), row)
  for (const row of clean(incoming)) map.set(rowKey(row), row)

  let rows = [...map.values()].filter(row => tsMs(row.timestamp) >= cutoff)
  rows.sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp))
  if (rows.length > ACC_CAP) rows = rows.slice(rows.length - ACC_CAP)
  return rows
}

function latestTs(rows: TaskQueryResult[]) {
  let max = 0
  for (const row of rows) {
    const current = tsMs(row.timestamp)
    if (current > max) max = current
  }
  return max
}

function refreshInterval(windowMs: number) {
  if (windowMs > 24 * 60 * 60 * 1000) return LONG_REFRESH_MS
  if (windowMs > 60 * 60 * 1000) return SLOW_REFRESH_MS
  return FAST_REFRESH_MS
}

function latencyRowLimit(windowMs: number) {
  if (windowMs <= 60 * 60 * 1000) return 4_000
  if (windowMs <= 6 * 60 * 60 * 1000) return 24_000
  if (windowMs <= 24 * 60 * 60 * 1000) return 40_000
  return 60_000
}

export function resolveAggregateEndpoint(backendUrl: string, route: string) {
  const trimmed = route.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed

  const base = new URL(backendUrl)
  base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:'
  base.search = ''
  base.hash = ''
  base.pathname = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return base.toString()
}

function normalizeTaskRow(value: unknown): TaskQueryResult | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const timestamp = Number(row.timestamp)
  const uuid = typeof row.uuid === 'string' ? row.uuid : ''
  const cronSource = typeof row.cron_source === 'string' ? row.cron_source : ''
  const success = Boolean(row.success)

  if (!Number.isFinite(timestamp) || !uuid || !cronSource) return null

  return {
    task_id: Number.isFinite(Number(row.task_id)) ? Number(row.task_id) : 0,
    timestamp,
    uuid,
    success,
    error_message: typeof row.error_message === 'string' ? row.error_message : null,
    cron_source: cronSource,
    task_event_type:
      row.task_event_type && typeof row.task_event_type === 'object'
        ? (row.task_event_type as Record<string, string>)
        : undefined,
    task_event_result:
      row.task_event_result && typeof row.task_event_result === 'object'
        ? (row.task_event_result as Record<string, unknown>)
        : null,
  }
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
      method: init?.method,
      body: init?.body,
      mode: 'cors',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`aggregate route ${response.status}`)
    }
    return response.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function postAggregateRequest(
  endpoint: string,
  payload: AggregateRequestPayload,
  timeoutMs = QUERY_TIMEOUT_MS,
) {
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries(payload)) {
    if (value == null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  return scheduleAggregateQuery(() =>
    fetchJsonWithTimeout(url.toString(), timeoutMs, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

async function fetchAggregatedRows(
  entry: PoolEntry,
  route: string,
  uuid: string,
  type: 'tcp_ping' | 'ping',
  cutoff: number,
  now: number,
  cronSource: string | undefined,
) {
  const endpoint = resolveAggregateEndpoint(entry.backendUrl, route)
  if (!endpoint) return null

  const payload = await postAggregateRequest(endpoint, {
    uuid,
    type,
    from: cutoff,
    to: now,
    cron_source: cronSource ?? '',
  })
  const rows =
    Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { rows?: unknown[] })?.rows)
        ? (payload as { rows: unknown[] }).rows
        : []

  return clean(rows.map(normalizeTaskRow).filter((row): row is TaskQueryResult => row != null))
}

export function useNodeLatency(
  pool: BackendPool | null,
  source: string | null,
  uuid: string | null,
  windowMs = DEFAULT_WINDOW_MS,
  options: NodeLatencyOptions = {},
) {
  const [pingData, setPingData] = useState<TaskQueryResult[]>([])
  const [tcpData, setTcpData] = useState<TaskQueryResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!pool || !source || !uuid) {
      setPingData([])
      setTcpData([])
      setLoading(false)
      return
    }

    const entry = pool.entries.find(item => item.name === source)
    if (!entry) {
      setPingData([])
      setTcpData([])
      setLoading(false)
      return
    }

    let cancelled = false
    const includeTcp = options.includeTcp !== false
    const includePing = options.includePing !== false
    const limit = options.limit ?? latencyRowLimit(windowMs)
    const refreshMs = options.refreshMs ?? refreshInterval(windowMs)
    const floorMs = options.cacheTtlMs ?? REFRESH_FLOOR_MS
    const cronSource = options.cronSource?.trim()
    const cronSourceFilter: TaskQueryCondition[] = cronSource ? [{ cron_source: cronSource }] : []
    const aggregateRoute = options.aggregateRoute?.trim()
    const skey = [
      source,
      uuid,
      windowMs,
      cronSource ?? '',
      includeTcp ? 't' : '',
      includePing ? 'p' : '',
      aggregateRoute ?? '',
    ].join(':')

    const existing = store.get(skey)
    if (existing) {
      setPingData(existing.pingRows)
      setTcpData(existing.tcpRows)
    } else {
      setPingData([])
      setTcpData([])
      setLoading(true)
    }

    const fetchRawType = async (
      prev: TaskQueryResult[],
      type: 'tcp_ping' | 'ping',
      cutoff: number,
      now: number,
    ) => {
      const requestWindow: [number, number] = prev.length
        ? [Math.max(cutoff, latestTs(prev) - INCREMENTAL_OVERLAP_MS), now]
        : [cutoff, now]

      try {
        const fresh = await scheduleRawQuery(() =>
          taskQuery(
            entry.client,
            [{ uuid }, { type }, ...cronSourceFilter, { timestamp_from_to: requestWindow }, { limit }],
            QUERY_TIMEOUT_MS,
          ),
        )
        return mergePrune(prev, fresh, cutoff)
      } catch {
        return prev
      }
    }

    const fetchType = async (
      prev: TaskQueryResult[],
      type: 'tcp_ping' | 'ping',
      cutoff: number,
      now: number,
    ) => {
      if (aggregateRoute) {
        try {
          const rows = await fetchAggregatedRows(entry, aggregateRoute, uuid, type, cutoff, now, cronSource)
          if (rows) return rows
        } catch {}
      }
      return fetchRawType(prev, type, cutoff, now)
    }

    const fetchOnce = async () => {
      const now = Date.now()
      const acc0 = store.get(skey)
      if (acc0 && now - acc0.lastFetchAt < floorMs) {
        if (!cancelled) {
          setPingData(acc0.pingRows)
          setTcpData(acc0.tcpRows)
          setLoading(false)
        }
        return
      }

      let promise = inFlight.get(skey)
      if (!promise) {
        promise = (async () => {
          const acc = store.get(skey) ?? { pingRows: [], tcpRows: [], lastFetchAt: 0 }
          const cutoff = now - windowMs
          if (includeTcp) acc.tcpRows = await fetchType(acc.tcpRows, 'tcp_ping', cutoff, now)
          if (includePing) acc.pingRows = await fetchType(acc.pingRows, 'ping', cutoff, now)
          acc.lastFetchAt = Date.now()
          store.set(skey, acc)
          return acc
        })()
        inFlight.set(skey, promise)
        promise.finally(() => inFlight.delete(skey))
      }

      const acc = await promise
      if (cancelled) return
      setPingData(acc.pingRows)
      setTcpData(acc.tcpRows)
      setLoading(false)
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, refreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [
    pool,
    source,
    uuid,
    windowMs,
    options.aggregateRoute,
    options.cacheTtlMs,
    options.cronSource,
    options.includePing,
    options.includeTcp,
    options.limit,
    options.refreshMs,
  ])

  return { pingData, tcpData, loading }
}

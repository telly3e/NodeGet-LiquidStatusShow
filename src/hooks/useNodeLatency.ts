import { useEffect, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { TaskQueryResult } from '../types'

const DEFAULT_WINDOW_MS = 60 * 60 * 1000
const FAST_REFRESH_MS = 10_000
const SLOW_REFRESH_MS = 60_000
const LONG_REFRESH_MS = 5 * 60_000
const CACHE_TTL_MS = 60_000
const QUERY_TIMEOUT_MS = 20_000
const QUERY_CONCURRENCY = 2

interface NodeLatencyOptions {
  cacheTtlMs?: number
  cronSource?: string
  includePing?: boolean
  includeTcp?: boolean
  limit?: number
  refreshMs?: number
}

interface LatencyResult {
  pingData: TaskQueryResult[]
  tcpData: TaskQueryResult[]
}

interface CacheEntry extends LatencyResult {
  updatedAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<LatencyResult>>()
const queue: Array<() => void> = []
let activeQueries = 0

function runNextQuery() {
  if (activeQueries >= QUERY_CONCURRENCY) return
  const next = queue.shift()
  if (!next) return
  activeQueries += 1
  next()
}

function scheduleQuery<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => {
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeQueries -= 1
          runNextQuery()
        })
    })
    runNextQuery()
  })
}

function clean(rows: TaskQueryResult[] | undefined): TaskQueryResult[] {
  return (rows ?? [])
    .filter(r => r.cron_source && r.cron_source !== '未知')
    .sort((a, b) => a.timestamp - b.timestamp)
}

function refreshInterval(windowMs: number) {
  if (windowMs > 24 * 60 * 60 * 1000) return LONG_REFRESH_MS
  if (windowMs > DEFAULT_WINDOW_MS) return SLOW_REFRESH_MS
  return FAST_REFRESH_MS
}

function latencyRowLimit(windowMs: number) {
  if (windowMs <= 60 * 60 * 1000) return 4_000
  if (windowMs <= 6 * 60 * 60 * 1000) return 24_000
  if (windowMs <= 24 * 60 * 60 * 1000) return 40_000
  return 60_000
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
    const entry = pool.entries.find(e => e.name === source)
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
    const cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS
    const refreshMs = options.refreshMs ?? refreshInterval(windowMs)
    const cronSource = options.cronSource?.trim()
    const cronSourceFilter = cronSource ? [{ cron_source: cronSource }] : []
    const key = `${source}:${uuid}:${windowMs}:${limit}:${includeTcp ? 'tcp' : ''}:${includePing ? 'ping' : ''}:${refreshMs}:${cronSource ?? ''}`
    const cached = cache.get(key)
    const hasFreshCache = cached && Date.now() - cached.updatedAt < cacheTtlMs

    if (cached) {
      setPingData(cached.pingData)
      setTcpData(cached.tcpData)
    } else {
      setPingData([])
      setTcpData([])
    }

    const fetchOnce = async () => {
      const now = Date.now()
      const window: [number, number] = [now - windowMs, now]
      setLoading(true)

      let promise = inFlight.get(key)
      if (!promise) {
        promise = (async () => {
          let tcpData: TaskQueryResult[] = []
          let pingData: TaskQueryResult[] = []

          try {
            if (includeTcp) {
              tcpData = clean(
                await scheduleQuery(() =>
                  taskQuery(
                    entry.client,
                    [{ uuid }, { timestamp_from_to: window }, { type: 'tcp_ping' }, ...cronSourceFilter, { limit }],
                    QUERY_TIMEOUT_MS,
                  ),
                ),
              )
            }
          } catch {}

          try {
            if (includePing) {
              pingData = clean(
                await scheduleQuery(() =>
                  taskQuery(
                    entry.client,
                    [{ uuid }, { timestamp_from_to: window }, { type: 'ping' }, ...cronSourceFilter, { limit }],
                    QUERY_TIMEOUT_MS,
                  ),
                ),
              )
            }
          } catch {}

          return { pingData, tcpData }
        })()
        inFlight.set(key, promise)
        promise.finally(() => inFlight.delete(key))
      }

      const result = await promise

      if (cancelled) return
      cache.set(key, { ...result, updatedAt: Date.now() })
      setPingData(result.pingData)
      setTcpData(result.tcpData)
      setLoading(false)
    }

    if (!hasFreshCache) fetchOnce()
    else setLoading(false)
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
    options.cacheTtlMs,
    options.cronSource,
    options.includePing,
    options.includeTcp,
    options.limit,
    options.refreshMs,
  ])

  return { pingData, tcpData, loading }
}

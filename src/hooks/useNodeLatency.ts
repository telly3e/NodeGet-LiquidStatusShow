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

interface LatencyResult {
  pingData: TaskQueryResult[]
  tcpData: TaskQueryResult[]
}

interface CacheEntry extends LatencyResult {
  updatedAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<LatencyResult>>()

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
    const key = `${source}:${uuid}:${windowMs}`
    const cached = cache.get(key)
    const hasFreshCache = cached && Date.now() - cached.updatedAt < CACHE_TTL_MS

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
      const limit = latencyRowLimit(windowMs)
      setLoading(true)

      let promise = inFlight.get(key)
      if (!promise) {
        promise = (async () => {
          let tcpData: TaskQueryResult[] = []
          let pingData: TaskQueryResult[] = []

          try {
            tcpData = clean(
              await taskQuery(
                entry.client,
                [{ uuid }, { timestamp_from_to: window }, { type: 'tcp_ping' }, { limit }],
                QUERY_TIMEOUT_MS,
              ),
            )
          } catch {}

          try {
            pingData = clean(
              await taskQuery(
                entry.client,
                [{ uuid }, { timestamp_from_to: window }, { type: 'ping' }, { limit }],
                QUERY_TIMEOUT_MS,
              ),
            )
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
    const refreshMs = refreshInterval(windowMs)
    const timer = setInterval(fetchOnce, refreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pool, source, uuid, windowMs])

  return { pingData, tcpData, loading }
}

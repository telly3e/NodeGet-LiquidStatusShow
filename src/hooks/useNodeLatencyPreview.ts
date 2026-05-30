import { useEffect, useState } from 'react'
import type { BackendPool } from '../api/pool'
import { postAggregateRequest, resolveAggregateEndpoint } from './useNodeLatency'

const PREVIEW_TIMEOUT_MS = 20_000
const PREVIEW_REFRESH_MS = 60_000
const PREVIEW_FLOOR_MS = 45_000
const DEFAULT_SAMPLE_LIMIT = 18

export interface LatencyPreview {
  avg: number | null
  lossRate: number
  name: string
  samples: Array<number | null>
  type: 'tcp_ping' | 'ping'
}

interface PreviewEntry {
  data: LatencyPreview | null
  lastFetchAt: number
}

const store = new Map<string, PreviewEntry>()
const inFlight = new Map<string, Promise<PreviewEntry>>()

export function useNodeLatencyPreview(
  pool: BackendPool | null,
  source: string | null,
  uuid: string | null,
  windowMs: number,
  monitorName: string,
  aggregateRoute: string,
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
) {
  const [data, setData] = useState<LatencyPreview | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!pool || !source || !uuid || !monitorName.trim() || !aggregateRoute.trim()) {
      setData(null)
      setError(false)
      setLoading(false)
      return
    }

    const entry = pool.entries.find(item => item.name === source)
    if (!entry) {
      setData(null)
      setError(false)
      setLoading(false)
      return
    }

    const endpoint = resolveAggregateEndpoint(entry.backendUrl, aggregateRoute)
    if (!endpoint) {
      setData(null)
      setError(false)
      setLoading(false)
      return
    }

    let cancelled = false
    const name = monitorName.trim()
    const key = [source, uuid, windowMs, name, aggregateRoute, sampleLimit].join(':')
    const existing = store.get(key)

    if (existing) {
      setData(existing.data)
      setError(false)
      setLoading(false)
    } else {
      setData(null)
      setError(false)
      setLoading(true)
    }

    const fetchOnce = async () => {
      const now = Date.now()
      const cached = store.get(key)
      if (cached && now - cached.lastFetchAt < PREVIEW_FLOOR_MS) {
        if (!cancelled) {
          setData(cached.data)
          setLoading(false)
        }
        return
      }

      let promise = inFlight.get(key)
      if (!promise) {
        promise = (async () => {
          const payload = await postAggregateRequest(
            endpoint,
            {
              uuid,
              type: 'tcp_ping',
              from: now - windowMs,
              to: now,
              cron_source: name,
              preview: 1,
              sample_limit: sampleLimit,
            },
            PREVIEW_TIMEOUT_MS,
          )

          const preview = normalizePreview(payload, name)
          const next = { data: preview, lastFetchAt: Date.now() }
          store.set(key, next)
          return next
        })()
        inFlight.set(key, promise)
        promise.finally(() => inFlight.delete(key))
      }

      try {
        const result = await promise
        if (!cancelled) {
          setData(result.data)
          setError(false)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      }
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, PREVIEW_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [aggregateRoute, monitorName, pool, sampleLimit, source, uuid, windowMs])

  return { data, error, loading }
}

function normalizePreview(payload: unknown, fallbackName: string): LatencyPreview | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const source = typeof record.cron_source === 'string' ? record.cron_source : fallbackName
  const type = record.type === 'ping' ? 'ping' : 'tcp_ping'
  const avg = Number(record.avg)
  const lossRate = Number(record.loss_rate)
  const samples = Array.isArray(record.samples)
    ? record.samples.map(value => (typeof value === 'number' ? value : null))
    : []

  return {
    avg: Number.isFinite(avg) ? avg : null,
    lossRate: Number.isFinite(lossRate) ? lossRate : 0,
    name: source,
    samples,
    type,
  }
}

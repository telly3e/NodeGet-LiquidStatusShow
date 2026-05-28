import type { LatencyType, TaskQueryResult } from '../types'

const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
]

export function latencyColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function pickValue(row: TaskQueryResult, type: LatencyType): number | null {
  const v = row.task_event_result?.[type]
  return row.success && typeof v === 'number' ? v : null
}

function seriesNames(rows: TaskQueryResult[]) {
  const set = new Set<string>()
  for (const r of rows) set.add(r.cron_source || '未知')
  return [...set].sort((a, b) => a.localeCompare(b))
}

export interface ChartPoint {
  t: number
  [series: string]: number | null
}

export interface ChartSeries {
  name: string
  color: string
}

export interface LatencyChartOptions {
  maxPoints?: number
}

export type LatencyHealthState = 'ok' | 'loss' | 'missing'

export interface LatencyHealthBin {
  start: number
  end: number
  state: LatencyHealthState
}

export interface LatencyHealthRow {
  name: string
  color: string
  bins: LatencyHealthBin[]
}

export interface LatencyHealthOptions {
  maxBins?: number
  rangeMs: number
}

function medianDelta(values: number[]) {
  if (values.length < 2) return null
  const deltas: number[] = []
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1]
    if (delta > 0) deltas.push(delta)
  }
  if (!deltas.length) return null
  deltas.sort((a, b) => a - b)
  return deltas[Math.floor(deltas.length / 2)]
}

function ensurePoint(byTs: Map<number, ChartPoint>, t: number, names: string[]) {
  let point = byTs.get(t)
  if (!point) {
    point = { t }
    for (const n of names) point[n] = null
    byTs.set(t, point)
  }
  return point
}

function addGapBreaks(byTs: Map<number, ChartPoint>, rows: TaskQueryResult[], names: string[]) {
  for (const name of names) {
    const timestamps = rows
      .filter(row => (row.cron_source || '鏈煡') === name)
      .map(row => normalizeTs(row.timestamp))
      .sort((a, b) => a - b)
    const expected = medianDelta(timestamps)
    if (!expected) continue

    const threshold = Math.max(expected * 2.5, 60_000)
    for (let i = 1; i < timestamps.length; i++) {
      const prev = timestamps[i - 1]
      const current = timestamps[i]
      const gap = current - prev
      if (gap <= threshold) continue

      const offset = Math.min(expected, Math.floor(gap / 3))
      ensurePoint(byTs, prev + offset, names)[name] = null
      ensurePoint(byTs, current - offset, names)[name] = null
    }
  }
}

function downsampleChartData(data: ChartPoint[], names: string[], maxPoints?: number) {
  if (!maxPoints || data.length <= maxPoints) return data

  const bucketLength = Math.ceil(data.length / maxPoints)
  const sampled: ChartPoint[] = []

  for (let i = 0; i < data.length; i += bucketLength) {
    const bucket = data.slice(i, i + bucketLength)
    const middle = bucket[Math.floor(bucket.length / 2)] ?? bucket[0]
    const point: ChartPoint = { t: middle.t }

    for (const name of names) {
      let sum = 0
      let count = 0
      for (const row of bucket) {
        const value = row[name]
        if (value == null) continue
        sum += value
        count += 1
      }
      point[name] = count ? sum / count : null
    }

    sampled.push(point)
  }

  return sampled
}

export function buildLatencyChart(
  rows: TaskQueryResult[],
  type: LatencyType,
  options: LatencyChartOptions = {},
) {
  const names = seriesNames(rows)
  const series: ChartSeries[] = names.map(name => ({ name, color: latencyColor(name) }))
  const byTs = new Map<number, ChartPoint>()

  for (const r of rows) {
    const t = normalizeTs(r.timestamp)
    let pt = byTs.get(t)
    if (!pt) {
      pt = { t }
      for (const n of names) pt[n] = null
      byTs.set(t, pt)
    }
    pt[r.cron_source || '未知'] = pickValue(r, type)
  }

  addGapBreaks(byTs, rows, names)
  let data = [...byTs.values()].sort((a, b) => a.t - b.t)
  data = downsampleChartData(data, names, options.maxPoints)
  return { data, series }
}

export function buildLatencyHealth(
  rows: TaskQueryResult[],
  type: LatencyType,
  options: LatencyHealthOptions,
) {
  const names = seriesNames(rows)
  const maxBins = options.maxBins ?? 96
  const latestTs = rows.length
    ? Math.max(...rows.map(row => normalizeTs(row.timestamp)))
    : Date.now()
  const start = latestTs - options.rangeMs
  const binMs = options.rangeMs / maxBins

  return names.map<LatencyHealthRow>(name => {
    const sourceRows = rows
      .filter(row => (row.cron_source || '鏈煡') === name)
      .map(row => ({ row, t: normalizeTs(row.timestamp), value: pickValue(row, type) }))

    const bins = Array.from({ length: maxBins }, (_, index) => {
      const binStart = start + index * binMs
      const binEnd = index === maxBins - 1 ? latestTs + 1 : binStart + binMs
      const samples = sourceRows.filter(sample => sample.t >= binStart && sample.t < binEnd)
      let state: LatencyHealthState = 'missing'
      if (samples.length) {
        state = samples.some(sample => sample.value == null) ? 'loss' : 'ok'
      }
      return { start: binStart, end: binEnd, state }
    })

    return { name, color: latencyColor(name), bins }
  })
}

export interface LatencyStats {
  name: string
  color: string
  avg: number | null
  jitter: number | null
  lossRate: number
}

export function computeLatencyStats(rows: TaskQueryResult[], type: LatencyType): LatencyStats[] {
  const stats = seriesNames(rows).map<LatencyStats>(name => {
    const list = rows.filter(r => (r.cron_source || '未知') === name)
    const vals: number[] = []
    for (const r of list) {
      const v = pickValue(r, type)
      if (v != null) vals.push(v)
    }

    const color = latencyColor(name)
    const lossRate = list.length ? ((list.length - vals.length) / list.length) * 100 : 0
    if (!vals.length) return { name, color, avg: null, jitter: null, lossRate }

    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    const jitter =
      vals.length >= 2
        ? vals.slice(1).reduce((s, v, i) => s + Math.abs(v - vals[i]), 0) / (vals.length - 1)
        : null

    return { name, color, avg, jitter, lossRate }
  })

  return stats.sort((a, b) => {
    const av = a.avg ?? Infinity
    const bv = b.avg ?? Infinity
    if (av !== bv) return av - bv
    const aj = a.jitter ?? Infinity
    const bj = b.jitter ?? Infinity
    if (aj !== bj) return aj - bj
    return a.lossRate - b.lossRate
  })
}

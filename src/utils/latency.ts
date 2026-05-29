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

function resultNumber(row: TaskQueryResult, key: string) {
  const value = row.task_event_result?.[key]
  return typeof value === 'number' ? value : null
}

function sampleCount(row: TaskQueryResult) {
  const count = resultNumber(row, 'sample_count')
  return count != null && count > 0 ? count : 1
}

function failureCount(row: TaskQueryResult) {
  const count = resultNumber(row, 'failure_count')
  if (count != null && count >= 0) return count
  return row.success ? 0 : 1
}

function hasLoss(row: TaskQueryResult) {
  return failureCount(row) > 0
}

function pickValue(row: TaskQueryResult, type: LatencyType): number | null {
  const value = resultNumber(row, type)
  return value != null ? value : null
}

function seriesNames(rows: TaskQueryResult[]) {
  const set = new Set<string>()
  for (const row of rows) set.add(row.cron_source || '未知')
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

export interface LatencyChartResult {
  data: ChartPoint[]
  series: ChartSeries[]
  lossPoints: number[]
}

export function lossKey(name: string) {
  return `__loss__:${name}`
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
    for (const name of names) {
      point[name] = null
      point[lossKey(name)] = null
    }
    byTs.set(t, point)
  }
  return point
}

function addGapBreaks(byTs: Map<number, ChartPoint>, rows: TaskQueryResult[], names: string[]) {
  for (const name of names) {
    const timestamps = rows
      .filter(row => (row.cron_source || '未知') === name)
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
): LatencyChartResult {
  const names = seriesNames(rows)
  const series: ChartSeries[] = names.map(name => ({ name, color: latencyColor(name) }))
  const byTs = new Map<number, ChartPoint>()
  const lossFlags = new Map<number, Set<string>>()

  for (const row of rows) {
    const t = normalizeTs(row.timestamp)
    const name = row.cron_source || '未知'
    const point = ensurePoint(byTs, t, names)
    point[name] = pickValue(row, type)
    if (hasLoss(row)) {
      let set = lossFlags.get(t)
      if (!set) {
        set = new Set()
        lossFlags.set(t, set)
      }
      set.add(name)
    }
  }

  addGapBreaks(byTs, rows, names)
  let data = [...byTs.values()].sort((a, b) => a.t - b.t)

  const lastGood: Record<string, number> = {}
  for (const point of data) {
    for (const name of names) {
      const value = point[name]
      if (typeof value === 'number') lastGood[name] = value
    }
    const lost = lossFlags.get(point.t)
    if (lost) {
      for (const name of lost) point[lossKey(name)] = lastGood[name] ?? 0
    }
  }

  data = downsampleChartData(data, [...names, ...names.map(lossKey)], options.maxPoints)
  return { data, series, lossPoints: [...lossFlags.keys()].sort((a, b) => a - b) }
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
      .filter(row => (row.cron_source || '未知') === name)
      .map(row => ({
        t: normalizeTs(row.timestamp),
        value: pickValue(row, type),
        loss: hasLoss(row),
      }))

    const bins = Array.from({ length: maxBins }, (_, index) => {
      const binStart = start + index * binMs
      const binEnd = index === maxBins - 1 ? latestTs + 1 : binStart + binMs
      const samples = sourceRows.filter(sample => sample.t >= binStart && sample.t < binEnd)
      let state: LatencyHealthState = 'missing'
      if (samples.length) {
        state = samples.some(sample => sample.loss || sample.value == null) ? 'loss' : 'ok'
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
    const list = rows.filter(row => (row.cron_source || '未知') === name)
    const values: number[] = []
    let totalSamples = 0
    let failedSamples = 0

    for (const row of list) {
      totalSamples += sampleCount(row)
      failedSamples += failureCount(row)
      const value = pickValue(row, type)
      if (value != null) values.push(value)
    }

    const color = latencyColor(name)
    const lossRate = totalSamples ? (failedSamples / totalSamples) * 100 : 0
    if (!values.length) return { name, color, avg: null, jitter: null, lossRate }

    const avg = values.reduce((sum, value) => sum + value, 0) / values.length
    const jitter =
      values.length >= 2
        ? values.slice(1).reduce((sum, value, index) => sum + Math.abs(value - values[index]), 0) / (values.length - 1)
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

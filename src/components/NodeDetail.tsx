import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import {
  Area,
  AreaChart,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { deriveUsage, displayName, distroLogo, osLabel, virtLabel } from '../utils/derive'
import { cycleProgress, hasCost, remainingDays, remainingValue } from '../utils/cost'
import { cn, strokeColor } from '../utils/cn'
import {
  buildLatencyChart,
  computeLatencyStats,
  lossKey,
  type ChartPoint,
  type ChartSeries,
  type LatencyStats,
} from '../utils/latency'
import { useNodeLatency } from '../hooks/useNodeLatency'
import type { BackendPool } from '../api/pool'
import type { HistorySample, LatencyType, Node, NodeMeta, TaskQueryResult } from '../types'
import { convertToCny, formatCny, formatMoney, normalizeCurrencyUnit } from '../utils/currency'

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 6,
  fontSize: 11,
}

const LATENCY_ACTIVE_DOT = {
  r: 3.5,
  strokeWidth: 2,
}

const LATENCY_CHART_MAX_POINTS = 720

const LATENCY_RANGE = { label: '24h', ms: 24 * 60 * 60 * 1000 } as const
const LATENCY_LOSS_COLOR = '#ef4444'

interface Props {
  node: Node | null
  onClose: () => void
  showSource?: boolean
  pool: BackendPool | null
  cnyRates: Record<string, number>
  latencyAggregateRoute?: string
}

export function NodeDetail({
  node,
  onClose,
  showSource,
  pool,
  cnyRates,
  latencyAggregateRoute = '',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    if (!node) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [node, onClose])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setStuck(false)
    const onScroll = () => {
      const h = headerRef.current?.offsetHeight ?? 60
      setStuck(el.scrollTop > h)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [node])

  const { pingData, tcpData, loading: latencyLoading } = useNodeLatency(
    pool,
    node?.source ?? null,
    node?.uuid ?? null,
    LATENCY_RANGE.ms,
    { aggregateRoute: latencyAggregateRoute },
  )

  if (!node) return null

  const u = deriveUsage(node)
  const d = node.dynamic
  const s = node.static?.system
  const cpu = node.static?.cpu
  const tags = node.meta?.tags ?? []
  const virt = virtLabel(node)
  const logo = distroLogo(node)
  const swap =
    d?.total_swap && d.used_swap != null ? (d.used_swap / d.total_swap) * 100 : undefined
  const loadAvg =
    d?.load_one != null && d?.load_five != null && d?.load_fifteen != null
      ? `${d.load_one.toFixed(2)} / ${d.load_five.toFixed(2)} / ${d.load_fifteen.toFixed(2)}`
      : null
  const history = node.history || []

  return (
    <div
      ref={scrollRef}
      className="fixed inset-0 z-50 bg-background overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        ref={headerRef}
        className={`sticky top-0 z-10 transition-[background-color,backdrop-filter,border-color] duration-200 ${
          stuck
            ? 'border-b border-border/40 backdrop-blur bg-background/70'
            : 'border-b border-transparent'
        }`}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="返回" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <StatusDot online={node.online} />
          {logo && (
            <img src={logo} alt="" className="w-5 h-5 shrink-0 object-contain" loading="lazy" />
          )}
          <span className="font-semibold truncate min-w-0">{displayName(node)}</span>
          <Flag code={node.meta?.region} className="shrink-0" />
          <span className="hidden md:inline truncate text-xs font-mono text-muted-foreground">
            {node.uuid}
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5 shrink-0">
            {node.meta?.region && <Badge variant="secondary">{node.meta.region}</Badge>}
            {showSource && (
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {node.source}
              </Badge>
            )}
            {virt && <Badge variant="secondary">{virt}</Badge>}
            {tags.map(t => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        <Section title="资源">
          <div className="flex flex-wrap justify-around gap-4 sm:gap-6">
            <Ring label="CPU" value={u.cpu} sub={loadAvg ?? undefined} />
            <Ring
              label="内存"
              value={u.mem}
              sub={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : undefined}
            />
            <Ring
              label="磁盘"
              value={u.disk}
              sub={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : undefined}
            />
            {swap != null && (
              <Ring
                label="Swap"
                value={swap}
                sub={`${bytes(d?.used_swap)} / ${bytes(d?.total_swap)}`}
              />
            )}
          </div>
        </Section>

        {history.length > 1 && (
          <Section title={`近 ${history.length * 2} 秒趋势`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Spark
                data={history}
                dataKey="cpu"
                label="CPU %"
                stroke="#3b82f6"
                domain={[0, 100]}
                format={pct}
              />
              <Spark
                data={history}
                dataKey="mem"
                label="内存 %"
                stroke="#10b981"
                domain={[0, 100]}
                format={pct}
              />
              <Spark
                data={history}
                dataKey="netIn"
                label="下行"
                stroke="#8b5cf6"
                format={v => `${bytes(v)}/s`}
              />
              <Spark
                data={history}
                dataKey="netOut"
                label="上行"
                stroke="#f59e0b"
                format={v => `${bytes(v)}/s`}
              />
            </div>
          </Section>
        )}

        {(latencyLoading || tcpData.length > 0 || pingData.length > 0) && (
          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">延迟监控</div>
            </div>

            {latencyLoading && tcpData.length === 0 && pingData.length === 0 && (
              <Section title={`最近 ${LATENCY_RANGE.label}`}>
                <div className="py-16 flex items-center justify-center text-xs text-muted-foreground">
                  加载延迟数据中
                </div>
              </Section>
            )}

            {tcpData.length > 0 && (
              <LatencyBlock
                title="TCP Ping"
                rows={tcpData}
                type="tcp_ping"
                loading={latencyLoading}
                rangeLabel={LATENCY_RANGE.label}
                rangeMs={LATENCY_RANGE.ms}
              />
            )}
            {pingData.length > 0 && (
              <LatencyBlock
                title="Ping"
                rows={pingData}
                type="ping"
                loading={latencyLoading}
                rangeLabel={LATENCY_RANGE.label}
                rangeMs={LATENCY_RANGE.ms}
              />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Section title="系统">
            <KV k="主机名" v={s?.system_host_name} />
            <KV k="操作系统" v={osLabel(node)} />
            <KV k="内核" v={s?.system_kernel || s?.system_kernel_version} />
            <KV k="CPU 架构" v={s?.arch || s?.cpu_arch} />
            <KV k="虚拟化" v={virt} />
            <KV k="CPU 型号" v={cpu?.brand || cpu?.per_core?.[0]?.brand} />
            <KV
              k="核心"
              v={
                cpu?.physical_cores != null
                  ? `${cpu.physical_cores} 物理 / ${cpu.logical_cores} 逻辑`
                  : cpu?.per_core?.length
                    ? `${cpu.per_core.length} 核`
                    : null
              }
            />
          </Section>

          <Section title="网络与负载">
            <KV k="累计接收" v={d?.total_received != null ? bytes(d.total_received) : null} />
            <KV k="累计发送" v={d?.total_transmitted != null ? bytes(d.total_transmitted) : null} />
            <KV k="磁盘读" v={d?.read_speed != null ? `${bytes(d.read_speed)}/s` : null} />
            <KV k="磁盘写" v={d?.write_speed != null ? `${bytes(d.write_speed)}/s` : null} />
            <KV k="进程数" v={d?.process_count} />
            <KV
              k="TCP / UDP"
              v={
                d?.tcp_connections != null || d?.udp_connections != null
                  ? `${d?.tcp_connections ?? '—'} / ${d?.udp_connections ?? '—'}`
                  : null
              }
            />
            <KV k="运行时长" v={uptime(d?.uptime)} />
            <KV k="数据更新" v={relativeAge(d?.timestamp)} />
          </Section>

          {hasCost(node.meta) && <CostSection meta={node.meta} cnyRates={cnyRates} />}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">{title}</div>
      {children}
    </Card>
  )
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  if (v == null || v === '') return null
  return (
    <div className="flex justify-between gap-3 text-sm py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-right truncate">{v}</span>
    </div>
  )
}

function Ring({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  const r = 40
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value ?? 0))
  const hasValue = Number.isFinite(value)

  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      <div className="relative w-24 h-24 sm:w-28 sm:h-28">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle
            cx="50" cy="50" r={r}
            fill="none" strokeWidth={8}
            className="stroke-secondary"
          />
          {hasValue && (
            <circle
              cx="50" cy="50" r={r}
              fill="none" strokeWidth={8}
              className={strokeColor(value)}
              strokeDasharray={c}
              strokeDashoffset={c - (c * v) / 100}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 400ms ease' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-base sm:text-lg font-semibold">
          {pct(value)}
        </div>
      </div>
      <div className="text-sm font-medium">{label}</div>
      {sub && (
        <div className="text-xs font-mono text-muted-foreground truncate max-w-full" title={sub}>
          {sub}
        </div>
      )}
    </div>
  )
}

interface SparkProps {
  data: HistorySample[]
  dataKey: keyof HistorySample
  label: string
  stroke: string
  domain?: [number, number]
  format: (v: number) => string
}

function Spark({ data, dataKey, label, stroke, domain, format }: SparkProps) {
  const last = Number(data.at(-1)?.[dataKey] ?? 0)
  const id = `g-${dataKey}`
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{format(last)}</span>
      </div>
      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis hide domain={domain ?? ['auto', 'auto']} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={t => new Date(t).toLocaleTimeString()}
              formatter={(v: number) => [format(v), label]}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={stroke}
              strokeWidth={1.5}
              fill={`url(#${id})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

interface LatencyBlockProps {
  title: string
  rows: TaskQueryResult[]
  type: LatencyType
  loading: boolean
  rangeLabel: string
  rangeMs: number
}

const ms = (v: number) => `${v.toFixed(1)} ms`

interface LatencySourceSummary extends LatencyStats {
  latest: number | null
}

interface LatencyTooltipProps {
  active?: boolean
  payload?: Array<{ payload?: ChartPoint }>
  series: ChartSeries[]
}

// 自定义延迟 tooltip：逐来源显示延迟；该来源若在此刻丢包则显示「丢包」(红色)，无样本则不列出。
function LatencyTooltip({ active, payload, series }: LatencyTooltipProps) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  const rows = series
    .map(s => {
      const v = point[s.name]
      const lost = point[lossKey(s.name)] != null
      if (typeof v !== 'number' && !lost) return null
      return { name: s.name, color: s.color, value: typeof v === 'number' ? v : null, lost }
    })
    .filter((r): r is { name: string; color: string; value: number | null; lost: boolean } => r != null)

  if (!rows.length) return null

  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '6px 9px', lineHeight: 1.5 }}>
      <div style={{ color: 'hsl(var(--muted-foreground))', marginBottom: 3 }}>
        {new Date(Number(point.t)).toLocaleTimeString()}
      </div>
      {rows.map(r => (
        <div key={r.name} style={{ display: 'flex', gap: 14, justifyContent: 'space-between' }}>
          <span style={{ color: r.color }}>{r.name}</span>
          <span style={{ fontWeight: 600 }}>
            {r.value != null && (
              <span style={{ color: 'hsl(var(--foreground))' }}>{ms(r.value)}</span>
            )}
            {r.lost && (
              <span
                style={{
                  color: LATENCY_LOSS_COLOR,
                  fontWeight: 700,
                  marginLeft: r.value != null ? 6 : 0,
                }}
              >
                丢包
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatDuration(msValue: number) {
  const minutes = Math.max(1, Math.round(msValue / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`
}

function formatLatencyTick(t: number, rangeMs: number) {
  const date = new Date(t)
  if (rangeMs <= 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (rangeMs <= 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

function LatencyBlock({ title, rows, type, loading, rangeLabel, rangeMs }: LatencyBlockProps) {
  const { data, series } = useMemo(
    () => buildLatencyChart(rows, type, { maxPoints: LATENCY_CHART_MAX_POINTS }),
    [rows, type],
  )
  const stats = useMemo(() => computeLatencyStats(rows, type), [rows, type])
  const sourceSummaries = useMemo<LatencySourceSummary[]>(
    () =>
      stats.map(stat => {
        const latest = [...rows]
          .reverse()
          .find(row => row.cron_source === stat.name && typeof row.task_event_result?.[type] === 'number')
        return {
          ...stat,
          latest: typeof latest?.task_event_result?.[type] === 'number' ? Number(latest.task_event_result[type]) : null,
        }
      }),
    [rows, stats, type],
  )
  const [activeNames, setActiveNames] = useState<string[]>([])
  const empty = data.length === 0
  const latestTs = data.at(-1)?.t ?? Date.now()
  const requestedStart = latestTs - rangeMs
  const actualStart = data[0]?.t
  const actualSpan =
    actualStart != null && data.length > 1 ? Math.max(0, latestTs - actualStart) : 0

  const visibleSeries =
    activeNames.length > 0 ? series.filter(s => activeNames.includes(s.name)) : series
  const activeLossOverlayKey =
    visibleSeries.length === 1 ? lossKey(visibleSeries[0].name) : null

  const toggle = (name: string) =>
    setActiveNames(prev => (prev.includes(name) ? prev.filter(item => item !== name) : [...prev, name]))

  return (
    <Section title={`${title} · 最近 ${rangeLabel}`}>
      {sourceSummaries.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border bg-border/50 p-px">
          <div className="flex flex-wrap gap-px">
            {sourceSummaries.map(summary => (
              <button
                key={summary.name}
                type="button"
                onClick={() => toggle(summary.name)}
                data-active={activeNames.includes(summary.name)}
                className={cn(
                  'min-w-fit flex-1 bg-background/90 px-4 py-3 text-left transition-[background-color,box-shadow,color] hover:bg-muted/40',
                  'border-b-2 border-b-transparent data-[active=true]:bg-muted/60',
                )}
                style={{
                  borderBottomColor: activeNames.includes(summary.name) ? summary.color : 'transparent',
                }}
              >
                <div className="flex flex-col gap-1.5 whitespace-nowrap">
                  <span className="text-xs text-muted-foreground">{summary.name}</span>
                  <span className={cn('font-mono text-lg font-bold leading-none', latencyValueTone(summary.latest))}>
                  {summary.latest == null ? '—' : `${summary.latest < 1 ? '<1' : summary.latest.toFixed(1)}ms`}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    丢包{' '}
                    <span className={cn('font-semibold', latencyLossTone(summary.lossRate))}>
                      {summary.lossRate.toFixed(summary.lossRate < 10 ? 1 : 0)}%
                    </span>
                    {' · '}
                    波动{' '}
                    <span className={cn('font-semibold', latencyJitterTone(summary.jitter))}>
                      {summary.jitter == null ? '—' : `${summary.jitter.toFixed(1)}ms`}
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative h-60">
        {activeNames.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveNames([])}
            className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur hover:text-foreground"
          >
            <X className="h-3 w-3" />
            清除筛选 ({activeNames.length})
          </button>
        )}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {loading ? '加载中…' : `暂无 ${type} 数据`}
          </div>
        )}
        {!empty && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="t"
                type="number"
                domain={[actualStart ?? requestedStart, latestTs]}
                scale="time"
                tickFormatter={t => formatLatencyTick(Number(t), rangeMs)}
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tickFormatter={v => `${v}ms`}
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                width={48}
                domain={[0, 'auto']}
              />
              <Tooltip
                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.24 }}
                content={(props: { active?: boolean; payload?: Array<{ payload?: ChartPoint }> }) => (
                  <LatencyTooltip active={props.active} payload={props.payload} series={visibleSeries} />
                )}
              />
              {activeLossOverlayKey && (
                <Area
                  type="stepAfter"
                  dataKey={activeLossOverlayKey}
                  stroke="none"
                  fill={LATENCY_LOSS_COLOR}
                  fillOpacity={0.14}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}
              {visibleSeries.map(s => (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  stroke={s.color}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{
                    ...LATENCY_ACTIVE_DOT,
                    fill: s.color,
                    stroke: 'hsl(var(--background))',
                  }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {!empty && loading && (
          <div className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>

      {stats.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 px-1 text-[11px] text-muted-foreground">
          <span>{rows.length} 个样本 · {series.length} 来源</span>
          <span>实际跨度 {formatDuration(actualSpan)}</span>
        </div>
      )}
    </Section>
  )
}

function latencyValueTone(value: number | null) {
  if (value == null || value <= 50) return 'text-emerald-500'
  if (value <= 100) return 'text-lime-400'
  if (value <= 180) return 'text-yellow-400'
  if (value <= 250) return 'text-orange-500'
  return 'text-red-500'
}

function latencyLossTone(lossRate: number) {
  if (lossRate < 0.1) return 'text-muted-foreground'
  if (lossRate <= 3) return 'text-yellow-400'
  if (lossRate <= 10) return 'text-orange-500'
  return 'text-red-500'
}

function latencyJitterTone(jitter: number | null) {
  if (jitter == null || jitter < 10) return 'text-emerald-500'
  if (jitter < 30) return 'text-yellow-500'
  return 'text-red-500'
}

function CostSection({ meta, cnyRates }: { meta: NodeMeta; cnyRates: Record<string, number> }) {
  const days = remainingDays(meta.expireTime)
  const value = remainingValue(meta)
  const progress = cycleProgress(meta)
  const unit = meta.priceUnit || '$'
  const cycleCny = convertToCny(meta.price, unit, cnyRates)
  const monthlyCny = cycleCny == null ? null : cycleCny * (30 / meta.priceCycle)
  const valueCny = convertToCny(value, unit, cnyRates)
  const showConverted = normalizeCurrencyUnit(unit) !== 'CNY'

  let daysLabel: string
  let daysClass = ''
  if (days == null) daysLabel = '未设置'
  else if (days < 0) {
    daysLabel = `已过期 ${Math.abs(days)} 天`
    daysClass = 'text-red-500'
  } else if (days <= 7) {
    daysLabel = `${days} 天`
    daysClass = 'text-red-500'
  } else if (days <= 30) {
    daysLabel = `${days} 天`
    daysClass = 'text-orange-500'
  } else {
    daysLabel = `${days} 天`
  }

  const barColor =
    days == null || days < 0
      ? 'bg-muted-foreground/40'
      : days <= 7
        ? 'bg-red-500'
        : days <= 30
          ? 'bg-orange-500'
          : 'bg-emerald-500'

  return (
    <Section title="费用">
      <KV k="周期费用" v={meta.price > 0 ? `${formatMoney(meta.price, unit)} / ${meta.priceCycle} 天` : null} />
      {showConverted && (
        <KV
          k="折合周期费用"
          v={cycleCny != null ? `${formatCny(cycleCny)} / ${meta.priceCycle} 天` : '暂无汇率'}
        />
      )}
      <KV k="月均费用" v={monthlyCny != null ? `${formatCny(monthlyCny)} / 30 天` : null} />
      <KV k="到期" v={meta.expireTime || null} />
      <KV k="剩余" v={<span className={daysClass}>{daysLabel}</span>} />
      <KV k="剩余价值" v={meta.price > 0 ? formatMoney(value, unit) : null} />
      {showConverted && (
        <KV k="折合剩余价值" v={valueCny != null ? formatCny(valueCny) : '暂无汇率'} />
      )}

      {meta.expireTime && days != null && (
        <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </Section>
  )
}

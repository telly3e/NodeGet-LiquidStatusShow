import {
  Activity,
  ArrowDown,
  ArrowUp,
  Clock,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  RadioTower,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Card } from './ui/card'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { cpuLabel, deriveUsage, displayName, distroLogo, osLabel, virtLabel } from '../utils/derive'
import { cn } from '../utils/cn'
import { computeLatencyStats } from '../utils/latency'
import { useNodeLatency } from '../hooks/useNodeLatency'
import type { BackendPool } from '../api/pool'
import type { LatencyType, Node, TaskQueryResult } from '../types'

const CARD_LATENCY_WINDOW_MS = 15 * 60 * 1000
const CARD_LATENCY_OPTIONS = {
  cacheTtlMs: 120_000,
  includePing: false,
  includeTcp: true,
  limit: 100,
  refreshMs: 30_000,
}

export function NodeCard({
  node,
  pool,
  cardLatencyMonitorName = '',
  latencyAggregateRoute = '',
}: {
  node: Node
  pool: BackendPool | null
  cardLatencyMonitorName?: string
  latencyAggregateRoute?: string
}) {
  const u = deriveUsage(node)
  const os = osLabel(node)
  const logo = distroLogo(node)
  const virt = virtLabel(node)
  const cpu = cpuLabel(node)
  const load = loadUsage(node)
  const latencyMonitorName = cardLatencyMonitorName.trim()
  const { pingData, tcpData, loading: latencyLoading } = useNodeLatency(
    latencyMonitorName ? pool : null,
    node.source,
    node.uuid,
    CARD_LATENCY_WINDOW_MS,
    {
      ...CARD_LATENCY_OPTIONS,
      aggregateRoute: latencyAggregateRoute,
      cronSource: latencyMonitorName,
    },
  )
  const latency = useMemo(
    () => firstLatency(tcpData, 'tcp_ping', latencyMonitorName) ?? firstLatency(pingData, 'ping', latencyMonitorName),
    [tcpData, pingData, latencyMonitorName],
  )

  return (
    <a href={`#${encodeURIComponent(node.uuid)}`} className="block h-full">
      <Card
        className={cn(
          'group relative h-full overflow-hidden p-4 transition',
          'liquid-card flex flex-col gap-3.5',
          !node.online && 'opacity-60',
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.22)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.18)_1px,transparent_1px)] bg-[size:24px_24px] opacity-20" />

        <div className="relative flex items-center gap-2.5">
          <StatusDot online={node.online} />
          {logo && (
            <img src={logo} alt="" className="h-5 w-5 shrink-0 object-contain" loading="lazy" />
          )}
          <span className="min-w-0 flex-1 truncate text-lg font-bold tracking-normal" title={displayName(node)}>
            {displayName(node)}
          </span>
          <Flag code={node.meta?.region} className="shrink-0" />
        </div>

        <div className="glass-divider relative border-t border-dashed pt-3">
          {(os || virt) && (
            <div className="truncate font-mono text-xs font-semibold text-muted-foreground">
              {[os, virt].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <div className="relative grid grid-cols-2 gap-x-4 gap-y-3.5">
          <Metric icon={Cpu} label="CPU" value={u.cpu} sub={cpu || null} subTitle={cpu || undefined} />
          <Metric
            icon={MemoryStick}
            label="内存"
            value={u.mem}
            sub={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : null}
            accent="violet"
          />
          <Metric
            icon={HardDrive}
            label="磁盘"
            value={u.disk}
            sub={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : null}
            accent="orange"
          />
          <Metric
            icon={Gauge}
            label="负载"
            value={load.percent}
            displayValue={load.value}
            sub={load.sub}
            accent="muted"
          />
        </div>
        {latencyMonitorName && <LatencyPanel latency={latency} loading={latencyLoading} />}
        <div className="glass-divider relative mt-auto border-t border-dashed pt-3 font-mono text-xs">
          <div className="flex items-center gap-4 text-muted-foreground">
            <Stat icon={ArrowDown}>{bytes(u.netIn || 0)}/s</Stat>
            <Stat icon={ArrowUp}>{bytes(u.netOut || 0)}/s</Stat>
          </div>
          <div className="mt-2 flex items-center gap-3 text-muted-foreground">
            <Stat icon={Clock}>{uptime(u.uptime)}</Stat>
            <span className="ml-auto">{relativeAge(u.ts)}</span>
          </div>
        </div>
      </Card>
    </a>
  )
}

function Stat({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  displayValue,
  sub,
  subTitle,
  accent = 'primary',
}: {
  icon: LucideIcon
  label: string
  value: number | undefined
  displayValue?: string
  sub?: string | null
  subTitle?: string
  accent?: 'primary' | 'violet' | 'orange' | 'muted'
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">{label}</span>
        <span className="ml-auto font-mono text-foreground">{displayValue ?? pct(value)}</span>
      </div>
      {sub && (
        <div className="mb-2 truncate font-mono text-[11px] text-muted-foreground" title={subTitle ?? sub}>
          {sub}
        </div>
      )}
      <SegmentBar value={value} accent={accent} />
    </div>
  )
}

function SegmentBar({
  value,
  accent,
  count = 18,
}: {
  value?: number | null
  accent: 'primary' | 'violet' | 'orange' | 'muted'
  count?: number
}) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value as number)) : 0
  const active = Math.round((safeValue / 100) * count)
  const color =
    accent === 'violet'
      ? { fill: 'bg-violet-500', end: 'bg-violet-300' }
      : accent === 'orange'
        ? { fill: 'bg-orange-500', end: 'bg-orange-300' }
        : accent === 'muted'
          ? { fill: 'bg-muted-foreground', end: 'bg-slate-300 dark:bg-slate-400' }
          : { fill: 'bg-primary', end: 'bg-blue-300' }

  return (
    <div className="grid h-2 grid-cols-[repeat(18,minmax(0,1fr))] gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'rounded-sm',
            i < active ? (i === active - 1 ? color.end : color.fill) : 'segment-empty',
          )}
        />
      ))}
    </div>
  )
}

interface FirstLatency {
  name: string
  type: LatencyType
  avg: number | null
  lossRate: number
  samples: Array<number | null>
}

function firstLatency(rows: TaskQueryResult[], type: LatencyType, name: string): FirstLatency | null {
  if (!name) return null

  const stats = computeLatencyStats(rows, type).find(stat => stat.name === name)
  const sourceRows = rows.filter(row => row.cron_source === name).slice(-18)
  const samples = sourceRows.map(row => {
    const value = row.task_event_result?.[type]
    return row.success && typeof value === 'number' ? value : null
  })

  return {
    name,
    type,
    avg: stats?.avg ?? null,
    lossRate: stats?.lossRate ?? 0,
    samples,
  }
}

function LatencyPanel({ latency, loading }: { latency: FirstLatency | null; loading: boolean }) {
  const avgTone = latencyTone(latency?.avg)
  const lossTone = lossRateTone(latency?.lossRate ?? 0)

  return (
    <div className={cn('glass-panel relative rounded-md border border-dashed p-3.5', lossTone.panelBorder)}>
      <div className="mb-3 flex items-center gap-2">
        <Activity className={cn('h-4 w-4', avgTone.text)} />
        <span className="text-sm font-bold">延迟监控</span>
        <span className="ml-auto font-mono text-[11px] uppercase text-muted-foreground">
          {latency?.type === 'ping' ? 'IPV4 PING' : 'IPV4 TCPING'}
        </span>
      </div>

      {!latency && (
        <div className="flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground">
          <RadioTower className={cn('h-4 w-4', loading && 'animate-pulse')} />
          {loading ? '加载延迟数据中' : '暂无延迟数据'}
        </div>
      )}

      {latency && (
        <div className="grid grid-cols-[minmax(56px,0.85fr)_minmax(132px,1.7fr)_auto] items-center gap-2.5 text-xs">
          <span className="truncate font-semibold text-muted-foreground" title={latency.name}>
            {latency.name}
          </span>
          <div className="grid h-4 grid-cols-[repeat(18,minmax(0,1fr))] items-end gap-1 overflow-hidden">
            {latency.samples.map((value, i) => (
              <span
                key={i}
                className={cn(
                  'w-full min-w-0 rounded-full',
                  value == null ? 'h-2.5 bg-red-500' : latencyTone(value).bar,
                )}
                style={value == null ? undefined : { height: latencyBarHeight(value) }}
                title={value == null ? 'packet loss' : `${Math.round(value)}ms`}
              />
            ))}
          </div>
          <span className={cn('text-right font-mono font-bold', avgTone.text)}>
            {latency.avg != null ? `${Math.round(latency.avg)}ms` : '—'}
            <span className={cn('block text-[11px] font-semibold', lossTone.text)}>
              {formatLossRate(latency.lossRate)}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}

function latencyTone(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 50) {
    return { bar: 'bg-emerald-500', text: 'text-emerald-500' }
  }
  if (value <= 100) return { bar: 'bg-lime-400', text: 'text-lime-400' }
  if (value <= 180) return { bar: 'bg-yellow-400', text: 'text-yellow-400' }
  if (value <= 250) return { bar: 'bg-orange-500', text: 'text-orange-500' }
  return { bar: 'bg-red-500', text: 'text-red-500' }
}

function latencyBarHeight(value: number) {
  const clamped = Math.max(0, Math.min(value, 260))
  return `${Math.round(24 + (clamped / 260) * 76)}%`
}

function lossRateTone(lossRate: number) {
  if (lossRate < 0.1) {
    return { text: 'text-muted-foreground', panelBorder: 'border-border/80' }
  }
  if (lossRate <= 3) {
    return { text: 'text-yellow-400', panelBorder: 'border-border/80' }
  }
  if (lossRate <= 10) {
    return { text: 'text-orange-500', panelBorder: 'border-orange-500/70' }
  }
  return { text: 'text-red-500', panelBorder: 'border-red-500/75' }
}

function formatLossRate(lossRate: number) {
  if (lossRate < 0.1) return '0%'
  if (lossRate < 10) return `${lossRate.toFixed(1)}%`
  return `${lossRate.toFixed(0)}%`
}

function loadUsage(node: Node) {
  const load = node.dynamic?.load_one
  const cores = node.static?.cpu?.logical_cores ?? node.static?.cpu?.physical_cores ?? node.static?.cpu?.per_core?.length
  const percent = load != null && cores ? Math.min(100, (load / cores) * 100) : undefined

  return {
    percent,
    value: load != null ? load.toFixed(2) : '—',
    sub: load != null && cores ? `${percent?.toFixed(0) ?? 0}% of ${cores} 核` : null,
  }
}

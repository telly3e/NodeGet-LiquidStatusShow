import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarRange, Coins, Loader2, Server } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert'
import { Card } from './components/ui/card'
import { useConfig } from './hooks/useConfig'
import { useNodes } from './hooks/useNodes'
import { Background } from './components/Background'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { NodeCard } from './components/NodeCard'
import { NodeTable } from './components/NodeTable'
import { NodeDetail } from './components/NodeDetail'
import { TagFilter } from './components/TagFilter'
import { RegionFilter } from './components/RegionFilter'

const WorldMap = lazy(() =>
  import('./components/WorldMap').then(m => ({ default: m.WorldMap })),
)
import { deriveUsage, displayName } from './utils/derive'
import { remainingDays, remainingValue } from './utils/cost'
import type { Node, Sort, View } from './types'

const DEFAULT_LOGO = `${import.meta.env.BASE_URL}logo.png`
const VIEW_KEY = 'nodeget.view'
const SORT_KEY = 'nodeget.sort'

function initialView(): View {
  const v = localStorage.getItem(VIEW_KEY)
  if (v === 'table' || v === 'map') return v
  return 'cards'
}

function initialSort(): Sort {
  return (localStorage.getItem(SORT_KEY) as Sort) || 'default'
}

function readHash() {
  return decodeURIComponent(window.location.hash.slice(1)) || null
}

function updateFavicon(href: string) {
  const rel = 'icon'
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = rel
    document.head.appendChild(link)
  }
  link.type = 'image/png'
  link.href = href
}

const num = (v?: number) => (Number.isFinite(v) ? (v as number) : -Infinity)
const enabled = (value?: boolean) => value !== false

interface SidebarCardVisibility {
  valueStats: boolean
  onlineTotal: boolean
  expiring7Days: boolean
  expiringSoon: boolean
}

function money(value: number, unit: string) {
  const code = unit.trim()
  const upper = code.toUpperCase()
  if (code === '¥' || code === '￥' || upper === 'CNY' || upper === 'RMB') {
    return `¥${value.toFixed(2)}`
  }
  const prefix = code === '$' || upper === 'USD' ? '$' : ''
  const suffix = prefix ? '' : code ? ` ${code}` : ''
  return `${prefix}${value.toFixed(2)}${suffix}`
}

function billingCycle(meta: Node['meta']) {
  return Number.isFinite(meta.priceCycle) && meta.priceCycle > 0 ? meta.priceCycle : 30
}

function primaryUnit(nodes: Node[]) {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    if (node.meta.price <= 0) continue
    const unit = node.meta.priceUnit || 'CNY'
    counts.set(unit, (counts.get(unit) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'CNY'
}

export function App() {
  const { config, error: configError } = useConfig()
  const { nodes, errors, pool } = useNodes(config)

  const [view, setView] = useState<View>(initialView)
  const [sort, setSort] = useState<Sort>(initialSort)
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeRegion, setActiveRegion] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(readHash)

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort)
  }, [sort])

  useEffect(() => {
    const onHash = () => setSelected(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const target = selected ? `#${encodeURIComponent(selected)}` : ''
    if (window.location.hash === target) return
    if (selected) {
      window.location.hash = encodeURIComponent(selected)
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [selected])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const n of nodes.values()) {
      if (n.meta?.hidden) continue
      for (const t of n.meta?.tags ?? []) set.add(t)
    }
    return [...set].sort()
  }, [nodes])

  const regions = useMemo(() => {
    const map = new Map<string, number>()
    let total = 0
    for (const n of nodes.values()) {
      if (n.meta?.hidden) continue
      total++
      const code = n.meta?.region?.trim().toUpperCase()
      if (!code || !/^[A-Z]{2}$/.test(code)) continue
      map.set(code, (map.get(code) ?? 0) + 1)
    }
    const list = [...map.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    return { list, total }
  }, [nodes])

  useEffect(() => {
    if (activeTag && !allTags.includes(activeTag)) setActiveTag(null)
  }, [allTags, activeTag])

  useEffect(() => {
    if (activeRegion && !regions.list.some(r => r.code === activeRegion)) setActiveRegion(null)
  }, [regions, activeRegion])

  const list = useMemo(() => {
    let arr = [...nodes.values()].filter(n => !n.meta?.hidden)
    if (activeTag) arr = arr.filter(n => n.meta?.tags?.includes(activeTag))
    if (activeRegion) {
      arr = arr.filter(n => n.meta?.region?.trim().toUpperCase() === activeRegion)
    }

    const q = query.trim().toLowerCase()
    if (q) {
      arr = arr.filter(n => {
        const hay = [
          n.uuid,
          n.source,
          n.meta?.name,
          n.meta?.region,
          n.meta?.virtualization,
          n.static?.system?.system_host_name,
          n.static?.system?.system_name,
          ...(n.meta?.tags ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }

    const rank = new Map(regions.list.map((r, i) => [r.code, i]))

    return arr.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1

      const ua = deriveUsage(a)
      const ub = deriveUsage(b)
      let cmp = 0
      if (sort === 'cpu') cmp = num(ub.cpu) - num(ua.cpu)
      else if (sort === 'mem') cmp = num(ub.mem) - num(ua.mem)
      else if (sort === 'disk') cmp = num(ub.disk) - num(ua.disk)
      else if (sort === 'netIn') cmp = num(ub.netIn) - num(ua.netIn)
      else if (sort === 'netOut') cmp = num(ub.netOut) - num(ua.netOut)
      else if (sort === 'uptime') cmp = num(ub.uptime) - num(ua.uptime)
      else if (sort === 'region') {
        const ar = rank.get(a.meta?.region?.trim().toUpperCase() || '') ?? Infinity
        const br = rank.get(b.meta?.region?.trim().toUpperCase() || '') ?? Infinity
        cmp = ar - br
      }
      else if (sort === 'default') cmp = (a.meta?.order ?? 0) - (b.meta?.order ?? 0)

      return cmp || displayName(a).localeCompare(displayName(b))
    })
  }, [nodes, query, activeTag, activeRegion, sort, regions])

  const costNodes = useMemo(
    () => [...nodes.values()].filter(n => !n.meta?.hidden),
    [nodes],
  )

  const selectedNode = selected ? nodes.get(selected) || null : null
  const favicon = config?.user_preferences.site_logo || DEFAULT_LOGO

  useEffect(() => {
    updateFavicon(favicon)
  }, [favicon])

  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>加载 config.json 失败</AlertTitle>
          <AlertDescription>{String(configError.message || configError)}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        加载中…
      </div>
    )
  }

  const logo = config.user_preferences.site_logo || DEFAULT_LOGO
  const empty = list.length === 0
  const hasErrors = errors.length > 0
  const sidebarVisibility: SidebarCardVisibility = {
    valueStats: enabled(config.user_preferences.show_value_stats_card),
    onlineTotal: enabled(config.user_preferences.show_online_total_card),
    expiring7Days: enabled(config.user_preferences.show_expiring_7_days_card),
    expiringSoon: enabled(config.user_preferences.show_expiring_soon_card),
  }
  const showSidebar = Object.values(sidebarVisibility).some(Boolean)
  const cardLatencyMonitorName = config.user_preferences.card_latency_monitor_name?.trim() ?? ''

  return (
    <div className="min-h-screen flex flex-col">
      <Background />
      <Navbar
        siteName={config.user_preferences.site_name || '你没设置'}
        logo={logo}
        query={query}
        onQuery={setQuery}
        view={view}
        onView={setView}
        sort={sort}
        onSort={setSort}
        dashboardUrl={config.user_preferences.dashboard_url}
        defaultColorMode={config.user_preferences.default_color_mode}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {!empty && (
          <RegionFilter
            regions={regions.list}
            total={regions.total}
            active={activeRegion}
            onChange={setActiveRegion}
          />
        )}
        {!empty && <TagFilter tags={allTags} active={activeTag} onChange={setActiveTag} />}

        {empty && !hasErrors && (
          <div className="py-24 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm">连接后端中…</span>
          </div>
        )}

        {empty && hasErrors && (
          <div className="py-20 text-center text-muted-foreground">暂无节点</div>
        )}

        {!empty && view === 'cards' && (
          <div className={showSidebar ? 'grid grid-cols-1 gap-4 items-start lg:grid-cols-[260px_minmax(0,1fr)]' : 'grid grid-cols-1 gap-4 items-start'}>
            {showSidebar && (
              <aside className="hidden space-y-4 lg:block">
                <ValueSidebar nodes={costNodes} visibility={sidebarVisibility} />
              </aside>
            )}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
              {list.map(n => (
                <NodeCard
                  key={n.uuid}
                  node={n}
                  pool={pool}
                  cardLatencyMonitorName={cardLatencyMonitorName}
                />
              ))}
            </div>
          </div>
        )}
        {!empty && view === 'table' && <NodeTable nodes={list} onOpen={setSelected} />}
        {!empty && view === 'map' && (
          <Suspense
            fallback={
              <div className="py-24 flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> 加载地图中…
              </div>
            }
          >
            <WorldMap nodes={list} onOpen={setSelected} />
          </Suspense>
        )}

        {hasErrors && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{errors.length} 个后端错误</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                {errors.map((e, i) => (
                  <li key={i}>
                    <b>{e.source}</b>：
                    {e.error instanceof Error ? e.error.message : String(e.error)}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </main>

      <Footer text={config.user_preferences.footer} repo={config.repository} dist_page={config.dist_page}/>

      <NodeDetail
        node={selectedNode}
        onClose={() => setSelected(null)}
        showSource={(config.site_tokens?.length ?? 0) > 1}
        pool={pool}
      />
    </div>
  )
}

function ValueSidebar({ nodes, visibility }: { nodes: Node[]; visibility: SidebarCardVisibility }) {
  const total = nodes.length
  const online = nodes.filter(node => node.online).length
  const expiring = nodes
    .map(node => ({ node, days: remainingDays(node.meta.expireTime) }))
    .filter((item): item is { node: Node; days: number } => item.days != null)
    .sort((a, b) => a.days - b.days)
  const expiringWithin7 = expiring.filter(item => item.days >= 0 && item.days <= 7)

  return (
    <>
      {visibility.valueStats && <ValueStatsCard nodes={nodes} />}
      {visibility.onlineTotal && (
        <SidebarMetricCard
          icon={<Server className="h-4 w-4" />}
          title="在线 / 总节点"
          value={`${online} / ${total}`}
          caption="当前可见节点"
        />
      )}
      {visibility.expiring7Days && (
        <SidebarMetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          title="7 天内到期"
          value={String(expiringWithin7.length)}
          caption="建议优先关注"
        />
      )}
      {visibility.expiringSoon && <ExpiringSoonCard items={expiring.slice(0, 4)} />}
    </>
  )
}

function ValueStatsCard({ nodes }: { nodes: Node[] }) {
  const priced = nodes.filter(node => node.meta.price > 0)
  const unit = primaryUnit(priced)
  const monthlyTotal = priced.reduce(
    (sum, node) => sum + node.meta.price * (30 / billingCycle(node.meta)),
    0,
  )
  const remain = priced.reduce((sum, node) => sum + remainingValue(node.meta), 0)
  const monthlyAverage = priced.length ? monthlyTotal / priced.length : 0
  const yearlyRenewal = monthlyTotal * 12

  return (
    <Card className="liquid-card liquid-card-static relative overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.14)_1px,transparent_1px)] bg-[size:22px_22px] opacity-20" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
          <Coins className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-bold leading-tight">价值统计</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{unit}</div>
        </div>
      </div>

      <div className="glass-panel relative mt-4 rounded-md border border-dashed p-4">
        <ValueRow label="剩余价值" value={money(remain, unit)} strong />
        <ValueRow label="平均月续费" value={money(monthlyAverage, unit)} />
        <ValueRow label="年续费" value={money(yearlyRenewal, unit)} />
      </div>

      <div className="relative mt-3 text-xs text-muted-foreground">
        {priced.length ? `已设置价格的节点 ${priced.length} 台` : '暂无已设置价格的节点'}
      </div>
    </Card>
  )
}

function SidebarMetricCard({
  icon,
  title,
  value,
  caption,
}: {
  icon: ReactNode
  title: string
  value: string
  caption: string
}) {
  return (
    <Card className="liquid-card liquid-card-static relative overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.16)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.12)_1px,transparent_1px)] bg-[size:22px_22px] opacity-20" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-muted-foreground">{title}</div>
          <div className="mt-1 font-mono text-2xl font-bold leading-none">{value}</div>
          <div className="mt-3 text-xs text-muted-foreground">{caption}</div>
        </div>
      </div>
    </Card>
  )
}

function ExpiringSoonCard({ items }: { items: Array<{ node: Node; days: number }> }) {
  return (
    <Card className="liquid-card liquid-card-static relative overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.16)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.12)_1px,transparent_1px)] bg-[size:22px_22px] opacity-20" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
          <CalendarRange className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold leading-tight">临近到期</div>
          <div className="mt-0.5 text-xs text-muted-foreground">显示最需要关注的几台</div>
          {items.length === 0 ? (
            <div className="mt-4 text-sm text-muted-foreground">暂无已设置到期时间的节点</div>
          ) : (
            <div className="mt-4 space-y-2">
              {items.map(({ node, days }) => (
                <div key={node.uuid} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-medium" title={displayName(node)}>
                    {displayName(node)}
                  </span>
                  <span className={days <= 7 ? 'shrink-0 font-mono text-orange-500' : 'shrink-0 font-mono text-muted-foreground'}>
                    {days < 0 ? `已过期 ${Math.abs(days)} 天` : `${days} 天`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function ValueRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={strong ? 'font-mono text-xl font-bold' : 'font-mono text-sm font-semibold'}>
        {value}
      </span>
    </div>
  )
}

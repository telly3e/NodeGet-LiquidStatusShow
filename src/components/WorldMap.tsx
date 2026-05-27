import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import { Card } from './ui/card'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { displayName, distroLogo } from '../utils/derive'
import type { Node } from '../types'

const MAP_W = 900
const MAP_H = 520
const TINY_DEG = 2
const GEO_URL = `${import.meta.env.BASE_URL}world.geo.json`

const HEAT = [
  [187, 247, 208],
  [74, 222, 128],
  [22, 101, 52],
]

const cnameMap = new Map<string, string>()
const knownA2 = new Set<string>()
const tinyCenter = new Map<string, [number, number]>()
let mapPromise: Promise<void> | null = null

interface CountryEntry {
  online: number
  offline: number
  nodes: Node[]
}

interface Props {
  nodes: Node[]
  onOpen?: (uuid: string) => void
}

function ringBbox(ring: number[][]) {
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLng, maxLng, minLat, maxLat, w: maxLng - minLng, h: maxLat - minLat }
}

function tinyMeta(geometry: any): { center: [number, number]; size: number } | null {
  if (!geometry?.coordinates) return null
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  let best: ReturnType<typeof ringBbox> | null = null
  let bestArea = -1
  for (const poly of polygons) {
    const outer = poly[0]
    if (!outer) continue
    const bb = ringBbox(outer)
    const area = bb.w * bb.h
    if (area > bestArea) {
      bestArea = area
      best = bb
    }
  }
  if (!best) return null
  return {
    center: [(best.minLng + best.maxLng) / 2, (best.minLat + best.maxLat) / 2],
    size: Math.max(best.w, best.h),
  }
}

function heatColor(t: number) {
  const x = Math.min(1, Math.max(0, t))
  const seg = x >= 0.5 ? 1 : 0
  const f = (x - seg * 0.5) * 2
  const a = HEAT[seg]
  const b = HEAT[seg + 1]
  const r = Math.round(a[0] + (b[0] - a[0]) * f)
  const g = Math.round(a[1] + (b[1] - a[1]) * f)
  const c = Math.round(a[2] + (b[2] - a[2]) * f)
  return `rgb(${r},${g},${c})`
}

function ensureMap() {
  if (!mapPromise) {
    mapPromise = fetch(GEO_URL)
      .then(r => r.json())
      .then(geo => {
        for (const f of geo.features ?? []) {
          const a2 = f.properties?.name
          if (!a2) continue
          knownA2.add(a2)
          if (f.properties?.cname) cnameMap.set(a2, f.properties.cname)
          const m = tinyMeta(f.geometry)
          if (m && m.size < TINY_DEG) tinyCenter.set(a2, m.center)
        }
        echarts.registerMap('world', geo)
      })
      .catch(err => {
        mapPromise = null
        throw err
      })
  }
  return mapPromise
}

export function WorldMap({ nodes, onOpen }: Props) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [pickedA2, setPickedA2] = useState<string | null>(null)
  const [renderA2, setRenderA2] = useState<string | null>(null)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    let cancelled = false
    ensureMap()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (pickedA2) {
      setRenderA2(pickedA2)
    } else if (renderA2) {
      const t = window.setTimeout(() => setRenderA2(null), 160)
      return () => clearTimeout(t)
    }
  }, [pickedA2, renderA2])

  useEffect(() => {
    const root = document.documentElement
    const update = () => setDark(root.classList.contains('dark'))
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    update()
    return () => observer.disconnect()
  }, [])

  const { byCountry, total } = useMemo(() => {
    const map = new Map<string, CountryEntry>()
    let total = 0
    for (const n of nodes) {
      const a2 = n.meta?.region?.trim().toUpperCase()
      if (!a2 || !/^[A-Z]{2}$/.test(a2)) continue
      total++
      const e = map.get(a2) || { online: 0, offline: 0, nodes: [] }
      if (n.online) e.online++
      else e.offline++
      e.nodes.push(n)
      map.set(a2, e)
    }
    return { byCountry: map, total }
  }, [nodes])

  const dataSig = useMemo(
    () =>
      [...byCountry.entries()]
        .map(([k, v]) => `${k}:${v.online}/${v.offline}`)
        .sort()
        .join(','),
    [byCountry],
  )

  const liveRef = useRef({ byCountry, onOpen })
  useEffect(() => {
    liveRef.current = { byCountry, onOpen }
  })

  const option = useMemo(() => buildOption(byCountry, dark), [dataSig, dark])

  useEffect(() => {
    if (!ready || !wrapRef.current) return
    if (!chartRef.current) {
      chartRef.current = echarts.init(wrapRef.current)
      chartRef.current.on('click', (p: any) => {
        const cur = liveRef.current
        const e = cur.byCountry.get(p.name)
        if (!e) return
        if (e.nodes.length === 1) cur.onOpen?.(e.nodes[0].uuid)
        else setPickedA2(p.name)
      })
    }
    chartRef.current.setOption(option, false)
  }, [ready, option])

  useEffect(() => {
    if (!ready || !chartRef.current) return
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [ready])

  useEffect(() => {
    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  const renderEntry = renderA2 ? byCountry.get(renderA2) ?? null : null

  return (
    <Card className="liquid-card liquid-card-static relative overflow-hidden p-3 sm:p-4">
      <div className="relative z-[1] flex items-center mb-3 px-1">
        <div className="text-sm font-semibold text-foreground/90">地理位置</div>
      </div>

      <div
        className="glass-panel relative z-[1] w-full overflow-hidden rounded-md border bg-[rgba(15,23,42,0.74)] dark:bg-[rgba(2,6,23,0.56)]"
        style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}
      >
        <div ref={wrapRef} className="absolute inset-0" />

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-white/80">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <div>地图加载失败</div>
            <div className="text-xs text-white/50 break-all">{error.message}</div>
          </div>
        )}

        {!error && ready && total === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/55 pointer-events-none">
            没有节点设置过国家代码
          </div>
        )}

        {renderEntry && renderA2 && (
          <NodePopover
            a2={renderA2}
            entry={renderEntry}
            open={pickedA2 === renderA2}
            onPick={uuid => {
              setPickedA2(null)
              onOpen?.(uuid)
            }}
            onClose={() => setPickedA2(null)}
          />
        )}

        <div className="liquid-mini-button absolute bottom-3 right-4 z-10 rounded-md px-2.5 py-1 font-mono text-sm font-semibold tracking-wider text-foreground pointer-events-none uppercase">
          {total} nodes
        </div>
      </div>
    </Card>
  )
}

function buildOption(byCountry: Map<string, CountryEntry>, dark: boolean) {
  const entries = [...byCountry.entries()].filter(([a2]) => knownA2.has(a2))
  const data = entries.map(([a2, e]) => ({ name: a2, value: e.online + e.offline }))
  const max = data.reduce((m, d) => Math.max(m, d.value), 0)
  const visualTextColor = dark ? 'rgba(255,255,255,0.82)' : 'rgba(15,23,42,0.82)'
  const tinyMarkers = entries
    .map(([a2, e]) => {
      const c = tinyCenter.get(a2)
      if (!c) return null
      const v = e.online + e.offline
      const t = max > 0 ? v / max : 0
      return {
        name: a2,
        coord: c,
        value: v,
        symbolSize: 6 + Math.min(8, Math.log2(v + 1) * 3),
        itemStyle: {
          color: heatColor(0.35 + 0.65 * t),
          borderColor: 'rgba(20,22,28,0.85)',
          borderWidth: 0.8,
          shadowBlur: 8,
          shadowColor: 'rgba(34,197,94,0.42)',
        },
      }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)

  return {
    backgroundColor: 'transparent',
    visualMap: {
      type: 'continuous' as const,
      min: 1,
      max: Math.max(max, 1),
      show: max > 0,
      seriesIndex: 0,
      left: 16,
      bottom: 16,
      itemWidth: 10,
      itemHeight: 90,
      orient: 'horizontal' as const,
      text: ['多', '少'],
      textStyle: { color: visualTextColor, fontSize: 10, fontWeight: 600 },
      inRange: { color: ['#bbf7d0', '#4ade80', '#166534'] },
      outOfRange: { color: 'rgba(148,163,184,0.16)' },
      calculable: false,
      hoverLink: true,
    },
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: 'rgba(20,22,28,0.94)',
      borderColor: 'rgba(148,163,184,0.3)',
      borderWidth: 1,
      padding: [6, 10] as [number, number],
      textStyle: { color: '#e5e7eb', fontSize: 12 },
      formatter: (p: any) => {
        const a2 = p.name
        const cname = cnameMap.get(a2)
        const head = cname ? `${cname} <span style="color:#94a3b8">${a2}</span>` : a2
        const e = byCountry.get(a2)
        if (!e) return `<b>${head}</b><br/><span style="color:#94a3b8">无节点</span>`
        const offline = e.offline
          ? ` <span style="color:#94a3b8">· ${e.offline} 离线</span>`
          : ''
        return `<b>${head}</b><br/>${e.online + e.offline} 节点 <span style="color:#34d399">· ${e.online} 在线</span>${offline}`
      },
    },
    series: [
      {
        type: 'map' as const,
        map: 'world',
        roam: false,
        zoom: 1.15,
        layoutCenter: ['50%', '50%'] as [string, string],
        layoutSize: '100%',
        selectedMode: false,
        itemStyle: {
          areaColor: 'rgba(148,163,184,0.16)',
          borderColor: 'rgba(148,163,184,0.32)',
          borderWidth: 0.4,
        },
        emphasis: {
          label: { show: false },
          itemStyle: { areaColor: '#22c55e' },
        },
        label: { show: false },
        data,
        markPoint: {
          symbol: 'circle',
          label: { show: false },
          emphasis: { label: { show: false }, scale: 1.3 },
          data: tinyMarkers,
        },
      },
    ],
  }
}

function NodePopover({
  a2,
  entry,
  open,
  onPick,
  onClose,
}: {
  a2: string
  entry: CountryEntry
  open: boolean
  onPick: (uuid: string) => void
  onClose: () => void
}) {
  const cname = cnameMap.get(a2) || a2
  return (
    <div
      data-state={open ? 'open' : 'closed'}
      className="liquid-menu absolute right-3 top-3 z-20 w-64 rounded-lg border text-popover-foreground overflow-hidden origin-top-right duration-150 fill-mode-forwards data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div key={a2} className="animate-in fade-in-0 duration-100 fill-mode-forwards">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/70">
          <Flag code={a2} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate leading-tight">{cname}</div>
            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
              <span className="text-emerald-500">{entry.online} 在线</span>
              {entry.offline > 0 && <span className="ml-2">{entry.offline} 离线</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="liquid-mini-button -mr-1 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="max-h-72 overflow-auto py-1">
          {entry.nodes.map(n => {
            const logo = distroLogo(n)
            return (
              <button
                key={n.uuid}
                onClick={() => onPick(n.uuid)}
                className="liquid-menu-item group w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
              >
                <StatusDot online={n.online} className="w-1.5 h-1.5 ring-1" />
                {logo && (
                  <img
                    src={logo}
                    alt=""
                    className="w-3.5 h-3.5 shrink-0 object-contain opacity-80"
                    loading="lazy"
                  />
                )}
                <span className="truncate flex-1 text-foreground/90">{displayName(n)}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

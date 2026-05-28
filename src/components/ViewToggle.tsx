import { Check, Globe, LayoutGrid, Table } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { View } from '../types'
import { Button } from './ui/button'

const ITEMS: { value: View; label: string; icon: typeof LayoutGrid }[] = [
  { value: 'cards', label: '卡片', icon: LayoutGrid },
  { value: 'table', label: '表格', icon: Table },
  { value: 'map', label: '地图', icon: Globe },
]

export function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const [open, setOpen] = useState(false)
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const idx = Math.max(0, ITEMS.findIndex(i => i.value === value))
  const current = ITEMS[idx] ?? ITEMS[0]
  const CurrentIcon = current.icon

  useEffect(() => {
    if (open) setShow(true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <div
        className="liquid-segmented relative hidden rounded-md p-1 sm:inline-grid"
        style={{ gridTemplateColumns: `repeat(${ITEMS.length}, 1fr)` }}
      >
        <div
          aria-hidden
          className="liquid-segmented-thumb absolute top-1 bottom-1 left-1 rounded-sm transition-transform duration-300 ease-out"
          style={{
            width: `calc((100% - 0.5rem) / ${ITEMS.length})`,
            transform: `translateX(${idx * 100}%)`,
          }}
        />
        {ITEMS.map(({ value: v, label, icon: Icon }) => (
          <Btn key={v} active={value === v} onClick={() => onChange(v)}>
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </Btn>
        ))}
      </div>

      <div ref={ref} className="relative sm:hidden">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={current.label}
          title={current.label}
        >
          <CurrentIcon className="h-4 w-4" />
        </Button>
        {show && (
          <div
            data-state={open ? 'open' : 'closed'}
            onAnimationEnd={() => {
              if (!open) setShow(false)
            }}
            className="liquid-menu absolute right-0 z-20 mt-1 w-32 origin-top-right rounded-md border py-1 fill-mode-forwards data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          >
            {ITEMS.map(({ value: v, label, icon: Icon }) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  onChange(v)
                  setOpen(false)
                }}
                className="liquid-menu-item flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-sm"
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </span>
                {v === value && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Btn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-3 py-1 text-sm font-medium rounded-sm transition-colors ${
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

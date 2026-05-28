import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
export type DefaultColorMode = Theme | 'auto'

const KEY = 'nodeget.theme'

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveDefault(defaultMode?: string): Theme {
  if (defaultMode === 'light' || defaultMode === 'dark') return defaultMode
  return systemTheme()
}

function initial(defaultMode?: string): Theme {
  const stored = localStorage.getItem(KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return resolveDefault(defaultMode)
}

export function useTheme(defaultMode?: string) {
  const [theme, setTheme] = useState<Theme>(() => initial(defaultMode))

  useEffect(() => {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return

    setTheme(resolveDefault(defaultMode))

    if (defaultMode === 'light' || defaultMode === 'dark') return
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return

    const onChange = () => setTheme(systemTheme())
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [defaultMode])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return {
    theme,
    toggle: () => {
      setTheme(t => {
        const next = t === 'dark' ? 'light' : 'dark'
        localStorage.setItem(KEY, next)
        return next
      })
    },
  }
}

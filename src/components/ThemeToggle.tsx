import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'
import { useTheme } from '../hooks/useTheme'

export function ThemeToggle({ defaultMode }: { defaultMode?: string }) {
  const { theme, toggle } = useTheme(defaultMode)
  const dark = theme === 'dark'
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={dark ? '切换到浅色' : '切换到深色'}
      title={dark ? '浅色模式' : '深色模式'}
      className="theme-liquid-toggle"
      data-theme-state={dark ? 'dark' : 'light'}
    >
      <span className="theme-icon-wrapper">
        <Sun className="theme-toggle-icon theme-toggle-sun h-4 w-4" />
        <Moon className="theme-toggle-icon theme-toggle-moon h-4 w-4" />
      </span>
    </Button>
  )
}

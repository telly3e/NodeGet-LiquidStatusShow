const DEFAULT_REPO = 'https://github.com/telly3e/NodeGet-LiquidStatusShow.git'
const DEFAULT_FOOTER = 'Powered by NodeGet'

export function Footer({ text, repo }: { text?: string, repo?: string, dist_page?: string }) {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <a
          href={repo || DEFAULT_REPO}
          target="_blank"
          rel="noreferrer"
          className="text-center transition-colors hover:text-primary"
        >
          {text || DEFAULT_FOOTER}
        </a>
      </div>
    </footer>
  )
}

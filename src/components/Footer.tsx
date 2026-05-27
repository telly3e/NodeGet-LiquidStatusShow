const DEFAULT_REPO = 'https://github.com/telly3e/NodeGet-LiquidStatusShow.git'
const DEFAULT_FOOTER = 'Powered by NodeGet'
const BITSFLOW_URL = 'https://ccp.bitsflow.cloud/order/forms/a/MzM2Nw=='
const DOKIDOKI_CDN_URL = 'https://www.dooki.cloud/'
const CLOUDFLARE_URL = 'https://www.cloudflare.com/'

export function Footer({
  text,
  repo,
  sponsored = true,
}: {
  text?: string
  repo?: string
  dist_page?: string
  sponsored?: boolean
}) {
  if (!sponsored) {
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

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
          <span>This probe is powerfully driven by</span>
          <a
            href={repo || DEFAULT_REPO}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-black"
          >
            NodeGet
          </a>
          <span className="text-muted-foreground/70">,</span>
          <a href={BITSFLOW_URL} target="_blank" rel="noreferrer" className="inline-flex items-center">
            <img
              src={`${import.meta.env.BASE_URL}footer-logos/bitsflow.png`}
              alt="Bitsflow"
              className="h-5 w-auto max-w-[92px] object-contain"
            />
          </a>
          <span className="text-muted-foreground/70">,</span>
          <a
            href={DOKIDOKI_CDN_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-black"
          >
            <img
              src={`${import.meta.env.BASE_URL}footer-logos/dokidoki-cdn.png`}
              alt="DokiDoki CDN"
              className="h-7 w-7 rounded-md bg-white/90 object-cover p-0.5 shadow-sm ring-1 ring-border/60"
            />
            <span className="font-medium text-black">DokiDoki CDN</span>
          </a>
          <span className="text-muted-foreground/70">and</span>
          <a href={CLOUDFLARE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center">
            <img
              src={`${import.meta.env.BASE_URL}footer-logos/cloudflare.svg`}
              alt="Cloudflare"
              className="h-7 w-auto max-w-[108px] object-contain"
            />
          </a>
        </div>
      </div>
    </footer>
  )
}

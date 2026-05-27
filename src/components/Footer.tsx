const LIQUID_STATUS_REPO = 'https://github.com/telly3e/NodeGet-LiquidStatusShow.git'

const footerLogos = [
  {
    name: 'Bitsflow',
    src: `${import.meta.env.BASE_URL}footer-logos/bitsflow.png`,
    className: 'h-5 w-auto max-w-[92px] object-contain',
  },
  {
    name: 'DokiDoki CDN',
    src: `${import.meta.env.BASE_URL}footer-logos/dokidoki-cdn.png`,
    className: 'h-5 w-auto max-w-[100px] object-contain',
  },
  {
    name: 'Cloudflare',
    src: `${import.meta.env.BASE_URL}footer-logos/cloudflare.svg`,
    className: 'h-4 w-auto max-w-[118px] object-contain dark:invert',
  },
]

export function Footer(_props: { text?: string, repo?: string, dist_page?: string }) {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <a
          href={LIQUID_STATUS_REPO}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center transition-colors hover:text-primary"
        >
          <span>This probe is powerfully driven by</span>
          {footerLogos.map((logo, index) => (
            <span key={logo.name} className="inline-flex items-center gap-2">
              <img src={logo.src} alt={logo.name} className={logo.className} />
              {index < footerLogos.length - 1 && (
                <span className="text-muted-foreground/70">
                  {index === footerLogos.length - 2 ? 'and' : ','}
                </span>
              )}
            </span>
          ))}
        </a>
      </div>
    </footer>
  )
}

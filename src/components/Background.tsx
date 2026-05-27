import { useEffect, useMemo, useRef, useState } from 'react'

interface StarSeed {
  x: number
  y: number
  size: number
  speed: number
  duration: number
  delay: number
}

function makeStars(count = 64) {
  let seed = 19
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  return Array.from({ length: count }, () => {
    const isStatic = rand() < 0.3
    return {
      x: rand() * 100,
      y: rand() * 100,
      size: isStatic ? 1 + rand() : 1 + rand() * 2,
      speed: isStatic ? 0 : 0.2 + rand() * 0.6,
      duration: 2 + rand() * 4,
      delay: rand() * 5,
    }
  })
}

export function Background() {
  const stars = useMemo(() => makeStars(), [])
  const refs = useRef<Array<HTMLSpanElement | null>>([])
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()

    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!dark) return

    let frame = 0
    let lastY = window.scrollY

    const paint = () => {
      frame = 0
      const y = window.scrollY
      const velocity = y - lastY
      const stretch = Math.max(1, Math.min(1 + Math.abs(velocity) * 0.035, 3.8))
      lastY = y

      stars.forEach((star, index) => {
        const el = refs.current[index]
        if (!el) return
        if (star.speed === 0) {
          el.style.transform = 'scaleY(1)'
          return
        }

        let top = (star.y - y * star.speed * 0.05) % 100
        if (top < 0) top += 100
        el.style.top = `${top}%`
        el.style.transform = `scaleY(${stretch})`
      })
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }

    paint()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [dark, stars])

  return (
    <div className="fixed inset-0 -z-10 bg-soft" aria-hidden>
      {dark && (
      <div className="starfield">
        {stars.map((star, index) => (
          <span
            key={index}
            ref={el => {
              refs.current[index] = el
            }}
            className="star"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animationDuration: `${star.duration}s`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>
      )}
    </div>
  )
}

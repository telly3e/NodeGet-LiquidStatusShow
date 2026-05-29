import { useEffect, useState } from 'react'
import type { CnyRateMap } from '../utils/currency'

const FRANKFURTER_RATES_URL = 'https://api.frankfurter.dev/v2/rates?base=CNY'
const CACHE_KEY = 'nodeget.cny-exchange-rates'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

interface CachedRates {
  rates: CnyRateMap
  updatedAt: number
}

interface FrankfurterRateRow {
  quote?: string
  rate?: number
}

interface FrankfurterLegacyRatesResponse {
  rates?: CnyRateMap
}

function parseRates(data: FrankfurterRateRow[] | FrankfurterLegacyRatesResponse): CnyRateMap {
  if (Array.isArray(data)) {
    return Object.fromEntries(
      data
        .filter(row => row.quote && Number.isFinite(row.rate))
        .map(row => [String(row.quote).toUpperCase(), Number(row.rate)]),
    )
  }

  return data.rates ?? {}
}

function readCachedRates(): CachedRates | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedRates
    if (!cached.rates || typeof cached.updatedAt !== 'number') return null
    return cached
  } catch {
    return null
  }
}

function writeCachedRates(rates: CnyRateMap) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, updatedAt: Date.now() }))
  } catch {}
}

export function useCnyExchangeRates() {
  const [rates, setRates] = useState<CnyRateMap>(() => readCachedRates()?.rates ?? {})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const cached = readCachedRates()
    const fresh = cached && Date.now() - cached.updatedAt < CACHE_TTL_MS

    if (cached) setRates(cached.rates)
    if (fresh) return

    setLoading(true)
    fetch(FRANKFURTER_RATES_URL)
      .then(response => (response.ok ? response.json() : Promise.reject(response)))
      .then((data: FrankfurterRateRow[] | FrankfurterLegacyRatesResponse) => {
        const nextRates = parseRates(data)
        if (cancelled || Object.keys(nextRates).length === 0) return
        setRates(nextRates)
        writeCachedRates(nextRates)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { rates, loading }
}

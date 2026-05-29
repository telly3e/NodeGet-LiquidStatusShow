export type CnyRateMap = Record<string, number>

const SYMBOL_TO_CODE: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'CNY',
  '￥': 'CNY',
  '₣': 'CHF',
  '₽': 'RUB',
  '₹': 'INR',
  '₫': 'VND',
  '฿': 'THB',
  'CN¥': 'CNY',
  RMB: 'CNY',
  'US$': 'USD',
}

const CODE_TO_SYMBOL: Record<string, string> = {
  CHF: '₣',
  CNY: '¥',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  RUB: '₽',
  THB: '฿',
  USD: '$',
  VND: '₫',
}

export function normalizeCurrencyUnit(unit?: string | null) {
  const code = (unit || '').trim().toUpperCase()
  if (!code) return 'CNY'
  if (SYMBOL_TO_CODE[code]) return SYMBOL_TO_CODE[code]
  return code
}

export function formatMoney(value: number, unit?: string | null) {
  const code = normalizeCurrencyUnit(unit)
  const symbol = CODE_TO_SYMBOL[code]
  if (symbol) return `${symbol}${value.toFixed(2)}`
  return `${value.toFixed(2)} ${code}`
}

export function formatCny(value: number) {
  return `¥${value.toFixed(2)}`
}

export function convertToCny(value: number, unit: string | null | undefined, rates: CnyRateMap) {
  const code = normalizeCurrencyUnit(unit)
  if (code === 'CNY') return value

  const cnyToUnit = rates[code]
  if (!Number.isFinite(cnyToUnit) || cnyToUnit <= 0) return null

  return value / cnyToUnit
}

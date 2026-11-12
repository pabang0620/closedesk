// All money in the server is integer cents. Strings only appear at the PayPal boundary.
export const CURRENCY = 'USD'

export function toCents(value) {
  const text = String(value).trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error(`Invalid money value: ${text}`)
  const negative = text.startsWith('-')
  const [whole, frac = ''] = text.replace('-', '').split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return negative ? -cents : cents
}

export function toValue(cents) {
  if (!Number.isInteger(cents)) throw new Error(`Cents must be an integer: ${cents}`)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export const toAmount = (cents) => ({ currency_code: CURRENCY, value: toValue(cents) })
export const fromAmount = (amount) => (amount ? toCents(amount.value) : 0)

// Percentage of an amount in cents, rounded half up (coupon rule).
export function percentOf(cents, pct) {
  return Math.round((cents * pct) / 100)
}

export const formatUsd = (cents) => `${cents < 0 ? '-' : ''}$${toValue(Math.abs(cents)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

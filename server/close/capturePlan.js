import { AUTH_VALID_MS, HONOR_PERIOD_MS } from './constants.js'

// Decides how an authorization can still be turned into money. Pure, so every branch is tested.
// funding: 'card' | 'paypal'.
export function planCapture({ authCreatedMs, nowMs, funding, status }) {
  const age = nowMs - authCreatedMs
  if (status === 'VOIDED' || status === 'EXPIRED' || age > AUTH_VALID_MS) {
    return { path: 'INVOICE', reason: 'Authorization expired: the sale moves to an invoice and is carried forward.' }
  }
  if (age <= HONOR_PERIOD_MS) return { path: 'CAPTURE', reason: 'Inside the 3 day honor period: capture directly.' }
  if (funding === 'paypal') return { path: 'REAUTH_THEN_CAPTURE', reason: 'Honor period ended: reauthorizing first.' }
  return { path: 'CAPTURE_NOT_GUARANTEED', reason: 'Honor period ended: capture not guaranteed.' }
}

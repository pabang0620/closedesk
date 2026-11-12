// Transaction event codes (PayPal Transaction Search). The model only ever receives the labels.
export const EVENT_CODES = {
  T0006: { label: 'Checkout payment', kind: 'payment' },
  T0007: { label: 'Website payment', kind: 'payment' },
  T1107: { label: 'Payment refund', kind: 'refund' },
  T1108: { label: 'Fee reversal', kind: 'fee_reversal' },
  T1106: { label: 'Reversal of payment initiated by PayPal', kind: 'reversal' },
  T1110: { label: 'Hold on balance for dispute', kind: 'dispute_hold' },
  T1111: { label: 'Dispute hold released', kind: 'dispute_release' },
  T1201: { label: 'Chargeback', kind: 'chargeback' },
  T0200: { label: 'General currency conversion', kind: 'fx' },
  T0201: { label: 'User-initiated currency conversion', kind: 'fx' },
  T0202: { label: 'Currency conversion', kind: 'fx' },
  T0400: { label: 'General withdrawal from PayPal account', kind: 'withdrawal' },
  T0401: { label: 'AutoSweep', kind: 'withdrawal' },
  T0403: { label: 'Withdrawal to bank', kind: 'withdrawal' },
  T2103: { label: 'Reserve hold', kind: 'reserve' },
  T2104: { label: 'Reserve release', kind: 'reserve' },
  T2105: { label: 'Payment review hold', kind: 'review_hold' },
  T2106: { label: 'Payment review release', kind: 'review_hold' },
  T2107: { label: 'Payment review hold', kind: 'review_hold' },
  T2108: { label: 'Payment review release', kind: 'review_hold' },
}

export const eventLabel = (code) => EVENT_CODES[code]?.label || `Event ${code}`
export const eventKind = (code) => EVENT_CODES[code]?.kind || 'other'

export const ACTIONS = {
  REFUND_FULL: { approver: 'owner', movesMoney: true },
  REFUND_PARTIAL: { approver: 'owner', movesMoney: true },
  CAPTURE_AUTH: { approver: 'owner', movesMoney: true },
  VOID_AUTH: { approver: 'owner', movesMoney: false },
  SEND_INVOICE: { approver: 'bookkeeper', movesMoney: false },
  RECORD_PAYMENT: { approver: 'bookkeeper', movesMoney: false },
  JOURNAL_ONLY: { approver: 'bookkeeper', movesMoney: false },
}
export const ACTION_NAMES = Object.keys(ACTIONS)

export const EXCEPTION_CODES = {
  PROMISED_REFUND_MISSING: { rank: 1, title: 'Promised refund never sent' },
  DUPLICATE_PAYMENT: { rank: 2, title: 'Paid twice (found by search)' },
  UNKNOWN_PAYMENT: { rank: 2, title: 'Payment not linked to any order' },
  COUPON_OVERCHARGE: { rank: 3, title: 'Coupon not applied' },
  AMOUNT_MISMATCH: { rank: 3, title: 'Charged amount differs from books' },
  AUTH_NOT_CAPTURED: { rank: 4, title: 'Shipped, hold not captured' },
  CANCELLED_HOLD_OPEN: { rank: 5, title: 'Cancelled, hold still open' },
  SHIPPED_NOT_BILLED: { rank: 6, title: 'Shipped, never billed' },
  INVOICE_PAID_OFFLINE: { rank: 7, title: 'Paid by bank, invoice open' },
}

export const DAY_MS = 86_400_000
export const HONOR_PERIOD_MS = 3 * DAY_MS
export const AUTH_VALID_MS = 29 * DAY_MS
export const DUPLICATE_WINDOW_MS = 10 * 60_000

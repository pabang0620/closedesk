import { toCents, fromAmount } from '../util/money.js'
import { eventKind, eventLabel } from './constants.js'
import { filterToPeriod, parseTag } from './periodTag.js'
import { listAllTransactions, searchAvailable } from '../paypal/reporting.js'

// Normalizes one Transaction Search transaction_details entry into a ledger line.
export function normalizeDetail(detail) {
  const info = detail.transaction_info || {}
  const tag = parseTag(info.custom_field)
  return {
    id: info.transaction_id,
    eventCode: info.transaction_event_code,
    eventLabel: eventLabel(info.transaction_event_code),
    kind: eventKind(info.transaction_event_code),
    amountCents: info.transaction_amount ? fromAmount(info.transaction_amount) : 0,
    feeCents: info.fee_amount ? fromAmount(info.fee_amount) : 0,
    date: info.transaction_initiation_date,
    dateMs: Date.parse(info.transaction_initiation_date),
    status: info.transaction_status,
    customField: info.custom_field || null,
    periodId: tag?.periodId || null,
    cartRef: tag?.cartRef || null,
    referenceId: info.paypal_reference_id || null,
    referenceType: info.paypal_reference_id_type || null,
    invoiceId: info.invoice_id || null,
    payerEmail: detail.payer_info?.email_address || null,
    source: 'transaction-search',
  }
}

// A refund line only counts toward the capture it points to.
export function refundedByCapture(lines) {
  const map = new Map()
  for (const l of lines) {
    if (l.kind === 'refund' && l.referenceId) map.set(l.referenceId, (map.get(l.referenceId) || 0) + Math.abs(l.amountCents))
  }
  return map
}

export function disputedCaptures(lines) {
  return new Set(lines.filter((l) => ['dispute_hold', 'chargeback'].includes(l.kind) && l.referenceId).map((l) => l.referenceId))
}

// Mode A: read everything from Transaction Search, keep only the lines of this period.
async function loadModeA({ paypal, period, nowMs, trace }) {
  const startMs = period.startMs
  const details = await listAllTransactions(paypal, { startMs, endMs: nowMs + 60_000, trace })
  const all = details.map(normalizeDetail)
  const lines = filterToPeriod(all, period.id)
  return {
    mode: 'A',
    badge: `Source: PayPal Transaction Search · ${lines.filter((l) => l.kind === 'payment').length} transactions · ${period.rangeLabel}`,
    lines,
    skippedChecks: [],
    rawCount: all.length,
  }
}

// Mode B: only what the books know. Look up each PayPal order id from the books.
// Payments that no order points at cannot be seen, so the duplicate check is skipped and said so.
async function loadModeB({ paypal, books, period, trace }) {
  const lines = []
  for (const order of books.orders.filter((o) => o.paypalOrderId)) {
    const po = await paypal.getOrder(order.paypalOrderId)
    trace?.({ call: 'GET /v2/checkout/orders/{id}', id: order.paypalOrderId })
    const unit = po.purchase_units[0]
    for (const cap of unit.payments?.captures || []) {
      lines.push({
        id: cap.id, eventCode: 'T0006', eventLabel: eventLabel('T0006'), kind: 'payment', amountCents: toCents(cap.amount.value),
        feeCents: -toCents(cap.seller_receivable_breakdown?.paypal_fee?.value || '0'), date: cap.create_time, dateMs: Date.parse(cap.create_time),
        status: 'S', customField: unit.custom_id || null, periodId: period.id, cartRef: parseTag(unit.custom_id)?.cartRef || order.cartRef,
        referenceId: null, referenceType: null, invoiceId: cap.invoice_id || null, payerEmail: null, source: 'order-lookup',
        captureStatus: cap.status,
      })
    }
  }
  return {
    mode: 'B',
    badge: 'Source: order lookups (Transaction Search not active yet)',
    lines,
    skippedChecks: ['1 check skipped: payments not linked to any order need Transaction Search'],
    rawCount: lines.length,
  }
}

// Chooses the ledger source. Mode A is the default; mode B only when the scope is missing
// or the period is not indexed yet (fewer payments than the period manifest says).
export async function loadLedger({ paypal, books, period, nowMs, trace, forceMode }) {
  if (forceMode !== 'B') {
    const probe = await searchAvailable(paypal, nowMs)
    if (probe.ok) {
      const a = await loadModeA({ paypal, period, nowMs, trace })
      if (forceMode === 'A' || a.lines.length >= period.expectedPayments) return a
    }
  }
  return loadModeB({ paypal, books, period, trace })
}

import { computeBridge, matchedOrders } from './bridge.js'
import { toValue } from '../util/money.js'

// Money PayPal received that the books never booked as sales (a duplicate payment, a coupon that was not applied).
// Refunding it is not a sales return: it is received into Customer overpayments and paid back out of it.
export const OVERPAYMENT_CODES = new Set(['DUPLICATE_PAYMENT', 'UNKNOWN_PAYMENT', 'COUPON_OVERCHARGE'])

// Closing package: executed PayPal ids, the books vs PayPal table, carried items, journal CSV.
export function buildPackage(close) {
  const bridge = computeBridge(close.exceptions)
  const done = close.exceptions.filter((e) => ['resolved', 'carried', 'journal'].includes(e.status))
  const executed = {
    refunds: done.filter((e) => e.resolution?.kind === 'refund').map((e) => ({ exceptionId: e.id, ...e.resolution })),
    captures: done.filter((e) => e.resolution?.kind === 'capture').map((e) => ({ exceptionId: e.id, ...e.resolution })),
    voids: done.filter((e) => e.resolution?.kind === 'void').map((e) => ({ exceptionId: e.id, ...e.resolution })),
    invoices: done.filter((e) => e.resolution?.kind === 'invoice').map((e) => ({ exceptionId: e.id, ...e.resolution })),
    recordedPayments: done.filter((e) => e.resolution?.kind === 'record-payment').map((e) => ({ exceptionId: e.id, ...e.resolution })),
  }
  const idList = [
    ...executed.refunds.map((r) => ({ label: 'Refund', id: r.refundId, amountCents: r.amountCents })),
    ...executed.captures.map((r) => ({ label: 'Capture', id: r.captureId, amountCents: r.amountCents })),
    ...executed.voids.map((r) => ({ label: 'Void', id: r.authId, amountCents: r.releasedCents })),
    ...executed.invoices.map((r) => ({ label: 'Invoice', id: r.invoiceNumber, amountCents: r.amountCents })),
    ...executed.recordedPayments.map((r) => ({ label: 'Invoice payment', id: r.paymentId, amountCents: 0 })),
  ]
  return {
    periodId: close.periodId,
    source: close.ledger?.badge,
    signed: close.signed ? new Date(close.signed.atMs).toISOString() : null,
    matched: matchedOrders(close.books, close.exceptions),
    bridge,
    executed,
    idList,
    carriedForward: close.exceptions.filter((e) => e.status === 'carried').map((e) => ({ exceptionId: e.id, orderNo: e.orderNo, amountCents: e.carriedCents ?? e.amountCents, invoiceNumber: e.resolution?.invoiceNumber, reason: e.resolution?.reason })),
    reconciliation: close.exceptions.map((e) => ({ id: e.id, title: e.title, direction: e.direction, amountCents: e.amountCents, status: e.status })),
    approvals: close.audit,
    journalCsv: journalCsv(close),
  }
}

// QuickBooks Online "journal entries" import columns. Every entry balances to the cent.
export function journalEntries(close) {
  const date = new Date(close.signed?.atMs ?? close.checkedAtMs ?? Date.now()).toISOString().slice(0, 10)
  const entries = []
  let no = 1
  const add = (memo, lines) => entries.push({ no: `${close.periodId}-J${String(no++).padStart(3, '0')}`, date, memo, lines })
  for (const e of close.exceptions) {
    const r = e.resolution
    if (!r) continue
    if (r.kind === 'refund' && OVERPAYMENT_CODES.has(e.code)) {
      add(`Overpayment received (${e.title}, order ${e.orderNo || 'n/a'})`, [['PayPal clearing', r.amountCents, 0], ['Customer overpayments', 0, r.amountCents]])
      add(`Overpayment refunded ${r.refundId} (${e.title})`, [['Customer overpayments', r.amountCents, 0], ['PayPal clearing', 0, r.amountCents]])
    } else if (r.kind === 'refund') add(`Refund ${r.refundId} (${e.title})`, [['Sales returns', r.amountCents, 0], ['PayPal clearing', 0, r.amountCents]])
    if (r.kind === 'capture') add(`Capture ${r.captureId}`, [['PayPal clearing', r.amountCents, 0], ['Accounts receivable', 0, r.amountCents]])
    if (r.kind === 'record-payment') add(`Bank payment recorded on ${r.invoiceNumber}`, [['Bank', e.invoiceAmountCents, 0], ['Accounts receivable', 0, e.invoiceAmountCents]])
  }
  const fees = (close.ledger?.lines || []).filter((l) => l.kind === 'payment').reduce((s, l) => s + Math.abs(l.feeCents), 0)
  if (fees > 0) add('PayPal fees for the period', [['PayPal fees', fees, 0], ['PayPal clearing', 0, fees]])
  return entries
}

export function journalCsv(close) {
  const rows = [['Journal No', 'Journal Date', 'Account Name', 'Debits', 'Credits', 'Description', 'Currency']]
  for (const entry of journalEntries(close)) {
    for (const [account, debit, credit] of entry.lines) {
      rows.push([entry.no, entry.date, account, debit ? toValue(debit) : '', credit ? toValue(credit) : '', entry.memo, 'USD'])
    }
  }
  return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replaceAll('"', '""')}"` : c)).join(',')).join('\n')
}


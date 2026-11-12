import { fromAmount, formatUsd } from '../util/money.js'
import { ACTIONS, DAY_MS, DUPLICATE_WINDOW_MS, EXCEPTION_CODES } from './constants.js'
import { disputedCaptures, refundedByCapture } from './ledger.js'

const WILL_REFUND_GRACE_MS = 2 * DAY_MS

const capturesOf = (poOrder) => poOrder?.purchase_units?.[0]?.payments?.captures || []
const authsOf = (poOrder) => poOrder?.purchase_units?.[0]?.payments?.authorizations || []

function makeException(fields) {
  const meta = EXCEPTION_CODES[fields.code]
  return {
    title: meta.title,
    rank: meta.rank,
    countsAgainstOrder: true,
    direction: 'none',
    amountCents: 0,
    heldCents: 0,
    evidence: [],
    flags: [],
    approver: ACTIONS[fields.proposedAction].approver,
    status: 'open',
    ...fields,
  }
}

// Deterministic detection. Inputs are plain data, so every rule is testable without PayPal.
// ctx: { books, promises, ledger:{mode, lines}, orderStates:Map, invoiceStates:Map, nowMs, knownRefunds:Map }
export function detectExceptions(ctx) {
  const { books, promises, ledger, orderStates, invoiceStates, nowMs } = ctx
  const refunds = refundedByCapture(ledger.lines)
  for (const [id, cents] of ctx.knownRefunds || []) refunds.set(id, Math.max(refunds.get(id) || 0, cents))
  const disputed = disputedCaptures(ledger.lines)
  const linkedIds = new Set()
  const found = []
  const byLine = new Map(ledger.lines.map((l) => [l.id, l]))

  for (const order of books.orders) {
    const po = order.paypalOrderId ? orderStates.get(order.paypalOrderId) : null
    const caps = capturesOf(po).map((c) => ({ id: c.id, cents: fromAmount(c.amount), status: c.status }))
    caps.forEach((c) => linkedIds.add(c.id))
    const paidCents = caps.reduce((s, c) => s + c.cents, 0)
    const refundedCents = caps.reduce((s, c) => s + Math.min(refunds.get(c.id) || 0, c.cents), 0)
    const netCents = paidCents - refundedCents
    const mainCapture = caps[0]
    const isDisputed = caps.some((c) => disputed.has(c.id))
    const base = { orderNo: order.orderNo }

    // E1: the shop said the refund was done (or due) and PayPal shows none.
    for (const p of promises.filter((x) => x.orderNo === order.orderNo && x.type === 'refund')) {
      const due = p.claimsDone || nowMs >= Date.parse(p.at) + WILL_REFUND_GRACE_MS
      if (!due || !mainCapture || refundedCents > 0 || netCents <= 0) continue
      found.push(makeException({
        ...base, key: `refund-promise:${p.id}`, code: 'PROMISED_REFUND_MISSING', direction: 'over', amountCents: netCents,
        captureId: mainCapture.id, proposedAction: 'REFUND_FULL',
        flags: p.mentionedAmountCents != null && p.mentionedAmountCents !== netCents ? ['AMOUNT_REVIEW'] : [],
        evidence: [
          { kind: 'support_quote', text: p.quote, messageId: p.messageId, at: p.at },
          { kind: 'capture', id: mainCapture.id, amountCents: mainCapture.cents, note: 'captured, no refund' },
        ],
        narrative: `Support told the customer "${p.quote}" but PayPal shows capture ${mainCapture.id} with no refund.`,
        disputed: isDisputed,
      }))
    }
    const alreadyRefundPromise = found.some((e) => e.orderNo === order.orderNo && e.code === 'PROMISED_REFUND_MISSING')

    // E3: more was charged than the books say after the coupon.
    if (mainCapture && !alreadyRefundPromise && order.status !== 'cancelled' && refundedCents === 0 && netCents !== order.totalCents) {
      const diff = netCents - order.totalCents
      const couponPromise = promises.find((x) => x.orderNo === order.orderNo && x.type === 'discount')
      if (diff > 0 && order.couponPct > 0) {
        found.push(makeException({
          ...base, key: `coupon:${order.orderNo}`, code: 'COUPON_OVERCHARGE', direction: 'over', amountCents: diff,
          captureId: mainCapture.id, proposedAction: 'REFUND_PARTIAL', disputed: isDisputed,
          evidence: [
            ...(couponPromise ? [{ kind: 'support_quote', text: couponPromise.quote, messageId: couponPromise.messageId, at: couponPromise.at }] : []),
            { kind: 'rule', text: `${order.couponCode}: ${order.couponPct}% off ${formatUsd(order.subtotalCents)} = ${formatUsd(order.discountCents)}, order total ${formatUsd(order.totalCents)}` },
            { kind: 'capture', id: mainCapture.id, amountCents: mainCapture.cents },
          ],
          narrative: `Books total ${formatUsd(order.totalCents)} after ${order.couponCode}, but PayPal captured ${formatUsd(paidCents)}.`,
        }))
      } else if (diff !== 0) {
        found.push(makeException({
          ...base, key: `mismatch:${order.orderNo}`, code: 'AMOUNT_MISMATCH', direction: diff > 0 ? 'over' : 'under', amountCents: Math.abs(diff),
          captureId: mainCapture.id, proposedAction: 'JOURNAL_ONLY', disputed: isDisputed,
          evidence: [{ kind: 'capture', id: mainCapture.id, amountCents: mainCapture.cents }],
          narrative: `Books total ${formatUsd(order.totalCents)}, PayPal net ${formatUsd(netCents)}. No rule explains the gap.`,
        }))
      }
    }

    // E4 / E5: holds that were never captured or released.
    const openAuth = authsOf(po).find((a) => a.status === 'CREATED' || a.status === 'PARTIALLY_CAPTURED')
    if (po && caps.length === 0) {
      if (order.status === 'cancelled') {
        const expired = !openAuth && authsOf(po).every((a) => ['EXPIRED', 'VOIDED'].includes(a.status))
        if (openAuth || expired) {
          const heldCents = openAuth ? fromAmount(openAuth.amount) : fromAmount(authsOf(po)[0]?.amount)
          found.push(makeException({
            ...base, key: `hold:${order.orderNo}`, code: 'CANCELLED_HOLD_OPEN', direction: 'none', heldCents: openAuth ? heldCents : 0,
            authId: openAuth?.id || authsOf(po)[0]?.id, proposedAction: openAuth && !isExpired(openAuth, nowMs) ? 'VOID_AUTH' : 'JOURNAL_ONLY',
            evidence: [{ kind: 'authorization', id: openAuth?.id || authsOf(po)[0]?.id, amountCents: heldCents }],
            narrative: openAuth ? `Customer cancelled, PayPal still holds ${formatUsd(heldCents)}.` : authsOf(po).some((a) => a.status === 'VOIDED') ? 'The hold was already voided in PayPal: nothing is held.' : 'The hold expired on its own.',
          }))
        }
      } else if (order.status === 'shipped') {
        const auth = openAuth || authsOf(po)[0]
        if (auth) {
          found.push(makeException({
            ...base, key: `auth:${order.orderNo}`, code: 'AUTH_NOT_CAPTURED', direction: 'under', amountCents: order.totalCents,
            authId: auth.id, authFunding: po.payment_source?.card ? 'card' : 'paypal',
            proposedAction: openAuth && !isExpired(openAuth, nowMs) ? 'CAPTURE_AUTH' : 'SEND_INVOICE',
            evidence: [{ kind: 'authorization', id: auth.id, amountCents: fromAmount(auth.amount), createdAt: auth.create_time }, { kind: 'books', text: `Order ${order.orderNo} marked shipped` }],
            narrative: `Shipped, but PayPal only holds ${formatUsd(fromAmount(auth.amount))}. Nothing was charged.`,
          }))
        }
      }
    }

    // E6: shipped without any PayPal order. In mode A, look for a stray payment with the same cart first.
    if (!order.paypalOrderId && order.status === 'shipped') {
      const stray = ledger.mode === 'A' ? ledger.lines.find((l) => l.kind === 'payment' && l.cartRef === order.cartRef && !isLinkedElsewhere(l, books, orderStates)) : null
      if (stray && stray.amountCents === order.totalCents) { linkedIds.add(stray.id); continue }
      found.push(makeException({
        ...base, key: `unbilled:${order.orderNo}`, code: 'SHIPPED_NOT_BILLED', direction: 'under', amountCents: order.totalCents, proposedAction: 'SEND_INVOICE',
        evidence: [{ kind: 'books', text: `Order ${order.orderNo} (${order.channel}) shipped, no PayPal order id` }, { kind: 'search', text: ledger.mode === 'A' ? 'No payment with this cart reference in Transaction Search' : 'Transaction Search not used' }],
        narrative: `Shipped ${formatUsd(order.totalCents)} order has no payment anywhere in PayPal.`,
      }))
    }
  }

  // E2: payments Transaction Search returned that no order of the books points at.
  if (ledger.mode === 'A') {
    const stray = ledger.lines.filter((l) => l.kind === 'payment' && l.status === 'S' && !linkedIds.has(l.id))
    for (const line of stray) {
      const remaining = line.amountCents - (refunds.get(line.id) || 0)
      if (remaining <= 0) continue
      const twin = findTwin(line, books, orderStates, ledger)
      const gap = twin ? gapText(Math.abs(line.dateMs - twin.capture.dateMs)) : ''
      const supporting = twin?.order && line.payerEmail && line.payerEmail === twin.order.email ? [{ kind: 'support', text: 'Same buyer e-mail as the first payment (supporting only)' }] : []
      found.push(makeException({
        orderNo: twin?.order.orderNo || null, key: `stray:${line.id}`, code: twin ? 'DUPLICATE_PAYMENT' : 'UNKNOWN_PAYMENT', direction: 'over', amountCents: remaining,
        countsAgainstOrder: false, captureId: line.id, proposedAction: twin ? 'REFUND_FULL' : 'JOURNAL_ONLY',
        disputed: disputed.has(line.id),
        evidence: [
          { kind: 'search_line', id: line.id, amountCents: line.amountCents, at: line.date, text: `${line.eventCode} ${line.eventLabel}` },
          ...(twin ? [
            { kind: 'twin', id: twin.capture.id, text: `Same cart ${line.cartRef}, same amount, ${gap} apart` },
            ...supporting,
          ] : [{ kind: 'search', text: 'No matching order in the books' }]),
        ],
        narrative: twin ? `Payment ${line.id} repeats order ${twin.order.orderNo}: same cart, same amount, ${gap} apart.` : `Payment ${line.id} matches no order in the books.`,
      }))
    }
  }

  // E7: money arrived outside PayPal but the PayPal invoice is still open.
  for (const inv of books.invoices) {
    const state = invoiceStates.get(inv.number)
    if (inv.receivedBy && state && ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAYMENT_PENDING'].includes(state.status)) {
      found.push(makeException({
        orderNo: null, key: `invoice:${inv.number}`, code: 'INVOICE_PAID_OFFLINE', direction: 'none', amountCents: 0, invoiceNumber: inv.number,
        invoiceId: state.id, invoiceAmountCents: inv.amountCents, countsAgainstOrder: false, proposedAction: 'RECORD_PAYMENT',
        evidence: [{ kind: 'books', text: `${inv.number}: ${formatUsd(inv.amountCents)} received by ${inv.receivedBy.replace('_', ' ').toLowerCase()} on ${inv.receivedOn}` }, { kind: 'invoice', id: state.id, text: `PayPal status ${state.status}` }],
        narrative: `${inv.number} was paid by bank transfer but is still open in PayPal.`,
      }))
    }
  }

  found.sort((a, b) => a.rank - b.rank || Number(a.orderNo || 0) - Number(b.orderNo || 0))
  return found.map((e, i) => ({ ...e, id: `E${i + 1}` }))
}

// "2 min" or "45 s": the real gap between the two payments, shown the same way in the evidence and the narrative.
export const gapText = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`)

export function isExpired(auth, nowMs) {
  return auth.status === 'EXPIRED' || (auth.expiration_time && nowMs > Date.parse(auth.expiration_time))
}

function isLinkedElsewhere(line, books, orderStates) {
  return books.orders.some((o) => o.paypalOrderId && capturesOf(orderStates.get(o.paypalOrderId)).some((c) => c.id === line.id))
}

// Duplicate key: same cart reference, same amount, within ten minutes of a payment the books already know.
// E-mail and card digits are never part of the key: card payments may carry no payer e-mail.
export function findTwin(line, books, orderStates, ledger) {
  if (!line.cartRef) return null
  const order = books.orders.find((o) => o.cartRef === line.cartRef && o.paypalOrderId)
  if (!order) return null
  for (const cap of capturesOf(orderStates.get(order.paypalOrderId))) {
    const known = ledger.lines.find((l) => l.id === cap.id)
    if (!known) continue
    if (known.amountCents === line.amountCents && Math.abs(known.dateMs - line.dateMs) <= DUPLICATE_WINDOW_MS) return { order, capture: known }
  }
  return null
}

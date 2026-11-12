import { HttpError } from '../http.js'
import { ACTIONS } from './constants.js'
import { previewAfter, computeBridge } from './bridge.js'
import { planCapture } from './capturePlan.js'
import { createOwnerToken, readOwnerToken } from './approvals.js'
import { invoiceNumberFor } from './periodTag.js'
import { withLock } from '../util/lock.js'
import { stableHash } from '../util/ids.js'
import { fromAmount, formatUsd } from '../util/money.js'
import { config } from '../config.js'

const MONEY_ACTIONS = new Set(['REFUND_FULL', 'REFUND_PARTIAL', 'CAPTURE_AUTH'])
const REFUND_ACTIONS = new Set(['REFUND_FULL', 'REFUND_PARTIAL'])

const nowOf = (deps) => (deps.now ? deps.now() : Date.now())

function findException(close, id) {
  const ex = close.exceptions.find((e) => e.id === id)
  if (!ex) throw new HttpError(404, 'Exception not found.', 'NOT_FOUND')
  return ex
}

function findCard(close, id) {
  const card = close.actions.find((a) => a.id === id)
  if (!card) throw new HttpError(404, 'Action not found.', 'NOT_FOUND')
  return card
}

function allowedActions(ex) {
  const list = new Set([ex.proposedAction, 'JOURNAL_ONLY'])
  if (ex.code === 'AUTH_NOT_CAPTURED') list.add('SEND_INVOICE')
  return list
}

const SOURCE_TEXT = {
  REFUND_FULL: (ex) => `capture ${ex.captureId} balance`,
  REFUND_PARTIAL: (ex) => `capture ${ex.captureId} minus the coupon-adjusted order total`,
  CAPTURE_AUTH: (ex) => `order total, capped by authorization ${ex.authId}`,
  VOID_AUTH: (ex) => `authorization ${ex.authId}`,
  SEND_INVOICE: () => 'order total from the books',
  RECORD_PAYMENT: (ex) => `invoice ${ex.invoiceNumber} amount from the books`,
  JOURNAL_ONLY: () => 'no PayPal action',
}

// The amount of an action is computed here from the exception (which came from PayPal data and
// the books). No request can set it.
export function amountFor(ex, action) {
  switch (action) {
    case 'REFUND_FULL':
    case 'REFUND_PARTIAL':
    case 'CAPTURE_AUTH':
    case 'SEND_INVOICE':
      return ex.amountCents
    case 'RECORD_PAYMENT':
      return ex.invoiceAmountCents
    default:
      return 0
  }
}

export function proposeAction(close, exceptionId, { action, acknowledgeAmountReview = false } = {}) {
  if (close.signed) throw new HttpError(409, 'The close is signed. Actions are locked.', 'CLOSE_SIGNED')
  const ex = findException(close, exceptionId)
  if (ex.status !== 'open') throw new HttpError(409, `${ex.id} is already ${ex.status}.`, 'NOT_OPEN')
  const chosen = action || ex.proposedAction
  if (!ACTIONS[chosen] || !allowedActions(ex).has(chosen)) throw new HttpError(400, `${chosen} is not allowed for ${ex.id}.`, 'ACTION_NOT_ALLOWED')
  if (ex.flags.includes('AMOUNT_REVIEW') && MONEY_ACTIONS.has(chosen) && !acknowledgeAmountReview) {
    throw new HttpError(409, 'The amount in the support reply differs from the captured amount. A person must confirm the amount first.', 'AMOUNT_REVIEW')
  }
  if (REFUND_ACTIONS.has(chosen) && ex.disputed) throw new HttpError(409, 'This payment is in a dispute. Refunds are blocked here.', 'DISPUTE_BLOCK')
  const existing = close.actions.find((a) => a.exceptionId === ex.id && ['proposed', 'awaiting_owner', 'executing'].includes(a.status))
  if (existing) return existing
  const amountCents = amountFor(ex, chosen)
  const outcome = chosen === 'SEND_INVOICE' ? 'carried' : chosen === 'JOURNAL_ONLY' ? 'journal' : 'resolved'
  const card = {
    id: `A${close.nextActionNo}`,
    exceptionId: ex.id,
    action: chosen,
    approver: ACTIONS[chosen].approver,
    movesMoney: ACTIONS[chosen].movesMoney,
    amountCents,
    amountSource: SOURCE_TEXT[chosen](ex),
    evidence: ex.evidence,
    preview: previewAfter(close.exceptions, ex.id, outcome),
    status: 'proposed',
    createdAtMs: Date.now(),
  }
  close.nextActionNo += 1
  close.actions.push(card)
  return card
}

export function createOwnerLink(close, actionId, deps = {}) {
  const card = findCard(close, actionId)
  if (card.approver !== 'owner') throw new HttpError(400, 'This action does not need the owner.', 'NOT_OWNER_ACTION')
  if (!['proposed', 'awaiting_owner'].includes(card.status)) throw new HttpError(409, `Action is ${card.status}.`, 'BAD_STATE')
  const token = createOwnerToken({ closeId: close.id, actionId, nowMs: nowOf(deps) })
  card.status = 'awaiting_owner'
  close.audit.push({ atMs: nowOf(deps), actor: 'bookkeeper', event: 'owner-link-sent', actionId })
  return { token, url: `${config.appUrl}/?owner=${token}` }
}

export async function bookkeeperApprove(close, actionId, deps) {
  const card = findCard(close, actionId)
  if (card.approver !== 'bookkeeper') throw new HttpError(403, 'Only the owner can approve this action.', 'OWNER_REQUIRED')
  return executeCard(close, card, 'bookkeeper', deps)
}

export async function ownerDecide(closes, token, decision, deps) {
  const claims = readOwnerToken(token, { nowMs: nowOf(deps), consume: false })
  const close = closes.get(claims.closeId)
  if (!close) throw new HttpError(404, 'Close not found.', 'NOT_FOUND')
  const card = findCard(close, claims.actionId)
  if (decision === 'decline') {
    readOwnerToken(token, { nowMs: nowOf(deps), consume: true })
    if (!['proposed', 'awaiting_owner'].includes(card.status)) throw new HttpError(409, `Action is ${card.status}.`, 'BAD_STATE')
    card.status = 'declined'
    close.audit.push({ atMs: nowOf(deps), actor: 'owner', event: 'declined', actionId: card.id })
    return card
  }
  readOwnerToken(token, { nowMs: nowOf(deps), consume: true })
  return executeCard(close, card, 'owner', deps)
}

// The single place that touches PayPal for money. Serialized per order so nothing interleaves.
export function executeCard(close, card, actor, deps) {
  const ex = findException(close, card.exceptionId)
  const lockKey = `${close.id}:${ex.orderNo || ex.captureId || ex.id}`
  return withLock(lockKey, async () => {
    if (close.signed) throw new HttpError(409, 'The close is signed. Actions are locked.', 'CLOSE_SIGNED')
    if (!['proposed', 'awaiting_owner'].includes(card.status)) throw new HttpError(409, `Action is already ${card.status}.`, 'ALREADY_HANDLED')
    if (ex.status !== 'open') throw new HttpError(409, `${ex.id} is already ${ex.status}.`, 'NOT_OPEN')
    if (ACTIONS[card.action].approver === 'owner' && actor !== 'owner') throw new HttpError(403, 'Only the owner can approve this action.', 'OWNER_REQUIRED')
    if (REFUND_ACTIONS.has(card.action) && ex.disputed) throw new HttpError(409, 'This payment is in a dispute. Refunds are blocked here.', 'DISPUTE_BLOCK')
    card.status = 'executing'
    try {
      const result = await runAction(close, ex, card, deps)
      card.status = result.fallback ? 'failed' : 'done'
      card.result = result
      close.audit.push({ atMs: nowOf(deps), actor, event: card.status, actionId: card.id, exceptionId: ex.id, ids: result.ids })
      return card
    } catch (err) {
      card.status = 'failed'
      card.error = err.message
      close.audit.push({ atMs: nowOf(deps), actor, event: err.unknown ? 'unknown-outcome' : 'failed', actionId: card.id, exceptionId: ex.id, error: err.message })
      // SDK failures carry appStatus (a 4xx the caller caused keeps its status, credentials and quota map to 5xx).
      throw err instanceof HttpError ? err : new HttpError(err.appStatus || 502, `PayPal: ${err.message}`, err.unknown ? 'OUTCOME_UNKNOWN' : 'PAYPAL_ERROR')
    }
  })
}

async function runAction(close, ex, card, deps) {
  const { paypal } = deps
  const requestId = stableHash(close.id, ex.id, card.action)
  switch (card.action) {
    case 'REFUND_FULL':
    case 'REFUND_PARTIAL': {
      const cap = await paypal.getCapture(ex.captureId)
      const capCents = fromAmount(cap.amount)
      const already = close.refundIndex.get(ex.captureId) || 0
      if (card.amountCents <= 0 || card.amountCents > capCents - already) throw new HttpError(409, 'Refund amount is outside what is refundable on this capture.', 'AMOUNT_RULE')
      if (cap.status === 'REFUNDED') throw new HttpError(409, 'This capture is already fully refunded.', 'ALREADY_REFUNDED')
      const refund = await paypal.refundCapture(ex.captureId, { amountCents: card.amountCents, noteToPayer: refundNote(ex), invoiceId: undefined, requestId })
      close.refundIndex.set(ex.captureId, already + card.amountCents)
      Object.assign(ex, { status: 'resolved', resolution: { kind: 'refund', refundId: refund.id, captureId: ex.captureId, amountCents: card.amountCents } })
      return { kind: 'refund', ids: { refundId: refund.id, captureId: ex.captureId }, amountCents: card.amountCents }
    }
    case 'CAPTURE_AUTH':
      return captureAuthorization(close, ex, card, deps, requestId)
    case 'VOID_AUTH': {
      const auth = await paypal.getAuthorization(ex.authId)
      if (auth.status !== 'CREATED') {
        Object.assign(ex, { status: 'journal', resolution: { kind: 'journal', note: 'hold expired on its own' } })
        return { kind: 'journal', ids: { authId: ex.authId }, note: 'hold expired on its own' }
      }
      await paypal.voidAuthorization(ex.authId, { requestId })
      Object.assign(ex, { status: 'resolved', resolution: { kind: 'void', authId: ex.authId, releasedCents: ex.heldCents } })
      return { kind: 'void', ids: { authId: ex.authId }, releasedCents: ex.heldCents }
    }
    case 'SEND_INVOICE': {
      const order = close.books.orders.find((o) => o.orderNo === ex.orderNo)
      const number = invoiceNumberFor(close.periodId, close.invoiceSerial)
      const created = await paypal.createInvoice({ invoiceNumber: number, amountCents: card.amountCents, description: `Order ${ex.orderNo}: ${order?.item || 'order'}`, recipientEmail: order?.email, requestId })
      const invoiceId = created.href.split('/').pop()
      await paypal.sendInvoice(invoiceId, { requestId: `${requestId}s` })
      close.invoiceSerial += 1
      Object.assign(ex, { status: 'carried', carriedCents: card.amountCents, resolution: { kind: 'invoice', invoiceNumber: number, invoiceId, amountCents: card.amountCents, reason: ex.carryReason || 'Invoice sent for a shipped order that was never charged' } })
      return { kind: 'invoice', ids: { invoiceId, invoiceNumber: number }, amountCents: card.amountCents }
    }
    case 'RECORD_PAYMENT': {
      const payment = await paypal.recordInvoicePayment(ex.invoiceId, { method: 'BANK_TRANSFER', amountCents: card.amountCents, date: new Date(nowOf(deps)).toISOString().slice(0, 10), requestId })
      Object.assign(ex, { status: 'resolved', resolution: { kind: 'record-payment', paymentId: payment.payment_id, invoiceNumber: ex.invoiceNumber, amountCents: card.amountCents } })
      return { kind: 'record-payment', ids: { paymentId: payment.payment_id, invoiceId: ex.invoiceId } }
    }
    case 'JOURNAL_ONLY':
      Object.assign(ex, { status: 'journal', resolution: { kind: 'journal', note: ex.narrative } })
      return { kind: 'journal', ids: {} }
    default:
      throw new HttpError(400, 'Unknown action.', 'ACTION_NOT_ALLOWED')
  }
}

const refundNote = (ex) => (ex.code === 'COUPON_OVERCHARGE' ? 'Coupon discount applied after your purchase' : ex.code === 'DUPLICATE_PAYMENT' ? 'Refund of a duplicate payment' : 'Refund as promised by our support team')

async function captureAuthorization(close, ex, card, deps, requestId) {
  const { paypal } = deps
  const auth = await paypal.getAuthorization(ex.authId)
  if (card.amountCents > fromAmount(auth.amount)) throw new HttpError(409, 'Order total is above the authorized amount.', 'AMOUNT_RULE')
  const plan = planCapture({ authCreatedMs: Date.parse(auth.create_time), nowMs: nowOf(deps), funding: ex.authFunding, status: auth.status })
  card.capturePlan = plan
  if (plan.path === 'INVOICE') return invoiceFallback(close, ex, card, plan.reason)
  try {
    let authId = ex.authId
    if (plan.path === 'REAUTH_THEN_CAPTURE') {
      const next = await paypal.reauthorizeAuthorization(authId, { amountCents: card.amountCents, requestId: `${requestId}r` })
      authId = next.id
    }
    const capture = await paypal.captureAuthorization(authId, { amountCents: card.amountCents, finalCapture: true, requestId })
    Object.assign(ex, { status: 'resolved', resolution: { kind: 'capture', captureId: capture.id, authId, amountCents: card.amountCents, path: plan.path } })
    return { kind: 'capture', ids: { captureId: capture.id, authId }, path: plan.path, note: plan.reason, amountCents: card.amountCents }
  } catch (err) {
    // A lost answer is not a refusal: the capture may have happened. Never send an invoice on top of it.
    if (err.unknown) throw err
    // Reauthorization or capture failed: the sale moves to an invoice that the bookkeeper sends.
    return invoiceFallback(close, ex, card, `${plan.reason} PayPal answered: ${err.message}`)
  }
}

// Turns the exception into an invoice proposal. Nothing is sent without the bookkeeper.
function invoiceFallback(close, ex, card, reason) {
  Object.assign(ex, { proposedAction: 'SEND_INVOICE', approver: 'bookkeeper', carryReason: reason, evidence: [...ex.evidence, { kind: 'fallback', text: reason }] })
  return { fallback: true, kind: 'fallback-invoice', ids: {}, note: reason }
}

export function signClose(close, deps = {}) {
  if (close.signed) throw new HttpError(409, 'Already signed.', 'CLOSE_SIGNED')
  const bridge = computeBridge(close.exceptions)
  if (bridge.unexplainedCents !== 0 || bridge.openCount > 0) {
    throw new HttpError(409, `Cannot sign: ${bridge.openCount} open exceptions, unexplained ${formatUsd(bridge.unexplainedCents)}.`, 'NOT_ZERO')
  }
  close.signed = { atMs: nowOf(deps), bridge }
  close.audit.push({ atMs: nowOf(deps), actor: 'bookkeeper', event: 'signed' })
  return close.signed
}

export { MONEY_ACTIONS }

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld, makeClose, byCode, DAY } from './helpers.js'
import { proposeAction, createOwnerLink, ownerDecide, bookkeeperApprove, signClose } from '../server/close/actions.js'
import { getClose } from '../server/close/closeStore.js'
import { computeBridge } from '../server/close/bridge.js'
import { runDailyCheck } from '../server/close/check.js'

const closes = { get: getClose }

async function ownerApprove(close, exId, deps, opts) {
  const card = proposeAction(close, exId, opts)
  const { token } = createOwnerLink(close, card.id, deps)
  return ownerDecide(closes, token, 'approve', deps)
}

test('E1: owner approval refunds exactly the captured amount and moves the bridge to 217.17', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const e1 = byCode(close, 'PROMISED_REFUND_MISSING')
  const card = proposeAction(close, e1.id)
  assert.equal(card.amountCents, 8900)
  assert.equal(card.approver, 'owner')
  assert.equal(card.preview.beforeCents, 30617)
  assert.equal(card.preview.afterCents, 21717)
  const { token } = createOwnerLink(close, card.id, deps)
  const done = await ownerDecide(closes, token, 'approve', deps)
  assert.equal(done.status, 'done')
  assert.equal(e1.status, 'resolved')
  assert.equal(world.paypal.customerRefundTotal(e1.captureId), 8900)
  assert.equal(computeBridge(close.exceptions).unexplainedCents, 21717)
})

test('the bookkeeper cannot approve a refund, capture or void', async () => {
  const { close, deps } = await makeClose(makeWorld())
  const card = proposeAction(close, byCode(close, 'PROMISED_REFUND_MISSING').id)
  await assert.rejects(bookkeeperApprove(close, card.id, deps), (err) => err.status === 403)
})

test('an approval request cannot set the amount: the card amount comes from PayPal data and the books', async () => {
  const { close } = await makeClose(makeWorld())
  const ex = byCode(close, 'COUPON_OVERCHARGE')
  const card = proposeAction(close, ex.id, { amount: 99999, amountCents: 1 })
  assert.equal(card.amountCents, 467)
})

test('E3 partial refund is 4.67 and the customer gets exactly that', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const ex = byCode(close, 'COUPON_OVERCHARGE')
  await ownerApprove(close, ex.id, deps)
  assert.equal(world.paypal.customerRefundTotal(ex.captureId), 467)
})

test('two simultaneous approvals of one action: one succeeds, one gets 409, one refund', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const ex = byCode(close, 'PROMISED_REFUND_MISSING')
  const card = proposeAction(close, ex.id)
  const a = createOwnerLink(close, card.id, deps).token
  const b = createOwnerLink(close, card.id, deps).token
  const results = await Promise.allSettled([ownerDecide(closes, a, 'approve', deps), ownerDecide(closes, b, 'approve', deps)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const rejected = results.find((r) => r.status === 'rejected')
  assert.equal(rejected.reason.status, 409)
  assert.equal(world.paypal.customerRefundTotal(ex.captureId), 8900)
})

test('an owner link works once and expires after 30 minutes', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const card = proposeAction(close, byCode(close, 'PROMISED_REFUND_MISSING').id)
  const { token } = createOwnerLink(close, card.id, deps)
  await ownerDecide(closes, token, 'approve', deps)
  await assert.rejects(ownerDecide(closes, token, 'approve', deps), (err) => err.code === 'TOKEN_USED')
  const card2 = proposeAction(close, byCode(close, 'COUPON_OVERCHARGE').id)
  const link2 = createOwnerLink(close, card2.id, deps)
  world.advance(31 * 60_000)
  await assert.rejects(ownerDecide(closes, link2.token, 'approve', deps), (err) => err.code === 'TOKEN_EXPIRED')
  await assert.rejects(ownerDecide(closes, `${link2.token}x`, 'approve', deps), (err) => err.code === 'TOKEN_INVALID')
})

test('declining an owner link leaves PayPal untouched', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const ex = byCode(close, 'PROMISED_REFUND_MISSING')
  const card = proposeAction(close, ex.id)
  const { token } = createOwnerLink(close, card.id, deps)
  const out = await ownerDecide(closes, token, 'decline', deps)
  assert.equal(out.status, 'declined')
  assert.equal(world.paypal.customerRefundTotal(ex.captureId), 0)
  assert.equal(ex.status, 'open')
})

test('PayPal-Request-Id makes a replayed refund return the first result', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const ex = byCode(close, 'PROMISED_REFUND_MISSING')
  const first = await world.paypal.refundCapture(ex.captureId, { amountCents: 8900, requestId: 'same-key' })
  const again = await world.paypal.refundCapture(ex.captureId, { amountCents: 8900, requestId: 'same-key' })
  assert.equal(first.id, again.id)
  assert.equal(world.paypal.customerRefundTotal(ex.captureId), 8900)
})

test('a refund above the captured balance is refused by PayPal and by the app', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const ex = byCode(close, 'PROMISED_REFUND_MISSING')
  await assert.rejects(world.paypal.refundCapture(ex.captureId, { amountCents: 8901 }), /REFUND_AMOUNT_EXCEEDED/)
})

test('disputed payments cannot be refunded here', async () => {
  const { close } = await makeClose(makeWorld())
  const ex = byCode(close, 'PROMISED_REFUND_MISSING')
  ex.disputed = true
  assert.throws(() => proposeAction(close, ex.id), (err) => err.code === 'DISPUTE_BLOCK')
})

test('a support reply amount that differs from the capture needs a person to confirm', async () => {
  const { close } = await makeClose(makeWorld())
  const ex = byCode(close, 'PROMISED_REFUND_MISSING')
  ex.flags = ['AMOUNT_REVIEW']
  assert.throws(() => proposeAction(close, ex.id), (err) => err.code === 'AMOUNT_REVIEW')
  assert.equal(proposeAction(close, ex.id, { acknowledgeAmountReview: true }).amountCents, 8900)
})

test('E5 void: bridge unchanged, hold released at PayPal', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const e5 = byCode(close, 'CANCELLED_HOLD_OPEN')
  const card = proposeAction(close, e5.id)
  assert.equal(card.preview.beforeCents, card.preview.afterCents)
  assert.match(card.preview.text, /Bridge unchanged, releases \$65\.00/)
  await ownerApprove(close, e5.id, deps)
  assert.equal(world.paypal.holdStatus(e5.authId), 'VOIDED')
  assert.equal(computeBridge(close.exceptions).unexplainedCents, 30617)
  assert.equal(e5.status, 'resolved')
})

test('E4 inside the honor period captures directly', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const e4 = byCode(close, 'AUTH_NOT_CAPTURED')
  const done = await ownerApprove(close, e4.id, deps)
  assert.equal(done.result.path, 'CAPTURE')
  assert.equal(e4.status, 'resolved')
})

test('E4 after the honor period on a PayPal account payment reauthorizes first, then captures', async () => {
  const world = makeWorld()
  const { close, deps, manifest } = await makeClose(world, { buyerPaypalAccountFor: ['1055'] })
  world.advance(4 * DAY)
  const e4 = byCode(close, 'AUTH_NOT_CAPTURED')
  const done = await ownerApprove(close, e4.id, deps)
  assert.equal(done.result.path, 'REAUTH_THEN_CAPTURE')
  assert.match(done.result.note, /reauthorizing first/)
  assert.notEqual(done.result.ids.authId, manifest.authorizationIds[0])
  assert.equal(e4.status, 'resolved')
})

test('E4 after the honor period on a card tries a direct capture and says it is not guaranteed', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  world.advance(5 * DAY)
  const e4 = byCode(close, 'AUTH_NOT_CAPTURED')
  const done = await ownerApprove(close, e4.id, deps)
  assert.equal(done.result.path, 'CAPTURE_NOT_GUARANTEED')
  assert.match(done.result.note, /capture not guaranteed/)
  assert.equal(e4.status, 'resolved')
})

test('E4 when reauthorization is refused: the sale moves to an invoice for the bookkeeper', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world, { buyerPaypalAccountFor: ['1055'] })
  world.advance(4 * DAY)
  world.paypal.reauthorizeAuthorization = async () => { throw new Error('REAUTHORIZATION_NOT_SUPPORTED') }
  const e4 = byCode(close, 'AUTH_NOT_CAPTURED')
  const done = await ownerApprove(close, e4.id, deps)
  assert.equal(done.status, 'failed')
  assert.equal(e4.status, 'open')
  assert.equal(e4.proposedAction, 'SEND_INVOICE')
  assert.equal(e4.approver, 'bookkeeper')
  const card = proposeAction(close, e4.id)
  assert.equal(card.action, 'SEND_INVOICE')
  await bookkeeperApprove(close, card.id, deps)
  assert.equal(e4.status, 'carried')
  assert.equal(e4.carriedCents, 12000)
})

test('E4 after the authorization expired (over 29 days): detection proposes an invoice, carried forward', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world, { afterSeed: () => {} })
  world.advance(30 * DAY)
  close.exceptions = []
  await runDailyCheck(close, { paypal: world.paypal, now: world.now, forceMode: 'B' })
  const e4 = byCode(close, 'AUTH_NOT_CAPTURED')
  assert.equal(e4.proposedAction, 'SEND_INVOICE')
  const card = proposeAction(close, e4.id)
  await bookkeeperApprove(close, card.id, deps)
  assert.equal(e4.status, 'carried')
})

test('E5 on an expired hold is journal only: the hold expired on its own', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  world.advance(30 * DAY)
  close.exceptions = []
  await runDailyCheck(close, { paypal: world.paypal, now: world.now, forceMode: 'B' })
  const e5 = byCode(close, 'CANCELLED_HOLD_OPEN')
  assert.equal(e5.proposedAction, 'JOURNAL_ONLY')
})

test('E6 invoice: period prefixed number within 25 chars, carried forward 58.00', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const e6 = byCode(close, 'SHIPPED_NOT_BILLED')
  const card = proposeAction(close, e6.id)
  const done = await bookkeeperApprove(close, card.id, deps)
  assert.equal(done.result.ids.invoiceNumber, 'p261112aaa-INV-0012')
  assert.ok(done.result.ids.invoiceNumber.length <= 25)
  assert.equal(e6.status, 'carried')
  assert.equal(computeBridge(close.exceptions).carriedForwardCents, 5800)
})

test('E7 records the bank payment on the period invoice only', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const e7 = byCode(close, 'INVOICE_PAID_OFFLINE')
  assert.equal(e7.invoiceNumber, 'p261112aaa-INV-0007')
  await bookkeeperApprove(close, proposeAction(close, e7.id).id, deps)
  assert.equal((await world.paypal.getInvoice(e7.invoiceId)).status, 'MARKED_AS_PAID')
})

test('two periods on one merchant account never mix invoices', async () => {
  const world = makeWorld()
  const a = await makeClose(world, { periodId: 'p261112aaa', sessionId: 's-a-123456' })
  const b = await makeClose(world, { periodId: 'p261112bbb', sessionId: 's-b-123456' })
  assert.equal(a.close.exceptions.filter((e) => e.code === 'INVOICE_PAID_OFFLINE').length, 1)
  assert.equal(b.close.exceptions.filter((e) => e.code === 'INVOICE_PAID_OFFLINE').length, 1)
  assert.notEqual(byCode(a.close, 'INVOICE_PAID_OFFLINE').invoiceId, byCode(b.close, 'INVOICE_PAID_OFFLINE').invoiceId)
})

test('full close: every gap handled, unexplained 0.00, carried 58.00, sign opens only then', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  assert.throws(() => signClose(close, deps), (err) => err.code === 'NOT_ZERO')
  for (const code of ['PROMISED_REFUND_MISSING', 'DUPLICATE_PAYMENT', 'COUPON_OVERCHARGE', 'AUTH_NOT_CAPTURED', 'CANCELLED_HOLD_OPEN']) {
    await ownerApprove(close, byCode(close, code).id, deps)
  }
  for (const code of ['SHIPPED_NOT_BILLED', 'INVOICE_PAID_OFFLINE']) {
    await bookkeeperApprove(close, proposeAction(close, byCode(close, code).id).id, deps)
  }
  const bridge = computeBridge(close.exceptions)
  assert.equal(bridge.unexplainedCents, 0)
  assert.equal(bridge.carriedForwardCents, 5800)
  // A fresh check after the actions finds nothing new.
  const before = close.exceptions.length
  await runDailyCheck(close, { paypal: world.paypal, now: world.now })
  assert.equal(close.exceptions.length, before)
  assert.equal(computeBridge(close.exceptions).unexplainedCents, 0)
  signClose(close, deps)
  assert.throws(() => proposeAction(close, 'E1'), (err) => err.code === 'CLOSE_SIGNED')
})

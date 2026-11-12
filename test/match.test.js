import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld, makeClose, byCode } from './helpers.js'
import { computeBridge, matchedOrders } from '../server/close/bridge.js'

test('seed period in mode A yields the seven planned exceptions', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  assert.equal(close.ledger.mode, 'A')
  assert.equal(close.exceptions.length, 7)
  assert.deepEqual(close.exceptions.map((e) => e.code), [
    'PROMISED_REFUND_MISSING', 'DUPLICATE_PAYMENT', 'COUPON_OVERCHARGE', 'AUTH_NOT_CAPTURED', 'CANCELLED_HOLD_OPEN', 'SHIPPED_NOT_BILLED', 'INVOICE_PAID_OFFLINE',
  ])
  assert.deepEqual(close.exceptions.map((e) => e.id), ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'])
  assert.match(close.ledger.badge, /18 transactions/)
})

test('bridge numbers: over 128.17, under 178.00, unexplained 306.17, matched 15/20', async () => {
  const { close } = await makeClose(makeWorld())
  const b = computeBridge(close.exceptions)
  assert.equal(b.overCents, 12817)
  assert.equal(b.underCents, 17800)
  assert.equal(b.unexplainedCents, 30617)
  assert.equal(b.heldForCustomersCents, 6500)
  assert.deepEqual(matchedOrders(close.books, close.exceptions), { matched: 15, carried: 0, total: 20 })
})

test('each exception has the planned amount and evidence', async () => {
  const { close } = await makeClose(makeWorld())
  const e1 = byCode(close, 'PROMISED_REFUND_MISSING')
  assert.equal(e1.orderNo, '1042')
  assert.equal(e1.amountCents, 8900)
  assert.match(e1.evidence[0].text, /I've refunded your order/)
  assert.equal(e1.proposedAction, 'REFUND_FULL')
  assert.equal(byCode(close, 'COUPON_OVERCHARGE').amountCents, 467)
  assert.equal(byCode(close, 'COUPON_OVERCHARGE').proposedAction, 'REFUND_PARTIAL')
  assert.equal(byCode(close, 'AUTH_NOT_CAPTURED').amountCents, 12000)
  const e5 = byCode(close, 'CANCELLED_HOLD_OPEN')
  assert.equal(e5.direction, 'none')
  assert.equal(e5.heldCents, 6500)
  assert.equal(byCode(close, 'SHIPPED_NOT_BILLED').amountCents, 5800)
  assert.equal(byCode(close, 'SHIPPED_NOT_BILLED').approver, 'bookkeeper')
})

test('trap sentences never become promises', async () => {
  const { close } = await makeClose(makeWorld())
  const orders = close.promises.map((p) => `${p.orderNo}:${p.type}`)
  assert.deepEqual(orders.sort(), ['1042:refund', '1044:discount', '1047:discount', '1058:cancel'].sort())
  assert.equal(close.exceptions.some((e) => ['1045', '1046', '1048', '1050', '1053', '1057'].includes(e.orderNo)), false)
})

test('correctly applied coupon (order 1044) is not an exception', async () => {
  const { close } = await makeClose(makeWorld())
  assert.equal(close.exceptions.some((e) => e.orderNo === '1044'), false)
})

test('duplicate is found from the unlinked capture: same cart, same amount, within 10 minutes', async () => {
  const world = makeWorld()
  const { close, manifest } = await makeClose(world)
  const dup = byCode(close, 'DUPLICATE_PAYMENT')
  assert.equal(dup.captureId, manifest.duplicateCaptureId)
  assert.equal(dup.amountCents, 3450)
  assert.equal(dup.countsAgainstOrder, false)
})

test('duplicate pairing works when the card payment has no payer e-mail', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const dup = byCode(close, 'DUPLICATE_PAYMENT')
  // The pairing key is cart reference + amount + time. The e-mail is only ever supporting evidence.
  assert.equal(dup.evidence.some((x) => x.kind === 'twin'), true)
  assert.equal(dup.evidence.some((x) => x.kind === 'support'), false)
})

test('a payment 11 minutes after the first is not paired as a duplicate', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  // Rebuild with a late second payment by moving its index time out of the window.
  const dup = byCode(close, 'DUPLICATE_PAYMENT')
  const raw = world.paypal.rawTransactions().find((t) => t.id === dup.captureId)
  raw.createdAt += 11 * 60_000
  world.advance(30 * 60_000)
  close.exceptions = []
  const { runDailyCheck } = await import('../server/close/check.js')
  await runDailyCheck(close, { paypal: world.paypal, now: world.now })
  assert.equal(close.exceptions.some((e) => e.code === 'DUPLICATE_PAYMENT'), false)
  const unknown = close.exceptions.find((e) => e.code === 'UNKNOWN_PAYMENT')
  assert.equal(unknown.proposedAction, 'JOURNAL_ONLY')
})

test('mode B: duplicate check skipped, unexplained 271.67', async () => {
  const { close } = await makeClose(makeWorld(), { forceMode: 'B' })
  assert.equal(close.ledger.mode, 'B')
  assert.equal(close.exceptions.length, 6)
  assert.equal(computeBridge(close.exceptions).unexplainedCents, 27167)
  assert.equal(close.ledger.skippedChecks.length, 1)
  assert.match(close.ledger.badge, /Transaction Search not active yet/)
})

test('missing Transaction Search scope falls back to mode B', async () => {
  const { close } = await makeClose(makeWorld({ options: { searchScope: false } }))
  assert.equal(close.ledger.mode, 'B')
})

test('payments not indexed yet (3 hour delay) fall back to mode B', async () => {
  const world = makeWorld({ options: { searchDelayMs: 3 * 3_600_000 } })
  const { close } = await makeClose(world)
  assert.equal(close.ledger.mode, 'B')
})

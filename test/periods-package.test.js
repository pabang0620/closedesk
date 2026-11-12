import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld, makeClose, byCode, DAY } from './helpers.js'
import { createPeriodManager } from '../server/close/periods.js'
import { proposeAction, createOwnerLink, ownerDecide, bookkeeperApprove } from '../server/close/actions.js'
import { getClose } from '../server/close/closeStore.js'
import { journalEntries, journalCsv, buildPackage } from '../server/close/package.js'
import { readOwnerToken, createOwnerToken } from '../server/close/approvals.js'
import { signClose } from '../server/close/actions.js'

const HOUR = 3_600_000

test('periods: seeded, then ready once Transaction Search shows 18 payments', async () => {
  const world = makeWorld({ options: { searchDelayMs: 3 * HOUR } })
  const mgr = createPeriodManager({ paypal: world.paypal, now: world.now, targetReady: 2 })
  const p = await mgr.seedOne()
  await mgr.refresh()
  assert.equal(p.status, 'seeded')
  world.advance(3 * HOUR + 1000)
  await mgr.refresh()
  assert.equal(p.status, 'ready')
})

test('periods: replenish keeps the target number of fresh periods', async () => {
  const world = makeWorld()
  const mgr = createPeriodManager({ paypal: world.paypal, now: world.now, targetReady: 3 })
  const first = await mgr.replenish()
  assert.equal(first.created.length, 3)
  assert.equal((await mgr.replenish()).created.length, 0)
  assert.equal(mgr.stats().ready.length, 3)
})

test('periods: assignment is once per session, newest ready first, daily cap shows a closed view', async () => {
  const world = makeWorld()
  const mgr = createPeriodManager({ paypal: world.paypal, now: world.now, targetReady: 3, assignPerDay: 2 })
  await mgr.replenish()
  const a = mgr.assign('sess-a').period
  assert.equal(mgr.assign('sess-a').period.id, a.id)
  const b = mgr.assign('sess-b').period
  assert.notEqual(a.id, b.id)
  const capped = mgr.assign('sess-c')
  assert.equal(capped.limited, true)
  assert.equal(capped.period.readOnly, true)
})

test('periods: an unassigned period older than 3 days is discarded, its holds voided, and replaced', async () => {
  const world = makeWorld()
  const mgr = createPeriodManager({ paypal: world.paypal, now: world.now, targetReady: 2, maxAgeDays: 3 })
  await mgr.replenish()
  const old = [...mgr.periods.values()]
  const authIds = old.flatMap((p) => p.manifest.authorizationIds)
  world.advance(3 * DAY + HOUR)
  const out = await mgr.replenish()
  assert.equal(out.discarded.length, 2)
  assert.equal(out.created.length, 2)
  for (const id of authIds) assert.equal(world.paypal.holdStatus(id), 'VOIDED')
  assert.equal(mgr.stats().discarded.length, 2)
  assert.equal(mgr.assign('fresh-session').period.status, 'assigned')
})

test('periods: seeded but not yet indexed is still assignable (the close then runs in mode B)', async () => {
  const world = makeWorld({ options: { searchDelayMs: 3 * HOUR } })
  const mgr = createPeriodManager({ paypal: world.paypal, now: world.now, targetReady: 1 })
  await mgr.replenish()
  assert.equal(mgr.assign('s1').period.status, 'assigned')
})

test('owner tokens: tampering fails and a different secret cannot forge', () => {
  const token = createOwnerToken({ closeId: 'c1', actionId: 'A1' })
  assert.equal(readOwnerToken(token).actionId, 'A1')
  const [body, sig] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ c: 'c1', a: 'A9', n: 'zz', e: Date.now() + 1e6 })).toString('base64url')
  assert.throws(() => readOwnerToken(`${forged}.${sig}`), (e) => e.code === 'TOKEN_INVALID')
  assert.throws(() => readOwnerToken(`${body}.`), (e) => e.code === 'TOKEN_INVALID')
})

test('journal entries balance to the cent and the CSV has QuickBooks columns', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const closes = { get: getClose }
  for (const code of ['PROMISED_REFUND_MISSING', 'COUPON_OVERCHARGE', 'AUTH_NOT_CAPTURED']) {
    const card = proposeAction(close, byCode(close, code).id)
    await ownerDecide(closes, createOwnerLink(close, card.id, deps).token, 'approve', deps)
  }
  await bookkeeperApprove(close, proposeAction(close, byCode(close, 'INVOICE_PAID_OFFLINE').id).id, deps)
  const entries = journalEntries(close)
  assert.ok(entries.length >= 5)
  for (const e of entries) {
    const debit = e.lines.reduce((s, l) => s + l[1], 0)
    const credit = e.lines.reduce((s, l) => s + l[2], 0)
    assert.equal(debit, credit, e.memo)
  }
  const csv = journalCsv(close)
  assert.equal(csv.split('\n')[0], 'Journal No,Journal Date,Account Name,Debits,Credits,Description,Currency')
  assert.match(csv, /Sales returns,89\.00/)
})

test('closing package lists the executed PayPal ids and carried items', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const closes = { get: getClose }
  for (const code of ['PROMISED_REFUND_MISSING', 'DUPLICATE_PAYMENT', 'COUPON_OVERCHARGE', 'AUTH_NOT_CAPTURED', 'CANCELLED_HOLD_OPEN']) {
    const card = proposeAction(close, byCode(close, code).id)
    await ownerDecide(closes, createOwnerLink(close, card.id, deps).token, 'approve', deps)
  }
  for (const code of ['SHIPPED_NOT_BILLED', 'INVOICE_PAID_OFFLINE']) await bookkeeperApprove(close, proposeAction(close, byCode(close, code).id).id, deps)
  signClose(close, deps)
  const pkg = buildPackage(close)
  assert.equal(pkg.executed.refunds.length, 3)
  assert.equal(pkg.executed.captures.length, 1)
  assert.equal(pkg.executed.voids.length, 1)
  assert.equal(pkg.executed.invoices.length, 1)
  assert.equal(pkg.executed.recordedPayments.length, 1)
  assert.equal(pkg.bridge.unexplainedCents, 0)
  assert.equal(pkg.carriedForward[0].amountCents, 5800)
  assert.match(pkg.carriedForward[0].invoiceNumber, /-INV-0012$/)
  assert.deepEqual(pkg.matched, { matched: 19, carried: 1, total: 20 })
  assert.ok(pkg.signed)
  // Four money movements (three refunds, one capture), one released hold, two invoice fixes.
  assert.equal(pkg.executed.refunds.length + pkg.executed.captures.length, 4)
})

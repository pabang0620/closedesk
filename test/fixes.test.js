import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.FORCE_MOCK = '1'
import { makeWorld, makeClose, byCode } from './helpers.js'
import { proposeAction, createOwnerLink, ownerDecide, signClose, bookkeeperApprove } from '../server/close/actions.js'
import { getClose } from '../server/close/closeStore.js'
import { journalEntries, journalCsv } from '../server/close/package.js'
import { seedPeriod, finishSeed } from '../server/close/seed.js'
import { createPeriodManager, NO_PREPARED_PERIOD } from '../server/close/periods.js'
import { savePeriodRecord, loadFinishedRecords } from '../server/close/periodStore.js'
import { studioTables } from '../server/close/view.js'
import { matchedOrders } from '../server/close/bridge.js'
import { explainException } from '../server/agent/explain.js'

async function refundAll(close, deps, codes) {
  const closes = { get: getClose }
  for (const code of codes) {
    const card = proposeAction(close, byCode(close, code).id)
    await ownerDecide(closes, createOwnerLink(close, card.id, deps).token, 'approve', deps)
  }
}

test('journal: E1 is a sales return, E2 and E3 never touch a sales account', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  await refundAll(close, deps, ['PROMISED_REFUND_MISSING', 'DUPLICATE_PAYMENT', 'COUPON_OVERCHARGE'])
  const entries = journalEntries(close)
  const accounts = (re) => entries.filter((e) => re.test(e.memo)).flatMap((e) => e.lines.map((l) => l[0]))
  assert.deepEqual(accounts(/^Refund /), ['Sales returns', 'PayPal clearing'])
  const over = entries.filter((e) => /^Overpayment/.test(e.memo))
  assert.equal(over.length, 4) // a receipt and a refund for each of E2 and E3
  for (const e of over) assert.ok(e.lines.every((l) => ['PayPal clearing', 'Customer overpayments'].includes(l[0])), e.memo)
  const salesReturns = entries.flatMap((e) => e.lines).filter((l) => l[0] === 'Sales returns').reduce((s, l) => s + l[1], 0)
  assert.equal(salesReturns, 8900) // only the real return
  for (const e of entries) assert.equal(e.lines.reduce((s, l) => s + l[1], 0), e.lines.reduce((s, l) => s + l[2], 0), e.memo)
  assert.match(journalCsv(close), /Customer overpayments,34\.50/)
  assert.match(journalCsv(close), /Customer overpayments,,4\.67|Customer overpayments,4\.67/)
})

test('matched orders count a carried order separately', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  await refundAll(close, deps, ['PROMISED_REFUND_MISSING', 'DUPLICATE_PAYMENT', 'COUPON_OVERCHARGE', 'AUTH_NOT_CAPTURED', 'CANCELLED_HOLD_OPEN'])
  for (const code of ['SHIPPED_NOT_BILLED', 'INVOICE_PAID_OFFLINE']) await bookkeeperApprove(close, proposeAction(close, byCode(close, code).id).id, deps)
  assert.deepEqual(matchedOrders(close.books, close.exceptions), { matched: 19, carried: 1, total: 20 })
})

test('E2 evidence and narrative show the same real gap (2 min) and the seed makes it', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const dup = byCode(close, 'DUPLICATE_PAYMENT')
  assert.ok(dup.evidence.some((e) => e.kind === 'twin' && /2 min apart/.test(e.text)))
  assert.match(dup.narrative, /2 min apart/)
  assert.doesNotMatch(dup.narrative, /minutes apart/)
})

test('trace: no line claims a model when none ran, and PayPal reads say what served them', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  assert.equal(close.trace.filter((t) => t.source === 'model').length, 0)
  assert.equal(close.trace.find((t) => t.tool === 'record_promise').source, 'rules (no model key)')
  assert.equal(close.trace.find((t) => t.tool === 'classify_exception').source, 'code')
  assert.ok(close.trace.filter((t) => t.tool === 'list_transactions').every((t) => t.source === 'paypal-mock'))
  assert.ok(close.trace.every((t) => t.source !== 'agent-toolkit'))
})

test('client board is computed from the close: stage and unexplained follow the real state', async () => {
  const world = makeWorld()
  const { close, deps } = await makeClose(world)
  const before = studioTables(close).clients
  assert.deepEqual(before[0], { client: 'Brightloom Candles', stage: 'In progress', unexplained: 306.17 })
  assert.equal(before[1].unexplained, null)
  await refundAll(close, deps, ['PROMISED_REFUND_MISSING', 'DUPLICATE_PAYMENT', 'COUPON_OVERCHARGE', 'AUTH_NOT_CAPTURED', 'CANCELLED_HOLD_OPEN'])
  for (const code of ['SHIPPED_NOT_BILLED', 'INVOICE_PAID_OFFLINE']) await bookkeeperApprove(close, proposeAction(close, byCode(close, code).id).id, deps)
  signClose(close, deps)
  assert.deepEqual(studioTables(close).clients[0], { client: 'Brightloom Candles', stage: 'Signed', unexplained: 0 })
})

// A PayPal double that cannot take card payments (the sandbox account in VERIFY 3) and holds PayPal-account orders for the buyer.
function accountOnlyPaypal(world) {
  const calls = []
  const held = new Map()
  return {
    calls,
    now: world.paypal.now,
    createInvoice: (a) => world.paypal.createInvoice(a),
    sendInvoice: (id) => world.paypal.sendInvoice(id),
    async createOrder(args) {
      calls.push({ op: 'create', source: args.source.kind, invoiceId: args.invoiceId, returnUrl: args.returnUrl })
      if (args.source.kind === 'card') throw Object.assign(new Error('PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING'), { status: 422 })
      const id = `ORD-${calls.length}`
      held.set(id, args)
      return { id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://sandbox.paypal.test/approve?token=${id}` }] }
    },
    async completeOrder(id, intent) {
      calls.push({ op: 'complete', id, intent })
      const args = held.get(id)
      return world.paypal.createOrder({ ...args, source: { kind: 'paypal', email: args.buyerEmail } })
    },
  }
}

test('seed branch: without card processing the seed makes PayPal-account orders, waits for the buyer, then finishes', async () => {
  const world = makeWorld()
  const paypal = accountOnlyPaypal(world)
  const { books, manifest } = await seedPeriod({ paypal, periodId: 'p261112bbb', useCard: false, returnUrl: 'https://app.test/return' })
  assert.ok(paypal.calls.filter((c) => c.op === 'create').every((c) => c.source === 'paypal' && c.returnUrl === 'https://app.test/return'))
  assert.equal(manifest.state, 'awaiting_approval')
  assert.equal(manifest.pending.length, 20) // 19 web orders plus the duplicate
  assert.ok(manifest.pending.every((p) => p.approveUrl.includes('approve')))
  assert.equal(manifest.authorizationIds.length + Object.keys(manifest.captureIds).length, 0)
  assert.equal(paypal.calls.some((c) => c.op === 'complete'), false)
  assert.ok(books.orders.find((o) => o.orderNo === '1042').paypalOrderId)

  const slept = []
  const done = await finishSeed({ paypal, manifest, sleep: async (ms) => slept.push(ms) })
  assert.equal(done.state, 'ready')
  assert.equal(done.pending.length, 0)
  assert.equal(done.authorizationIds.length, 2)
  assert.ok(done.captureIds['1051'] && done.captureIds['1051b'])
  assert.equal(done.duplicateCaptureId, done.captureIds['1051b'])
  assert.deepEqual(slept, [120_000]) // the duplicate comes two minutes after the first 1051
})

test('seed branch: the card path is still the default and needs no approval', async () => {
  const world = makeWorld()
  const { manifest } = await seedPeriod({ paypal: world.paypal, periodId: 'p261112ccc' })
  assert.equal(manifest.state, 'ready')
  assert.equal(manifest.pending.length, 0)
  assert.equal(Object.keys(manifest.captureIds).length, 18)
})

test('startup survival: a seed that throws leaves the manager usable and reports why', async () => {
  const world = makeWorld()
  const paypal = accountOnlyPaypal(world)
  const manager = createPeriodManager({ paypal, useCard: true, now: world.now })
  const result = await manager.safeReplenish() // card seed throws 422, safeReplenish must not
  assert.equal(result, null)
  assert.match(manager.lastError(), /PAYEE_NOT_ENABLED/)
  const sandbox = createPeriodManager({ paypal, useCard: false, now: world.now, periodsDir: path.join(os.tmpdir(), 'closedesk-no-such-dir') })
  await sandbox.safeReplenish()
  assert.equal(sandbox.lastError(), NO_PREPARED_PERIOD)
  assert.equal(sandbox.assign('s1').exhausted, true)
})

test('startup survival: a prepared period file is loaded at start, assigned, and the error clears', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closedesk-periods-'))
  try {
    const world = makeWorld()
    const { books, manifest } = await seedPeriod({ paypal: world.paypal, periodId: 'p261112ddd' })
    savePeriodRecord(dir, { books, manifest })
    savePeriodRecord(dir, { books, manifest: { ...manifest, periodId: 'p261112eee', state: 'awaiting_approval' } })
    fs.writeFileSync(path.join(dir, 'broken.json'), '{nope')
    assert.deepEqual(loadFinishedRecords(dir).map((r) => r.manifest.periodId), ['p261112ddd'])
    const manager = createPeriodManager({ paypal: world.paypal, useCard: false, now: world.now, periodsDir: dir })
    await manager.safeReplenish()
    assert.equal(manager.lastError(), null)
    const { period } = manager.assign('s1')
    assert.equal(period.id, 'p261112ddd')
    assert.equal(period.books.orders.length, 20)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ask the Close Agent why: runs Agent Toolkit reads and traces them as agent-toolkit', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const e1 = byCode(close, 'PROMISED_REFUND_MISSING')
  const call = (name, args) => (name === 'get_order' ? world.paypal.getOrder(args.id) : world.paypal.searchTransactions({ startDate: args.start_date, endDate: args.end_date, transactionId: args.transaction_id, fields: 'all', pageSize: 20 }))
  const before = close.trace.length
  const { reply, events } = await explainException(close, e1.id, { call, now: world.now() })
  assert.deepEqual(events.map((e) => e.tool), ['get_order', 'list_transactions'])
  assert.ok(events.every((e) => e.source === 'agent-toolkit' && e.ok))
  assert.match(reply, /COMPLETED/)
  assert.equal(close.trace.length, before + 2)
  assert.equal(close.trace.at(-1).source, 'agent-toolkit')
  const failing = await explainException(close, e1.id, { call: async () => { throw new Error('403 scope') }, now: world.now() })
  assert.ok(failing.events.every((e) => !e.ok))
  assert.match(failing.reply, /books and the support thread/)
})

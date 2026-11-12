import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld } from './helpers.js'
import { listAllTransactions, splitRange } from '../server/paypal/reporting.js'
import { normalizeDetail } from '../server/close/ledger.js'
import { tagCustomId, parseTag, filterToPeriod, invoiceNumberFor } from '../server/close/periodTag.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR

async function payments(world, n, customId = 'cd:pxx:C-1') {
  for (let i = 0; i < n; i += 1) await world.paypal.createOrder({ intent: 'CAPTURE', amountCents: 1000 + i, customId: i === 0 ? customId : `cd:pxx:C-${i + 1}` })
}

test('Transaction Search response follows the documented schema', async () => {
  const world = makeWorld()
  await payments(world, 1)
  world.advance(1000)
  const res = await world.paypal.searchTransactions({ startDate: new Date(world.now() - DAY).toISOString(), endDate: new Date(world.now()).toISOString(), fields: 'all' })
  for (const key of ['transaction_details', 'account_number', 'start_date', 'end_date', 'last_refreshed_datetime', 'page', 'total_items', 'total_pages', 'links']) assert.ok(key in res, key)
  const info = res.transaction_details[0].transaction_info
  for (const key of ['transaction_id', 'transaction_event_code', 'transaction_initiation_date', 'transaction_amount', 'fee_amount', 'transaction_status', 'custom_field', 'ending_balance']) assert.ok(key in info, key)
  assert.equal(info.transaction_event_code, 'T0006')
  assert.equal(info.transaction_amount.currency_code, 'USD')
  assert.match(info.transaction_initiation_date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+0000$/)
  assert.ok(info.fee_amount.value.startsWith('-'))
  assert.equal(info.custom_field, 'cd:pxx:C-1')
  assert.ok(res.transaction_details[0].payer_info)
})

test('Transaction Search rejects ranges over 31 days and page sizes over 500', async () => {
  const { paypal, now } = makeWorld()
  await assert.rejects(paypal.searchTransactions({ startDate: new Date(now() - 32 * DAY).toISOString(), endDate: new Date(now()).toISOString() }), /DATE_RANGE_TOO_LARGE/)
  await assert.rejects(paypal.searchTransactions({ startDate: new Date(now() - DAY).toISOString(), endDate: new Date(now()).toISOString(), pageSize: 501 }), /INVALID_PARAMETER_VALUE/)
})

test('transactions show up only after the indexing delay', async () => {
  const world = makeWorld({ options: { searchDelayMs: 3 * HOUR } })
  await payments(world, 2)
  const query = () => world.paypal.searchTransactions({ startDate: new Date(world.now() - DAY).toISOString(), endDate: new Date(world.now() + HOUR).toISOString() })
  assert.equal((await query()).total_items, 0)
  world.advance(3 * HOUR + 1)
  assert.equal((await query()).total_items, 2)
})

test('missing scope answers 403 NOT_AUTHORIZED', async () => {
  const { paypal, now } = makeWorld({ options: { searchScope: false } })
  await assert.rejects(paypal.searchTransactions({ startDate: new Date(now() - DAY).toISOString(), endDate: new Date(now()).toISOString() }), (err) => err.status === 403 && err.name === 'NOT_AUTHORIZED')
})

test('listAllTransactions pages through results and splits ranges over 31 days', async () => {
  const world = makeWorld()
  await payments(world, 7)
  world.advance(1000)
  const calls = []
  const details = await listAllTransactions(world.paypal, { startMs: world.now() - 40 * DAY, endMs: world.now() + 1000, statuses: ['S'], pageSize: 3, trace: (c) => calls.push(c) })
  assert.equal(details.length, 7)
  assert.equal(calls.filter((c) => c.count > 0).length, 3) // 3 + 3 + 1
  assert.equal(splitRange(0, 40 * DAY).length, 2)
  assert.equal(splitRange(0, 31 * DAY).length, 1)
})

test('refund line points back at the payment and carries no custom field', async () => {
  const world = makeWorld()
  const order = await world.paypal.createOrder({ intent: 'CAPTURE', amountCents: 2000, customId: 'cd:pxx:C-9' })
  const capId = order.purchase_units[0].payments.captures[0].id
  world.advance(1000)
  await world.paypal.refundCapture(capId, { amountCents: 500 })
  world.advance(1000)
  const details = await listAllTransactions(world.paypal, { startMs: world.now() - DAY, endMs: world.now() + 1000, statuses: ['S'] })
  const refund = normalizeDetail(details.find((d) => d.transaction_info.transaction_event_code === 'T1107'))
  assert.equal(refund.kind, 'refund')
  assert.equal(refund.amountCents, -500)
  assert.equal(refund.referenceId, capId)
  assert.equal(refund.customField, null)
})

test('period filter: other periods and other sessions refunds never leak into this period', async () => {
  const world = makeWorld()
  const mk = async (period, cart, cents) => {
    const o = await world.paypal.createOrder({ intent: 'CAPTURE', amountCents: cents, customId: tagCustomId(period, cart) })
    return o.purchase_units[0].payments.captures[0].id
  }
  const a1 = await mk('paaa', 'C-1', 1000)
  const a2 = await mk('paaa', 'C-2', 2000)
  const b1 = await mk('pbbb', 'C-1', 1000) // same cart ref, same amount, nearly same time, other period
  world.advance(1000)
  await world.paypal.refundCapture(b1, { amountCents: 1000 }) // another judge refunded their own payment
  await world.paypal.refundCapture(a2, { amountCents: 500 })
  world.advance(1000)
  const details = await listAllTransactions(world.paypal, { startMs: world.now() - DAY, endMs: world.now() + 1000, statuses: ['S'] })
  const mine = filterToPeriod(details.map(normalizeDetail), 'paaa')
  assert.deepEqual(mine.map((l) => l.id).sort(), [a1, a2, mine.find((l) => l.kind === 'refund').id].sort())
  assert.equal(mine.filter((l) => l.kind === 'payment').length, 2)
  assert.equal(mine.filter((l) => l.kind === 'refund').length, 1)
  assert.equal(mine.find((l) => l.kind === 'refund').referenceId, a2)
})

test('period tags obey Transaction Search limits and parse back', () => {
  const tag = tagCustomId('p261112abc', 'C-1042')
  assert.equal(tag, 'cd:p261112abc:C-1042')
  assert.ok(tag.length <= 127)
  assert.match(tag, /^[a-zA-Z0-9_'\-., ":;!?|]*$/)
  assert.deepEqual(parseTag(tag), { periodId: 'p261112abc', cartRef: 'C-1042' })
  assert.equal(parseTag('something else'), null)
  assert.throws(() => tagCustomId('bad id', 'C-1'))
  assert.throws(() => tagCustomId('pabc', 'x'.repeat(200)))
})

test('invoice numbers carry the period and stay within 25 characters', () => {
  assert.equal(invoiceNumberFor('p261112abc', 7), 'p261112abc-INV-0007')
  assert.ok(invoiceNumberFor('p261112abc', 12).length <= 25)
  assert.throws(() => invoiceNumberFor('p'.repeat(14), 12345678))
})

test('duplicate invoice numbers are refused by the mock like PayPal does', async () => {
  const { paypal } = makeWorld()
  await paypal.createInvoice({ invoiceNumber: 'pabc-INV-0007', amountCents: 100, description: 'x', recipientEmail: 'a@example.com' })
  await assert.rejects(paypal.createInvoice({ invoiceNumber: 'pabc-INV-0007', amountCents: 100, description: 'x', recipientEmail: 'a@example.com' }), /DUPLICATE_INVOICE_NUMBER/)
})

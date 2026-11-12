import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.FORCE_MOCK = '1'
const { toolkitToolNames, toolkitSchema, callToolkit } = await import('../server/paypal/toolkit.js')
const { closeAgentTools, makeToolRunner } = await import('../server/agent/tools.js')
const { setPaypalForTests } = await import('../server/paypal/index.js')
const { makeWorld, makeClose } = await import('./helpers.js')

test('the toolkit exposes only the read tools this app enabled', () => {
  assert.deepEqual(toolkitToolNames().sort(), ['get_invoice', 'get_order', 'list_transactions', 'search_invoicing'])
  const schema = toolkitSchema('list_transactions')
  assert.ok(schema.input_schema.properties.start_date)
  assert.throws(() => toolkitSchema('create_refund'))
})

test('Claude never gets a PayPal write tool', () => {
  const names = closeAgentTools().map((t) => t.name)
  for (const bad of ['create_refund', 'capture_order', 'send_invoice', 'create_invoice', 'void_authorization', 'record_payment_for_invoice', 'propose_fix']) assert.equal(names.includes(bad), false, bad)
  assert.ok(names.includes('list_transactions'))
  assert.ok(names.includes('classify_exception'))
  assert.equal(closeAgentTools().find((t) => t.name === 'classify_exception').input_schema.properties.amount, undefined)
})

test('tool runner serves drill-down reads from the mock world with the toolkit argument names', async () => {
  const world = makeWorld()
  setPaypalForTests(world.paypal)
  const { close } = await makeClose(world)
  const run = makeToolRunner(close)
  const search = await run('list_transactions', { start_date: new Date(world.now() - 86_400_000).toISOString(), end_date: new Date(world.now()).toISOString(), transaction_status: 'S' })
  assert.ok(search.total_items >= 18)
  const orderId = close.books.orders[0].paypalOrderId
  assert.equal((await run('get_order', { id: orderId })).id, orderId)
  const inv = await run('search_invoicing', { resource_type: 'invoice', invoice_filters: { invoice_number: close.books.invoices[0].number } })
  assert.equal(inv.items.length, 1)
  const out = await run('classify_exception', { ref: 'E1', hypothesis: 'Promised refund missing' })
  assert.equal(out.ok, true)
  await assert.rejects(run('create_refund', { capture_id: 'X' }), /not enabled/)
  assert.equal((await callToolkit('get_order', { id: orderId })).id, orderId)
})

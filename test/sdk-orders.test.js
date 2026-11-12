import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeAdapter, json, money } from './sdk-helpers.js'

const args = { intent: 'CAPTURE', amountCents: 2400, customId: 'cd:p261112aaa:C-1041', invoiceId: 'p261112aaa-1041' }

test('create order, PayPal account: sends payment_source.paypal with a return url and stops at the approve link', async () => {
  const ctx = makeAdapter((call) => json(201, { id: 'ORD9', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://sandbox.paypal.com/checkoutnow?token=ORD9', method: 'GET' }] }))
  const res = await ctx.paypal.createOrder({ ...args, source: { kind: 'paypal', email: 'b@example.com' }, returnUrl: 'https://app.test/back' })
  assert.equal(res.status, 'PAYER_ACTION_REQUIRED')
  assert.equal(res.links[0].rel, 'payer-action')
  const [create] = ctx.fake.at('POST', '/v2/checkout/orders')
  assert.equal(create.body.payment_source.card, undefined)
  assert.equal(create.body.payment_source.paypal.experience_context.return_url, 'https://app.test/back')
  assert.equal(create.body.payment_source.paypal.experience_context.user_action, 'PAY_NOW')
  assert.equal(ctx.fake.calls.length, 1) // no authorize or capture before the buyer approved
})

test('complete order after buyer approval: captures (CAPTURE) or authorizes (AUTHORIZE) once, with a body', async () => {
  const route = (call) => {
    if (call.method === 'GET') return json(200, { id: 'ORD9', status: 'APPROVED' })
    if (call.path.endsWith('/capture')) return json(201, { id: 'ORD9', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: money('24.00') }] } }] })
    return json(201, { id: 'ORD9', status: 'COMPLETED', purchase_units: [{ payments: { authorizations: [{ id: 'AUTH1', status: 'CREATED', amount: money('24.00') }] } }] })
  }
  const cap = makeAdapter(route)
  const captured = await cap.paypal.completeOrder('ORD9', 'CAPTURE')
  assert.equal(captured.purchase_units[0].payments.captures[0].id, 'CAP1')
  assert.deepEqual(cap.fake.at('POST', '/v2/checkout/orders/ORD9/capture')[0].body, {})
  const auth = makeAdapter(route)
  const authorized = await auth.paypal.completeOrder('ORD9', 'AUTHORIZE')
  assert.equal(authorized.purchase_units[0].payments.authorizations[0].id, 'AUTH1')
  assert.equal(auth.fake.at('POST', '/v2/checkout/orders/ORD9/authorize').length, 1)
})

test('create order, card: the card source is used only when asked for', async () => {
  const ctx = makeAdapter(() => json(201, { id: 'ORD1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C', status: 'COMPLETED' }] } }] }))
  await ctx.paypal.createOrder({ ...args, source: { kind: 'card' } })
  assert.ok(ctx.fake.at('POST', '/v2/checkout/orders')[0].body.payment_source.card)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld, makeClose, byCode, DAY } from './helpers.js'
import { proposeAction, createOwnerLink, ownerDecide } from '../server/close/actions.js'
import { getClose } from '../server/close/closeStore.js'
import { stableHash } from '../server/util/ids.js'
import { makeAdapter, json, hang, money, searchPage, errorBody } from './sdk-helpers.js'

const closes = { get: getClose }

async function ownerApprove(close, exId, deps) {
  const card = proposeAction(close, exId)
  const { token } = createOwnerLink(close, card.id, deps)
  return { card, run: () => ownerDecide(closes, token, 'approve', deps) }
}

test('SDK: E1 owner approval refunds through the SDK with the server amount and the action request id', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const e1 = byCode(close, 'PROMISED_REFUND_MISSING')
  const sdk = makeAdapter((call) => (call.method === 'GET'
    ? json(200, { id: e1.captureId, status: 'COMPLETED', amount: money('89.00') })
    : json(201, { id: 'REF-SDK', status: 'COMPLETED' })))
  const { run } = await ownerApprove(close, e1.id, { paypal: sdk.paypal, now: world.now })
  const done = await run()
  assert.equal(done.status, 'done')
  assert.equal(e1.status, 'resolved')
  assert.equal(e1.resolution.refundId, 'REF-SDK')
  const [post] = sdk.fake.at('POST', '/refund')
  assert.deepEqual(post.body.amount, money('89.00'))
  assert.equal(post.headers.get('paypal-request-id'), stableHash(close.id, e1.id, 'REFUND_FULL'))
})

test('SDK: a refund above what is refundable never reaches refundCapturedPayment', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const e1 = byCode(close, 'PROMISED_REFUND_MISSING')
  const sdk = makeAdapter(() => json(200, { id: e1.captureId, status: 'COMPLETED', amount: money('10.00') }))
  const { run } = await ownerApprove(close, e1.id, { paypal: sdk.paypal, now: world.now })
  await assert.rejects(run(), (err) => err.code === 'AMOUNT_RULE')
  assert.equal(sdk.fake.at('POST', '/refund').length, 0)
  assert.equal(sdk.claims.size(), 0)
})

test('SDK: PayPal refusing a refund shows its reason to the approver and keeps its 4xx status', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const e1 = byCode(close, 'PROMISED_REFUND_MISSING')
  const sdk = makeAdapter((call) => (call.method === 'GET'
    ? json(200, { id: e1.captureId, status: 'COMPLETED', amount: money('89.00') })
    : json(422, errorBody('UNPROCESSABLE_ENTITY', 'CAPTURE_FULLY_REFUNDED', 'The capture was fully refunded'))))
  const { run } = await ownerApprove(close, e1.id, { paypal: sdk.paypal, now: world.now })
  await assert.rejects(run(), (err) => err.status === 422 && /fully refunded/.test(err.message))
})

test('SDK: a lost capture answer is recorded as an unknown outcome and never turns into an invoice', async () => {
  const world = makeWorld()
  const { close } = await makeClose(world)
  const e4 = byCode(close, 'AUTH_NOT_CAPTURED')
  const created = new Date(world.now() - DAY).toISOString()
  const sdk = makeAdapter((call, request) => {
    if (call.path.endsWith('/capture')) return hang(request)
    if (call.path.endsWith('/v1/reporting/transactions')) return json(200, searchPage([]))
    return json(200, { id: e4.authId, status: 'CREATED', create_time: created, amount: money('1000.00') })
  })
  const { card, run } = await ownerApprove(close, e4.id, { paypal: sdk.paypal, now: world.now })
  await assert.rejects(run(), (err) => err.code === 'OUTCOME_UNKNOWN' && err.status === 502)
  assert.equal(card.status, 'failed')
  assert.match(card.error, /Outcome unknown/)
  assert.equal(e4.proposedAction, 'CAPTURE_AUTH')
  assert.equal(close.audit.at(-1).event, 'unknown-outcome')
  assert.equal(sdk.fake.calls.filter((c) => c.path.includes('invoic')).length, 0)
})

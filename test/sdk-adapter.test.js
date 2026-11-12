import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeAdapter, json, empty, hang, errorBody, money, searchPage, expectErr, tokenOk } from './sdk-helpers.js'
import { assertSandboxHost, buildSdkClient } from '../server/paypal/sdkClient.js'
import { createLivePaypal } from '../server/paypal/live.js'
import { searchAvailable } from '../server/paypal/reporting.js'

const FORBIDDEN_HEADERS = ['paypal-mock-response', 'paypal-auth-assertion', 'paypal-client-metadata-id', 'paypal-partner-attribution-id']
const refundOk = { id: 'REF1', status: 'COMPLETED' }
const captureOk = { id: 'CAP9', status: 'COMPLETED' }

test('SDK host: the sandbox and a local server pass, the live host is refused', () => {
  assert.equal(assertSandboxHost('https://api-m.sandbox.paypal.com/'), 'https://api-m.sandbox.paypal.com')
  assert.equal(assertSandboxHost('http://localhost:4010'), 'http://localhost:4010')
  assert.throws(() => assertSandboxHost('https://api-m.paypal.com'), /sandbox/)
  assert.throws(() => buildSdkClient({ clientId: 'a', clientSecret: 'b', baseUrl: 'https://api-m.paypal.com' }), /sandbox/)
})

test('SDK live adapter keeps the mock method names and routes invoicing to REST', () => {
  const live = createLivePaypal({ sdk: { getOrder: () => 'sdk' } })
  for (const name of ['createInvoice', 'sendInvoice', 'getInvoice', 'searchInvoices', 'recordInvoicePayment', 'fromAmount']) assert.equal(typeof live[name], 'function')
  assert.equal(live.getOrder(), 'sdk')
})

test('refund: the claim exists when the request leaves, the body is cents from the server, nothing extra is sent', async () => {
  let claimSeen = null
  const ctx = makeAdapter((call) => {
    claimSeen = ctx.claims.get('refund:CAP1:req-1')?.state
    return json(201, refundOk)
  })
  const res = await ctx.paypal.refundCapture('CAP1', { amountCents: 467, noteToPayer: 'Coupon discount applied after your purchase', requestId: 'req-1' })
  assert.equal(claimSeen, 'pending')
  assert.equal(ctx.claims.get('refund:CAP1:req-1').state, 'done')
  assert.equal(res.id, 'REF1')
  const [call] = ctx.fake.at('POST', '/v2/payments/captures/CAP1/refund')
  assert.deepEqual(call.body, { amount: money('4.67'), note_to_payer: 'Coupon discount applied after your purchase' })
  assert.equal(call.headers.get('paypal-request-id'), 'req-1')
  assert.ok(call.headers.get('idempotency-key'))
  assert.equal(call.headers.get('prefer'), 'return=minimal')
  for (const h of FORBIDDEN_HEADERS) assert.equal(call.headers.has(h), false, h)
})

test('refund: a second claim for the same action does not reach PayPal and returns the first result', async () => {
  const ctx = makeAdapter(() => json(201, refundOk))
  const first = await ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' })
  const second = await ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' })
  assert.equal(second.id, first.id)
  assert.equal(ctx.fake.at('POST', '/refund').length, 1)
})

test('refund: two simultaneous claims send one request, the loser is told it is in flight', async () => {
  const ctx = makeAdapter(() => json(201, refundOk))
  const [a, b] = await Promise.allSettled([
    ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' }),
    ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' }),
  ])
  assert.equal(a.status, 'fulfilled')
  assert.equal(b.status, 'rejected')
  assert.equal(b.reason.code, 'DUPLICATE_IN_FLIGHT')
  assert.equal(b.reason.appStatus, 409)
  assert.equal(ctx.fake.at('POST', '/refund').length, 1)
})

test('refund: PayPal refusing the call releases the claim, the reason reaches the caller, a later attempt is allowed', async () => {
  let answer = json(422, errorBody('UNPROCESSABLE_ENTITY', 'REFUND_AMOUNT_EXCEEDED', 'Refund amount is more than the capture'))
  const ctx = makeAdapter(() => answer)
  const err = await expectErr(ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' }))
  assert.equal(err.status, 422)
  assert.equal(err.appStatus, 422)
  assert.equal(err.issue, 'REFUND_AMOUNT_EXCEEDED')
  assert.match(err.message, /Refund amount is more than the capture/)
  assert.equal(ctx.claims.get('refund:CAP1:req-1'), null)
  answer = json(201, refundOk)
  const ok = await ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' })
  assert.equal(ok.id, 'REF1')
  assert.equal(ctx.fake.at('POST', '/refund').length, 2)
})

test('refund: a lost connection re-reads Transaction Search and settles from the refund line', async () => {
  const ctx = makeAdapter((call) => {
    if (call.method === 'POST') throw new Error('socket hang up')
    return json(200, searchPage([{ transaction_id: 'RLINE1', paypal_reference_id: 'CAP1', transaction_event_code: 'T1107', transaction_amount: money('-1.00') }]))
  })
  const res = await ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' })
  assert.equal(res.id, 'RLINE1')
  assert.equal(res.reconciled, true)
  assert.equal(ctx.fake.at('GET', '/v1/reporting/transactions').length, 1)
  assert.equal(ctx.claims.get('refund:CAP1:req-1').state, 'done')
})

test('refund: a lost connection and nothing found stays unknown, never failed, and a repeat re-reads instead of re-sending', async () => {
  const ctx = makeAdapter((call) => {
    if (call.method === 'POST') throw new Error('socket hang up')
    return json(200, searchPage([]))
  })
  const err = await expectErr(ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' }))
  assert.equal(err.code, 'OUTCOME_UNKNOWN')
  assert.equal(err.unknown, true)
  assert.match(err.message, /Outcome unknown/)
  assert.equal(ctx.claims.get('refund:CAP1:req-1').state, 'unknown')
  const again = await expectErr(ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' }))
  assert.equal(again.code, 'OUTCOME_UNKNOWN')
  assert.equal(ctx.fake.at('POST', '/refund').length, 1)
  assert.equal(ctx.fake.at('GET', '/v1/reporting/transactions').length, 2)
})

test('refund: the re-read itself failing is still unknown', async () => {
  const ctx = makeAdapter((call) => {
    if (call.method === 'POST') throw new Error('socket hang up')
    return json(500, {})
  })
  const err = await expectErr(ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' }))
  assert.equal(err.code, 'OUTCOME_UNKNOWN')
  assert.ok(ctx.logged.some((m) => /re-read/.test(m)))
})

test('refund: a request that never left (credential refused) makes no re-read and releases the claim', async () => {
  const ctx = makeAdapter(() => json(201, refundOk), { token: () => json(401, { error: 'invalid_client' }) })
  const err = await expectErr(ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'req-1' }))
  assert.equal(err.appStatus, 502)
  assert.match(err.message, /credentials/)
  assert.equal(ctx.fake.calls.length, 0)
  assert.equal(ctx.claims.get('refund:CAP1:req-1'), null)
})

test('capture: a timeout re-reads the authorization and settles when it is CAPTURED', async () => {
  const ctx = makeAdapter((call, request) => {
    if (call.path.endsWith('/capture')) return hang(request)
    if (call.path.endsWith('/v1/reporting/transactions')) return json(200, searchPage([{ transaction_id: 'CAPTXN', paypal_reference_id: 'AUTH1' }]))
    return json(200, { id: 'AUTH1', status: 'CAPTURED', amount: money('10.00') })
  })
  const res = await ctx.paypal.captureAuthorization('AUTH1', { amountCents: 1000, finalCapture: true, requestId: 'req-c' })
  assert.equal(res.status, 'COMPLETED')
  assert.equal(res.id, 'CAPTXN')
  assert.equal(res.reconciled, true)
  const [post] = ctx.fake.at('POST', '/capture')
  assert.deepEqual(post.body, { amount: money('10.00'), final_capture: true })
  assert.equal(post.headers.get('paypal-request-id'), 'req-c')
  assert.equal(ctx.fake.at('GET', '/v2/payments/authorizations/AUTH1').length, 1)
})

test('capture: an authorization still CREATED after a lost answer stays unknown', async () => {
  const ctx = makeAdapter((call, request) => {
    if (call.path.endsWith('/capture')) return hang(request)
    return json(200, { id: 'AUTH1', status: 'CREATED', amount: money('10.00') })
  })
  const err = await expectErr(ctx.paypal.captureAuthorization('AUTH1', { amountCents: 1000, requestId: 'req-c' }))
  assert.equal(err.code, 'OUTCOME_UNKNOWN')
})

test('capture: an unreadable 2xx body and a body without an id are unknown outcomes, not failures', async () => {
  for (const body of [{ id: 42 }, {}]) {
    const ctx = makeAdapter((call) => (call.method === 'POST' ? json(201, body) : json(200, { id: 'AUTH1', status: 'CAPTURED', amount: money('5.00') })))
    const res = await ctx.paypal.captureAuthorization('AUTH1', { amountCents: 500, requestId: 'r' })
    assert.equal(res.reconciled, true)
    assert.equal(ctx.fake.at('GET', '/v2/payments/authorizations/AUTH1').length, 1)
  }
})

test('capture: a value the SDK refuses to encode sends nothing, re-reads nothing and releases the claim', async () => {
  const ctx = makeAdapter(() => json(201, captureOk))
  const err = await expectErr(ctx.paypal.captureAuthorization(undefined, { amountCents: 500, requestId: 'r' }))
  assert.equal(err.appStatus, 500)
  assert.equal(err.code, 'INTEGRATION_DEFECT')
  assert.equal(ctx.fake.calls.length, 0)
  assert.equal(ctx.claims.size(), 0)
})

test('capture: sends only the fields a sheet row requires', async () => {
  const ctx = makeAdapter(() => json(201, captureOk))
  await ctx.paypal.captureAuthorization('AUTH1', { amountCents: 2550, finalCapture: true, requestId: 'r' })
  const [post] = ctx.fake.at('POST', '/capture')
  assert.deepEqual(Object.keys(post.body).sort(), ['amount', 'final_capture'])
  for (const h of FORBIDDEN_HEADERS) assert.equal(post.headers.has(h), false, h)
  assert.equal(post.headers.get('prefer'), 'return=minimal')
})

test('reauthorize: a lost answer re-reads the authorization; AuthError makes no re-read', async () => {
  const ctx = makeAdapter((call) => {
    if (call.method === 'POST') throw new Error('reset')
    return json(200, { id: 'AUTH1', status: 'CREATED', update_time: new Date(Date.now() + 5000).toISOString(), amount: money('10.00') })
  })
  const res = await ctx.paypal.reauthorizeAuthorization('AUTH1', { amountCents: 1000, requestId: 'r' })
  assert.equal(res.id, 'AUTH1')
  assert.equal(res.reconciled, true)
  const [post] = ctx.fake.at('POST', '/reauthorize')
  assert.deepEqual(post.body, { amount: money('10.00') })
  const never = makeAdapter(() => json(200, {}), { token: () => json(401, { error: 'invalid_client' }) })
  const err = await expectErr(never.paypal.reauthorizeAuthorization('AUTH1', { amountCents: 1000, requestId: 'r' }))
  assert.equal(err.appStatus, 502)
  assert.equal(never.fake.calls.length, 0)
})

test('void: PayPal answering 204 with no body is settled by re-reading VOIDED', async () => {
  const ctx = makeAdapter((call) => (call.method === 'POST' ? empty(204) : json(200, { id: 'AUTH1', status: 'VOIDED' })))
  const res = await ctx.paypal.voidAuthorization('AUTH1', { requestId: 'rv' })
  assert.deepEqual({ id: res.id, status: res.status }, { id: 'AUTH1', status: 'VOIDED' })
  assert.equal(res.reconciled, true)
  const again = await ctx.paypal.voidAuthorization('AUTH1', { requestId: 'rv' })
  assert.equal(again.status, 'VOIDED')
  assert.equal(ctx.fake.at('POST', '/void').length, 1)
})

test('void: a lost connection with the authorization still CREATED stays unknown; AuthError makes no re-read', async () => {
  const ctx = makeAdapter((call) => {
    if (call.method === 'POST') throw new Error('reset')
    return json(200, { id: 'AUTH1', status: 'CREATED' })
  })
  assert.equal((await expectErr(ctx.paypal.voidAuthorization('AUTH1'))).code, 'OUTCOME_UNKNOWN')
  const never = makeAdapter(() => json(200, {}), { token: () => json(401, {}) })
  await expectErr(never.paypal.voidAuthorization('AUTH1'))
  assert.equal(never.fake.calls.length, 0)
})

test('create order: card source, representation back, follow-up capture when not completed, claims per step', async () => {
  const ctx = makeAdapter((call) => {
    if (call.path === '/v2/checkout/orders') return json(201, { id: 'ORD1', status: 'CREATED' })
    return json(201, { id: 'ORD1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP5', status: 'COMPLETED' }] } }] })
  })
  const res = await ctx.paypal.createOrder({ intent: 'CAPTURE', amountCents: 4667, customId: 'p261112aaa.c1', invoiceId: 'p261112aaa-1042', source: { kind: 'card' }, buyerEmail: 'x@example.com' })
  assert.equal(res.purchase_units[0].payments.captures[0].id, 'CAP5')
  const [create] = ctx.fake.at('POST', '/v2/checkout/orders')
  assert.equal(create.headers.get('prefer'), 'return=representation')
  assert.equal(create.body.intent, 'CAPTURE')
  assert.deepEqual(create.body.purchase_units, [{ amount: money('46.67'), custom_id: 'p261112aaa.c1', invoice_id: 'p261112aaa-1042' }])
  assert.equal(create.body.payment_source.card.number, '4111111111111111')
  assert.equal(create.body.payment_source.card.billing_address.country_code, 'US')
  assert.equal(ctx.fake.at('POST', '/v2/checkout/orders/ORD1/capture').length, 1)
  assert.ok(ctx.claims.get('create-order:p261112aaa-1042'))
  assert.ok(ctx.claims.get('capture-order:ORD1'))
})

test('create order: a lost answer cannot be looked up, so it stays unknown and a repeat never calls PayPal again', async () => {
  const ctx = makeAdapter(() => { throw new Error('reset') })
  const args = { intent: 'AUTHORIZE', amountCents: 1000, customId: 'c', invoiceId: 'inv-1', source: { kind: 'card' } }
  assert.equal((await expectErr(ctx.paypal.createOrder(args))).code, 'OUTCOME_UNKNOWN')
  assert.equal((await expectErr(ctx.paypal.createOrder(args))).code, 'OUTCOME_UNKNOWN')
  assert.equal(ctx.fake.calls.length, 1)
})

test('reads: every failure kind maps the same way for every operation', async () => {
  const cases = [
    [() => json(401, errorBody('AUTHENTICATION_FAILURE', 'X', 'x')), 401, 502, /credentials/],
    [() => json(403, errorBody('NOT_AUTHORIZED', 'PERMISSION_DENIED', 'no scope')), 403, 502, /credentials/],
    [() => json(429, errorBody('RATE_LIMIT', 'X', 'x')), 429, 503, /rate limiting/],
    [() => json(500, {}), 500, 502, /PayPal had an error/],
    [() => json(404, errorBody('RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Capture not found')), 404, 404, /Capture not found/],
    [() => json(200, { id: 42 }), 502, 502, /unreadable/],
  ]
  for (const [route, status, appStatus, text] of cases) {
    const ctx = makeAdapter(route)
    for (const call of [() => ctx.paypal.getCapture('C1'), () => ctx.paypal.getOrder('O1'), () => ctx.paypal.getAuthorization('A1')]) {
      const err = await expectErr(call())
      assert.equal(err.status, status)
      assert.equal(err.appStatus, appStatus)
      assert.match(err.message, text)
    }
  }
  const down = makeAdapter(() => { throw new Error('ECONNREFUSED') })
  const err = await expectErr(down.paypal.getCapture('C1'))
  assert.equal(err.appStatus, 502)
  assert.match(err.message, /could not be reached/)
  assert.equal(down.fake.calls.length, 1)
})

test('errors: the correlation id reaches the app log and the SDK message never reaches the caller', async () => {
  const ctx = makeAdapter(() => json(422, errorBody('UNPROCESSABLE_ENTITY', 'X', 'Bad amount')))
  const err = await expectErr(ctx.paypal.refundCapture('CAP1', { amountCents: 100, requestId: 'r' }))
  assert.ok(ctx.logged.some((m) => m.includes('debug_id=dbg-1')))
  assert.ok(!/https?:\/\//.test(err.message))
})

test('Transaction Search: query goes out as the SDK wire names, the answer keeps the wire shape, a missing scope is detected', async () => {
  const ctx = makeAdapter((call) => json(200, searchPage([{ transaction_id: 'T1', transaction_amount: money('9.99') }])))
  const res = await ctx.paypal.searchTransactions({ startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-12T00:00:00.000Z', transactionStatus: 'S', fields: 'all', pageSize: 500, page: 2 })
  const [call] = ctx.fake.at('GET', '/v1/reporting/transactions')
  assert.equal(call.query.get('start_date'), '2026-11-01T00:00:00.000Z')
  assert.equal(call.query.get('transaction_status'), 'S')
  assert.equal(call.query.get('fields'), 'all')
  assert.equal(call.query.get('page_size'), '500')
  assert.equal(call.query.get('page'), '2')
  assert.equal(call.query.has('transaction_id'), false)
  assert.equal(res.total_pages, 1)
  assert.equal(res.transaction_details[0].transaction_info.transaction_id, 'T1')

  const denied = makeAdapter(() => json(403, errorBody('NOT_AUTHORIZED', 'PERMISSION_DENIED', 'no scope')))
  assert.deepEqual(await searchAvailable(denied.paypal, Date.now()), { ok: false, reason: 'scope-missing' })
})

test('Balances: asks for USD as of now and returns the wire shape', async () => {
  const ctx = makeAdapter(() => json(200, { balances: [{ currency: 'USD', primary: true, total_balance: money('100.00') }], account_id: 'ACC' }))
  const res = await ctx.paypal.getBalances()
  const [call] = ctx.fake.at('GET', '/v1/reporting/balances')
  assert.equal(call.query.get('currency_code'), 'USD')
  assert.ok(call.query.get('as_of_time'))
  assert.equal(res.balances[0].total_balance.value, '100.00')
})

test('the OAuth token is requested once and reused across calls', async () => {
  let tokens = 0
  const ctx = makeAdapter(() => json(200, { id: 'C1', status: 'COMPLETED', amount: money('1.00') }), { token: () => { tokens += 1; return tokenOk() } })
  await ctx.paypal.getCapture('C1')
  await ctx.paypal.getCapture('C1')
  assert.equal(tokens, 1)
})

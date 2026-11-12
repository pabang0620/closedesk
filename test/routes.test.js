import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
process.env.FORCE_MOCK = '1'
const { createApp } = await import('../server/index.js')

let server
let base
const sid = 'test-session-0001'
const call = async (path, { method = 'GET', body, session = sid } = {}) => {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(session ? { 'x-session-id': session } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => null), res }
}

before(async () => {
  const { app } = await createApp()
  await new Promise((resolve) => { server = app.listen(0, resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

test('HTTP: start, propose, owner link, owner approval, sign flow', async () => {
  const noSession = await call('/close', { session: null })
  assert.equal(noSession.status, 400)
  const started = await call('/close/start', { method: 'POST' })
  assert.equal(started.status, 200)
  assert.equal(started.json.data.bridge.unexplainedCents, 30617)
  assert.equal(started.json.data.ledger.mode, 'A')
  assert.equal(JSON.stringify(started.json).includes('token'), false)
  const again = await call('/close/start', { method: 'POST' })
  assert.equal(again.json.data.closeId, started.json.data.closeId)

  const rejected = await call('/exceptions/E1/propose', { method: 'POST', body: { amount: 1 } })
  assert.equal(rejected.status, 400) // strict body: no amount field is accepted
  const proposed = await call('/exceptions/E1/propose', { method: 'POST', body: {} })
  assert.equal(proposed.json.data.card.amountCents, 8900)

  const denied = await call(`/actions/${proposed.json.data.card.id}/approve`, { method: 'POST' })
  assert.equal(denied.status, 403) // the bookkeeper cannot approve a refund

  const link = await call(`/actions/${proposed.json.data.card.id}/owner-link`, { method: 'POST' })
  const token = new URL(link.json.data.url).searchParams.get('owner')
  const info = await call(`/owner/${token}`, { session: null })
  assert.equal(info.json.data.amountText, '$89.00')
  const decided = await call(`/owner/${token}/decision`, { method: 'POST', body: { decision: 'approve' }, session: null })
  assert.equal(decided.json.data.status, 'done')
  const reuse = await call(`/owner/${token}/decision`, { method: 'POST', body: { decision: 'approve' }, session: null })
  assert.equal(reuse.status, 409)

  const after = await call('/close')
  assert.equal(after.json.data.bridge.unexplainedCents, 21717)
  const early = await call('/close/sign', { method: 'POST' })
  assert.equal(early.status, 409)
})

test('HTTP: another session gets its own period and cannot see this close', async () => {
  const a = await call('/close')
  const b = await call('/close/start', { method: 'POST', session: 'other-session-0002' })
  assert.notEqual(b.json.data.closeId, a.json.data.closeId)
  assert.notEqual(b.json.data.period.id, a.json.data.period.id)
  assert.equal(b.json.data.bridge.unexplainedCents, 30617) // the other judge's refund did not leak in
})

test('HTTP: agent ask answers from the bridge without a model key', async () => {
  const out = await call('/agent/ask', { method: 'POST', body: { question: 'where are we?' } })
  assert.equal(out.json.data.mode, 'mock')
  assert.match(out.json.data.reply, /Unexplained/)
})

test('HTTP: studio data, completeness, journal and studio turn (stand-in model)', async () => {
  const data = await call('/close/studio-data')
  assert.equal(data.json.data.ledger.length, 18)
  assert.equal(data.json.data.orders.length, 20)
  const done = await call('/close/completeness')
  assert.equal(done.json.data.available, true)
  assert.equal(done.json.data.matches, true)
  const csv = await call('/close/journal.csv')
  assert.match(csv.res.headers.get('content-type'), /text\/csv/)
  const turn = await call('/studio/turn', { method: 'POST', body: { request: { input: [{ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'where do we stand?' }] }], tools: [{ name: 'get_close_status', description: 'd', parameters: { type: 'object' } }], responseFormat: { type: 'text' } } } })
  assert.equal(turn.json.data.mode, 'mock')
  assert.equal(turn.json.data.response.output[0].name, 'get_close_status')
  const health = await call('/health', { session: null })
  assert.equal(health.json.data.modes.paypal, 'mock')
})

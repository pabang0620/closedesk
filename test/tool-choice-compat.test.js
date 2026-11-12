import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClaudeExtractor } from '../server/agent/promiseExtractor.js'
import { handleStudioTurn } from '../server/agent/studioTurn.js'
import { compatBody } from '../server/agent/toolChoice.js'

// Fake API that behaves like claude-sonnet-5-5: forced tool_choice is a 400.
const strictClient = (answer) => {
  const requests = []
  return {
    requests,
    messages: {
      create: async (body) => {
        requests.push(body)
        const t = body.tool_choice?.type
        if (t === 'tool' || t === 'any') throw new Error('400 tool_choice: type "tool" and "any" are not supported for this model')
        return answer(body, requests.length)
      },
    },
  }
}
const msg = { role: 'agent', text: "I've refunded your order." }
const toolUse = (name, input) => ({ id: 'm', content: [{ type: 'tool_use', id: 't', name, input }] })
const textOnly = { id: 'm', content: [{ type: 'text', text: 'Sure.' }] }
const studioRequest = (extra) => ({
  input: [{ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'hi' }] }],
  tools: [{ name: 'get_close_status', description: 'd', parameters: { type: 'object' } }],
  responseFormat: { type: 'text' },
  ...extra,
})

test('compatBody never carries forced tool_choice and drops none', () => {
  assert.equal(compatBody({ tools: [{}], tool_choice: { type: 'tool', name: 'x' } }, { name: 'x' }).tool_choice.type, 'auto')
  assert.equal(compatBody({ tools: [{}], tool_choice: { type: 'any' } }, { any: true }).tool_choice.type, 'auto')
  const none = compatBody({ tools: [{}], tool_choice: { type: 'none' } })
  assert.equal('tools' in none, false)
  assert.equal('tool_choice' in none, false)
})

test('extractor: no request carries forced tool_choice against a strict API', async () => {
  const client = strictClient(() => toolUse('record_promise', { type: 'refund', claimsDone: true, quote: 'I have refunded your order.' }))
  const out = await createClaudeExtractor(client, 'm')(msg)
  assert.equal(out.length, 1)
  assert.ok(client.requests.every((r) => r.tool_choice?.type === 'auto'))
})

test('extractor: a text-only answer is retried once with the instruction repeated', async () => {
  const client = strictClient((_, n) => (n === 1 ? textOnly : toolUse('record_promise', { type: 'refund', claimsDone: true, quote: "I've refunded your order." })))
  const out = await createClaudeExtractor(client, 'm')(msg)
  assert.equal(client.requests.length, 2)
  assert.equal(out[0].type, 'refund')
  const count = (s) => s.split('You must answer by calling the tool record_promise.').length - 1
  assert.equal(count(client.requests[1].system), 2)
})

test('extractor: two text-only answers fall back to the rules reader', async () => {
  const client = strictClient(() => textOnly)
  const out = await createClaudeExtractor(client, 'm')(msg)
  assert.equal(client.requests.length, 2)
  assert.ok(Array.isArray(out))
  assert.equal(out[0]?.type, 'refund')
})

test('studio turn: json format and required choice are sent as auto, retried, then stand-in', async () => {
  const jsonReq = studioRequest({ responseFormat: { type: 'json', name: 'answer', schema: { type: 'object', properties: {} } } })
  const ok = strictClient((_, n) => (n === 1 ? textOnly : toolUse('answer', { a: 1 })))
  const live = await handleStudioTurn(jsonReq, { client: ok, record: false })
  assert.equal(live.mode, 'live')
  assert.equal(ok.requests.length, 2)
  assert.ok(ok.requests.every((r) => r.tool_choice.type === 'auto'))

  const bad = strictClient(() => textOnly)
  const out = await handleStudioTurn(studioRequest({ toolChoice: 'required' }), { client: bad, record: false })
  assert.equal(bad.requests.length, 2)
  assert.equal(out.mode, 'mock')
  assert.match(out.label, /required tool/)
  assert.match(bad.requests[0].system, /You must call one of the tools in this turn/)
})

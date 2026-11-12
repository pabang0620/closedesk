import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPromisesRules, validatePromises, mentionedAmountCents, collectPromises } from '../server/close/promises.js'
import { createClaudeExtractor, RECORD_PROMISE_TOOL } from '../server/agent/promiseExtractor.js'

const msg = (text, from = 'agent') => ({ id: 'm1', from, text, at: '2026-11-11T10:00:00.000Z' })
const kinds = (text) => extractPromisesRules(msg(text)).map((p) => `${p.type}:${p.claimsDone}`)

test('real promises are found', () => {
  assert.deepEqual(kinds("I've refunded your order, you'll see it in a few days."), ['refund:true'])
  assert.deepEqual(kinds('Your refund has been processed.'), ['refund:true'])
  assert.deepEqual(kinds("We'll refund you tomorrow."), ['refund:false'])
  assert.deepEqual(kinds('Yes, your 10% code is applied to the order.'), ['discount:true'])
})

test('trap sentences are not promises', () => {
  for (const text of [
    "I'll look into it and get back to you.",
    "We can refund you if it doesn't arrive by Friday.",
    'Our refund policy allows returns within 30 days of delivery.',
    'Refund request received, we will review it within a week.',
    "I've asked the warehouse to check the stock.",
    "I'll send you a refund if the item turns out to be damaged.",
    'Could we refund you? Let me check.',
  ]) assert.deepEqual(kinds(text), [], text)
})

test('a quote that is not in the message is dropped (hallucination guard)', () => {
  const m = msg('We are sorry for the delay.')
  assert.deepEqual(validatePromises({ orderNo: '1', message: m, extracted: [{ type: 'refund', claimsDone: true, quote: "I've refunded your order" }] }), [])
})

test('customer words are never promises', () => {
  const m = msg("I've refunded myself", 'customer')
  assert.deepEqual(validatePromises({ orderNo: '1', message: m, extracted: [{ type: 'refund', claimsDone: true, quote: "I've refunded myself" }] }), [])
})

test('model output with an amount field is stripped: the amount never comes from the model', () => {
  const m = msg("I've refunded $89.00 to your card.")
  const [p] = validatePromises({ orderNo: '1', message: m, extracted: [{ type: 'refund', claimsDone: true, quote: "I've refunded $89.00 to your card.", amountCents: 1 }] })
  assert.equal(p.mentionedAmountCents, 8900)
  assert.equal('amountCents' in p, false)
  assert.equal(mentionedAmountCents('no money here'), null)
})

test('Claude extractor forces record_promise and reads tool_use blocks', async () => {
  const requests = []
  const client = {
    messages: {
      create: async (req) => {
        requests.push(req)
        return { content: [{ type: 'tool_use', name: 'record_promise', input: { type: 'refund', claimsDone: true, quote: 'Refunded it.', amount: 5 } }] }
      },
    },
  }
  const out = await createClaudeExtractor(client, 'test-model')(msg('Refunded it.'))
  assert.equal(requests[0].tool_choice.type, 'any')
  assert.deepEqual(requests[0].tools, [RECORD_PROMISE_TOOL])
  assert.equal(RECORD_PROMISE_TOOL.input_schema.properties.amount, undefined)
  assert.deepEqual(out, [{ claimsDone: true, type: 'refund', quote: 'Refunded it.' }])
  const promises = await collectPromises({ threads: [{ orderNo: '7', messages: [msg('Refunded it.')] }], extractor: createClaudeExtractor(client) })
  assert.equal(promises.length, 1)
})

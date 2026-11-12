import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toAnthropicRequest, fromAnthropicResponse, handleStudioTurn, mockStudioTurn } from '../server/agent/studioTurn.js'
import { runToolLoop } from '../server/agent/claudeLoop.js'

const user = (text) => ({ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] })
const call = (id, name, args, result) => ({ id: `i-${id}`, kind: 'output', type: 'function_call', callId: id, name, arguments: JSON.stringify(args), ...(result !== undefined ? { result } : {}) })
const output = (id, out) => ({ type: 'function_call_output', callId: id, output: out, status: 'completed' })

test('AG Studio turn becomes a valid Anthropic request', () => {
  const body = toAnthropicRequest({
    input: [user('Show promises'), call('c1', 'show_promise_list', { olderThanDays: 1 }), output('c1', 'ok'), { id: 'r', kind: 'output', type: 'reasoning', summary: [] }],
    instructions: 'You are the Close Agent.',
    tools: [
      { name: 'show_promise_list', description: 'x', parameters: { type: 'object', properties: { olderThanDays: { type: 'number' } }, required: ['olderThanDays'] } },
      { name: 'web_search', description: 'hosted', parameters: { type: 'object' }, kind: 'provided' },
    ],
    toolChoice: 'auto',
    responseFormat: { type: 'text' },
  }, 'm')
  assert.equal(body.system, 'You are the Close Agent.')
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.deepEqual(body.messages[1].content[0], { type: 'tool_use', id: 'c1', name: 'show_promise_list', input: { olderThanDays: 1 } })
  assert.deepEqual(body.messages[2].content[0], { type: 'tool_result', tool_use_id: 'c1', content: 'ok' })
  assert.equal(body.tools.length, 1)
  assert.deepEqual(body.tool_choice, { type: 'auto' })
})

test('tool choice and json response format map onto Anthropic', () => {
  const base = { input: [user('hi')], tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }], responseFormat: { type: 'text' } }
  assert.deepEqual(toAnthropicRequest({ ...base, toolChoice: 'required' }).tool_choice, { type: 'any' })
  assert.deepEqual(toAnthropicRequest({ ...base, toolChoice: 'none' }).tool_choice, { type: 'none' })
  assert.deepEqual(toAnthropicRequest({ ...base, toolChoice: { name: 't' } }).tool_choice, { type: 'tool', name: 't' })
  const json = toAnthropicRequest({ ...base, responseFormat: { type: 'json', name: 'answer', schema: { type: 'object', properties: {} } } })
  assert.deepEqual(json.tool_choice, { type: 'tool', name: 'answer' })
  assert.equal(json.tools.at(-1).name, 'answer')
})

test('Anthropic answer becomes AG Studio output items', () => {
  const res = fromAnthropicResponse({
    id: 'msg_1', stop_reason: 'tool_use', model: 'm', usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: 'thinking', thinking: 'plan' }, { type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_close_status', input: {} }],
  })
  assert.deepEqual(res.output.map((o) => o.type), ['reasoning', 'message', 'function_call'])
  assert.equal(res.output[2].callId, 'toolu_1')
  assert.equal(res.output[2].arguments, '{}')
  assert.equal(res.usage.totalTokens, 15)
  assert.equal(res.status, 'completed')
  assert.equal(fromAnthropicResponse({ id: 'x', stop_reason: 'max_tokens', content: [] }).status, 'incomplete')
})

test('without a key the stand-in answers and the key never leaves the server', async () => {
  const request = { input: [user('Show every refund promise older than 1 day')], tools: [{ name: 'show_promise_list', description: 'd', parameters: { type: 'object' } }], responseFormat: { type: 'text' } }
  const out = await handleStudioTurn(request, { client: null })
  assert.equal(out.mode, 'mock')
  assert.equal(out.response.output[0].name, 'show_promise_list')
  assert.equal(JSON.parse(out.response.output[0].arguments).olderThanDays, 1)
  const followUp = mockStudioTurn({ input: [...request.input, call('mock-c-1', 'show_promise_list', {}), output('mock-c-1', JSON.stringify({ response: 'Added a grid.' }))], tools: [] })
  assert.match(followUp.output[0].content[0].text, /Added a grid/)
})

test('with a client the request goes to messages.create', async () => {
  const seen = []
  const client = { messages: { create: async (body) => { seen.push(body); return { id: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] } } } }
  const out = await handleStudioTurn({ input: [user('hi')], responseFormat: { type: 'text' } }, { client })
  assert.equal(out.mode, 'live')
  assert.equal(seen.length, 1)
  assert.equal(out.response.output[0].content[0].text, 'hello')
})

test('tool loop runs tools, feeds results back and stops on end_turn', async () => {
  const replies = [
    { content: [{ type: 'tool_use', id: 't1', name: 'get_books', input: {} }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'Twenty orders.' }], stop_reason: 'end_turn' },
  ]
  const client = { messages: { create: async () => replies.shift() } }
  const out = await runToolLoop({ client, model: 'm', system: 's', tools: [], messages: [{ role: 'user', content: 'how many orders' }], runTool: async () => ({ orders: 20 }) })
  assert.equal(out.reply, 'Twenty orders.')
  assert.equal(out.events.length, 1)
  assert.match(JSON.stringify(out.history.at(-2)), /tool_result/)
})

test('tool loop reports a tool failure to the model instead of crashing', async () => {
  const replies = [{ content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }], stop_reason: 'tool_use' }, { content: [{ type: 'text', text: 'sorry' }], stop_reason: 'end_turn' }]
  const client = { messages: { create: async () => replies.shift() } }
  const out = await runToolLoop({ client, model: 'm', system: 's', tools: [], messages: [], runTool: async () => { throw new Error('boom') } })
  assert.equal(out.events[0].ok, false)
  assert.match(JSON.stringify(out.history.at(-2)), /boom/)
})

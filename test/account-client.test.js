import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccountClient, withoutApiKey, transcriptOf } from '../server/agent/accountClient.js'

// A fake Claude Agent SDK: tool() keeps the handler, query() records its options and lets the "model" call a tool.
function fakeSdk(script) {
  const seen = { options: null, prompt: null, toolNames: [] }
  return {
    seen,
    tool: (name, description, shape, handler) => ({ name, description, shape, handler }),
    createSdkMcpServer: ({ tools }) => { seen.toolNames = tools.map((t) => t.name); return { type: 'sdk', tools } },
    query({ prompt, options }) {
      seen.prompt = prompt
      seen.options = options
      return (async function* run() { yield* await script(options.mcpServers?.closedesk?.tools || []) }())
    },
  }
}

test('account client: strips the API key env and keeps the Claude Code login path', async () => {
  const sdk = fakeSdk(async () => [{ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }, { type: 'result', subtype: 'success' }])
  const client = createAccountClient({ sdk, env: () => ({ ANTHROPIC_API_KEY: 'sk-secret', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin' }) })
  const res = await client.messages.create({ system: 'S', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(sdk.seen.options.env.ANTHROPIC_API_KEY, undefined)
  assert.equal(sdk.seen.options.env.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(sdk.seen.options.env.PATH, '/bin')
  assert.deepEqual(sdk.seen.options.settingSources, [])
  assert.deepEqual(res.content, [{ type: 'text', text: 'Hello' }])
  assert.equal(res.stop_reason, 'end_turn')
  assert.deepEqual(withoutApiKey({ ANTHROPIC_API_KEY: 'x', A: '1' }), { A: '1' })
})

test('account client: a tool the model calls comes back as a tool_use block and is not run here', async () => {
  const sdk = fakeSdk(async (tools) => {
    await tools[0].handler({ olderThanDays: 1 })
    return [{ type: 'assistant', message: { content: [{ type: 'text', text: 'Adding it.' }] } }, { type: 'result', subtype: 'error_max_turns' }]
  })
  const client = createAccountClient({ sdk, env: () => ({}) })
  const res = await client.messages.create({
    system: 'S',
    tools: [{ name: 'show_promise_list', description: 'd', input_schema: { type: 'object', properties: { olderThanDays: { type: 'number' } }, required: ['olderThanDays'] } }],
    messages: [{ role: 'user', content: 'Show promises' }],
  })
  assert.deepEqual(sdk.seen.toolNames, ['show_promise_list'])
  assert.equal(res.stop_reason, 'tool_use')
  assert.equal(res.content[0].type, 'text')
  assert.deepEqual({ ...res.content[1], id: undefined }, { type: 'tool_use', id: undefined, name: 'show_promise_list', input: { olderThanDays: 1 } })
})

test('account client: tool results and earlier calls are written into the prompt', () => {
  const text = transcriptOf([
    { role: 'user', content: 'q' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_close_status', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '15/20 matched' }] },
  ])
  assert.match(text, /assistant called get_close_status/)
  assert.match(text, /15\/20 matched/)
})

test('account client: a failed run is an error, not an empty answer', async () => {
  const sdk = fakeSdk(async () => [{ type: 'result', subtype: 'error_during_execution' }])
  await assert.rejects(createAccountClient({ sdk, env: () => ({}) }).messages.create({ messages: [{ role: 'user', content: 'x' }] }), /Account model failed/)
})

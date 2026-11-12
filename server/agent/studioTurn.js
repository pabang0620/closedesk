import { config } from '../config.js'
import { getAnthropic } from './anthropicClient.js'

// Translation between AG Studio's provider-neutral turn format (AgLlmRequest / AgLlmResponse) and
// the Anthropic Messages API. The browser adapter posts the request here, so the API key stays
// on the server. Both directions are pure functions so they are tested without any network call.

const pushBlock = (messages, role, block) => {
  const last = messages[messages.length - 1]
  if (last && last.role === role) last.content.push(block)
  else messages.push({ role, content: [block] })
}

export function toAnthropicMessages(input) {
  const messages = []
  const system = []
  for (const item of input) {
    if (item.type === 'message' && item.kind === 'input') {
      const text = item.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      if (item.role === 'system') system.push(text)
      else pushBlock(messages, 'user', { type: 'text', text })
    } else if (item.type === 'message') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('\n')
      if (text) pushBlock(messages, 'assistant', { type: 'text', text })
    } else if (item.type === 'function_call') {
      let parsed = {}
      try { parsed = item.arguments ? JSON.parse(item.arguments) : {} } catch { parsed = {} }
      pushBlock(messages, 'assistant', { type: 'tool_use', id: item.callId, name: item.name, input: parsed })
      if (item.result !== undefined) pushBlock(messages, 'user', { type: 'tool_result', tool_use_id: item.callId, content: String(item.result) })
    } else if (item.type === 'function_call_output') {
      pushBlock(messages, 'user', { type: 'tool_result', tool_use_id: item.callId, content: String(item.output) })
    }
    // Reasoning items are not sent back: Claude produces its own.
  }
  // Anthropic needs the first message to be from the user.
  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation continues)' }] })
  return { messages, system: system.join('\n\n') }
}

export function toAnthropicRequest(request, model = config.anthropicModel) {
  const { messages, system } = toAnthropicMessages(request.input || [])
  const instructions = [request.instructions, system].filter(Boolean).join('\n\n')
  const tools = (request.tools || [])
    .filter((t) => t.kind !== 'provided')
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters?.type ? t.parameters : { type: 'object', properties: {}, ...t.parameters } }))
  const body = { model, max_tokens: 4096, messages }
  if (instructions) body.system = instructions

  if (request.responseFormat?.type === 'json') {
    const format = request.responseFormat
    body.tools = [...tools, { name: format.name, description: format.description || 'Return the final answer in this shape.', input_schema: format.schema }]
    body.tool_choice = { type: 'tool', name: format.name }
    return body
  }
  if (tools.length) {
    body.tools = tools
    const choice = request.toolChoice
    if (choice === 'none') body.tool_choice = { type: 'none' }
    else if (choice === 'required') body.tool_choice = { type: 'any' }
    else if (choice && typeof choice === 'object') body.tool_choice = { type: 'tool', name: choice.name }
    else body.tool_choice = { type: 'auto' }
  }
  return body
}

export function fromAnthropicResponse(response, request) {
  const jsonName = request?.responseFormat?.type === 'json' ? request.responseFormat.name : null
  const output = []
  response.content.forEach((block, i) => {
    const id = `${response.id || 'msg'}-${i}`
    if (block.type === 'text') {
      output.push({ id, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: block.text, annotations: [] }] })
    } else if (block.type === 'tool_use' && block.name === jsonName) {
      output.push({ id, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: JSON.stringify(block.input), annotations: [] }] })
    } else if (block.type === 'tool_use') {
      output.push({ id, kind: 'output', type: 'function_call', callId: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}), status: 'completed' })
    } else if (block.type === 'thinking' && block.thinking) {
      output.push({ id, kind: 'output', type: 'reasoning', summary: [{ type: 'summary', text: block.thinking }] })
    }
  })
  const truncated = response.stop_reason === 'max_tokens'
  return {
    id: response.id || 'msg',
    createdAt: Date.now(),
    output,
    status: truncated ? 'incomplete' : 'completed',
    ...(truncated ? { incompleteDetails: { reason: 'max_output_tokens' } } : {}),
    usage: response.usage ? { inputTokens: response.usage.input_tokens || 0, outputTokens: response.usage.output_tokens || 0, totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0) } : undefined,
    model: response.model,
  }
}

// ---- No API key: a small deterministic stand-in so the Studio chat still works ----

const hasTool = (request, name) => (request.tools || []).some((t) => t.name === name)
const message = (id, text) => ({ id, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] })
const call = (id, name, args) => ({ id, kind: 'output', type: 'function_call', callId: `mock-${id}`, name, arguments: JSON.stringify(args), status: 'completed' })

export function mockStudioTurn(request) {
  const items = request.input || []
  const last = items[items.length - 1]
  const lastUser = [...items].reverse().find((i) => i.type === 'message' && i.kind === 'input' && i.role === 'user')
  const prompt = (lastUser?.content || []).map((c) => c.text || '').join(' ').toLowerCase()
  const respond = (output) => ({ id: `mock-${Date.now()}`, createdAt: Date.now(), output, status: 'completed', model: 'mock-close-agent' })

  if (last?.type === 'function_call_output') {
    let text = String(last.output)
    try { const parsed = JSON.parse(text); text = parsed.response ?? parsed.message ?? text } catch { /* plain text result */ }
    return respond([message(`m-${items.length}`, `Done. ${String(text).slice(0, 400)}`)])
  }
  const wantsPromises = /promise|refund/.test(prompt)
  if (wantsPromises && hasTool(request, 'show_promise_list')) {
    const days = /(\d+)\s*day/.exec(prompt)
    return respond([call(`c-${items.length}`, 'show_promise_list', { olderThanDays: days ? Number(days[1]) : 1 })])
  }
  // Stand-in for "chart the money at stake": the same tool call the real model makes. With a model, widget work goes to Studio's own widget agent.
  if (/chart|graph/.test(prompt) && hasTool(request, 'add_money_chart')) return respond([call(`c-${items.length}`, 'add_money_chart', {})])
  if (hasTool(request, 'get_close_status')) return respond([call(`c-${items.length}`, 'get_close_status', {})])
  return respond([message(`m-${items.length}`, 'I am the Close Agent running without a model key. Ask about refund promises or the close status.')])
}

// POST /api/studio/turn
export async function handleStudioTurn(request, { client = getAnthropic() } = {}) {
  if (!client) return { response: mockStudioTurn(request), mode: 'mock' }
  const body = toAnthropicRequest(request)
  const response = await client.messages.create(body)
  return { response: fromAnthropicResponse(response, request), mode: 'live' }
}

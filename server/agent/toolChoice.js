// claude-sonnet-5-5 rejects forced tool_choice ({type:'tool'} and {type:'any'}) with HTTP 400.
// Every request builder goes through this helper: the API only ever sees {type:'auto'} (or no tools),
// and the "must call a tool" rule is carried by a short system instruction and checked afterwards.

export const REQUIRE_ANY = { any: true }

export function requireInstruction(required) {
  if (required?.name) return `You must answer by calling the tool ${required.name}.`
  return 'You must call one of the tools in this turn.'
}

// required: null | { any: true } | { name }. Returns a new body, never mutating the input.
export function compatBody(input, required = null, { repeat = false } = {}) {
  const { tool_choice: choice, ...body } = input
  if (choice?.type === 'none') {
    const { tools, ...rest } = body
    return rest
  }
  if (!body.tools?.length) return body
  const note = required ? [requireInstruction(required), ...(repeat ? [requireInstruction(required)] : [])].join(' ') : ''
  const system = [typeof body.system === 'string' ? body.system : '', note].filter(Boolean).join('\n\n')
  return { ...body, ...(system ? { system } : {}), tool_choice: { type: 'auto' } }
}

// The required tool a legacy forced tool_choice asked for.
export function requiredOf(choice) {
  if (choice?.type === 'any') return REQUIRE_ANY
  if (choice?.type === 'tool') return { name: choice.name }
  return null
}

export function satisfied(response, required) {
  if (!required) return true
  return (response?.content || []).some((b) => b.type === 'tool_use' && (required.any || b.name === required.name))
}

// Sends the request without forced tool_choice. If the required tool was not called, retries once with
// the instruction repeated. Returns { response, ok }; ok false means the caller uses its labelled fallback.
export async function createRequiring(client, input, required) {
  const first = await client.messages.create(compatBody(input, required))
  if (satisfied(first, required)) return { response: first, ok: true }
  const second = await client.messages.create(compatBody(input, required, { repeat: true }))
  return { response: second, ok: satisfied(second, required) }
}

const MAX_STEPS = 10

const textOf = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()

// A plain Anthropic tool loop. `runTool(name, input)` runs a server side read or internal write tool.
// PayPal write calls are never tools: only approval buttons reach them.
// The client is injected so tests run it against a fake.
export async function runToolLoop({ client, model, system, tools, runTool, messages, maxSteps = MAX_STEPS, maxTokens = 4000 }) {
  const history = [...messages]
  const events = []
  for (let step = 0; step < maxSteps; step += 1) {
    const response = await client.messages.create({ model, max_tokens: maxTokens, system, tools, messages: history })
    history.push({ role: 'assistant', content: response.content })
    if (response.stop_reason === 'refusal') return { reply: 'I cannot help with that request.', events, history }
    const uses = response.content.filter((b) => b.type === 'tool_use')
    if (response.stop_reason !== 'tool_use' || uses.length === 0) return { reply: textOf(response.content) || 'Done.', events, history }
    const results = []
    for (const use of uses) {
      let outcome
      try {
        outcome = { ok: true, result: await runTool(use.name, use.input) }
      } catch (err) {
        outcome = { ok: false, result: { error: err.message } }
      }
      events.push({ tool: use.name, ok: outcome.ok, input: use.input })
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(outcome.result).slice(0, 12000), is_error: !outcome.ok })
    }
    history.push({ role: 'user', content: results })
  }
  return { reply: 'I stopped after several steps.', events, history }
}

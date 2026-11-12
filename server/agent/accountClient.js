import { z } from 'zod'
import { config } from '../config.js'

// A client with the same `messages.create` shape as the Anthropic SDK, backed by the Claude Agent SDK so the
// developer's Claude Code login is used instead of an API key (LLM_BACKEND=account, local use only).
// The caller's tools are shown to the model as in-process MCP tools. Their handlers only record the call:
// the tool_use blocks go back to the caller (the tool loop or AG Studio), which runs them. One model turn per create().
const SERVER_NAME = 'closedesk'
const PREFIX = `mcp__${SERVER_NAME}__`

let loaded = null
const loadSdk = () => (loaded ||= import('@anthropic-ai/claude-agent-sdk'))

// The Claude Code process would pick the API key up from the environment and bill the API. Remove both.
export function withoutApiKey(env = process.env) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...rest } = env
  return rest
}

const shapeOf = (schema) => {
  try {
    return z.fromJSONSchema(schema || { type: 'object' }).shape ?? {}
  } catch {
    return z.object({}).passthrough().shape
  }
}

const blockText = (block) => {
  if (block.type === 'text') return block.text
  if (block.type === 'tool_use') return `[assistant called ${block.name} with ${JSON.stringify(block.input)}]`
  if (block.type === 'tool_result') return `[tool result for ${block.tool_use_id}: ${typeof block.content === 'string' ? block.content : JSON.stringify(block.content)}]`
  return ''
}

export function transcriptOf(messages) {
  return messages.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}:\n${(typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content).map(blockText).filter(Boolean).join('\n')}`).join('\n\n')
}

export function createAccountClient({ sdk, model = config.anthropicModel, env = () => process.env } = {}) {
  let counter = 0
  async function create(body) {
    const agentSdk = sdk || await loadSdk()
    const calls = []
    const tools = (body.tools || []).map((def) => agentSdk.tool(def.name, def.description || def.name, shapeOf(def.input_schema), async (input) => {
      calls.push({ type: 'tool_use', id: `toolu_acct_${(counter += 1)}`, name: def.name, input })
      return { content: [{ type: 'text', text: 'Recorded. The caller runs this tool and reports back in the next turn.' }] }
    }))
    const system = `${typeof body.system === 'string' ? body.system : ''}\nAlways answer in English. Call only the tools you need in this turn. After you call tools, stop: the results come back in the next turn.`
    const stream = agentSdk.query({
      prompt: `${transcriptOf(body.messages)}\n\nContinue as the Assistant.`,
      options: {
        model,
        systemPrompt: system,
        tools: [],
        allowedTools: [`${PREFIX}*`],
        ...(tools.length ? { mcpServers: { [SERVER_NAME]: agentSdk.createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools }) } } : {}),
        maxTurns: 1 + (tools.length ? 1 : 0),
        effort: 'medium',
        settingSources: [],
        // Only this app's tools: no MCP servers from the developer's machine and no claude.ai connectors
        // (a recorded run once mentioned the developer's Docs connector, 2026-11-12).
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true },
        env: withoutApiKey(env()),
      },
    })
    const texts = []
    try {
      for await (const message of stream) {
        if (message.type === 'assistant') {
          for (const block of message.message?.content || []) if (block.type === 'text' && block.text?.trim()) texts.push(block.text.trim())
        }
        if (message.type === 'result' && message.subtype !== 'success' && message.subtype !== 'error_max_turns') throw new Error(`Account model failed: ${message.subtype}`)
      }
    } catch (err) {
      // The SDK may throw when the turn cap is hit. That is the normal end of a turn that called tools.
      if (!(calls.length && /maximum number of turns/i.test(err.message))) throw err
    }
    const content = [...(texts.length ? [{ type: 'text', text: texts.join('\n') }] : []), ...calls.map((c) => ({ ...c, name: c.name.replace(PREFIX, '') }))]
    if (!content.length) content.push({ type: 'text', text: 'Done.' })
    return { id: `acct-${counter}`, type: 'message', role: 'assistant', model, content, stop_reason: calls.length ? 'tool_use' : 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }
  }
  return { messages: { create } }
}

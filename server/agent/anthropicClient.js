import Anthropic from '@anthropic-ai/sdk'
import { config, modes } from '../config.js'
import { createAccountClient } from './accountClient.js'

let client = null

// Returns a client with the Anthropic `messages.create` shape, or null when callers should use the mock paths.
// live: the API key. account: the developer's Claude Code login through the Agent SDK (never the key).
export function getAnthropic() {
  if (modes.llm === 'mock') return null
  if (!client) client = modes.llm === 'account' ? createAccountClient() : new Anthropic({ apiKey: config.anthropicKey })
  return client
}

export function setAnthropicForTests(fake) {
  client = fake
}

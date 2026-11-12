import { z } from 'zod'
import { config } from '../config.js'
import { PROMISE_TYPES } from '../close/promises.js'

export const PROMISE_SYSTEM = `You read one message that a shop's support agent wrote to a customer. Decide whether the shop promised something about money.
Types: refund (the shop says it refunded, or will refund), discount (a coupon or price cut is applied or will be), cancel (the order is cancelled), none.
A promise is a commitment, not a possibility. These are NOT promises: "I'll look into it", "we can refund you if ...", policy descriptions, "we will review", asking someone else to check.
Quote the exact sentence from the message. Set claimsDone true when the shop says it is already done. Never output an amount; the app computes every amount.
Call record_promise once per promise. Call it with type none if there is no promise.`

const inputSchema = z.object({
  type: z.enum(PROMISE_TYPES),
  claimsDone: z.boolean().optional(),
  quote: z.string().max(500),
})

export const RECORD_PROMISE_TOOL = {
  name: 'record_promise',
  description: 'Record one promise found in the message. No amount field: amounts are computed by the app.',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: PROMISE_TYPES },
      claimsDone: { type: 'boolean', description: 'true if the shop says it is already done' },
      quote: { type: 'string', description: 'the exact sentence from the message' },
    },
    required: ['type', 'quote'],
  },
}

// Extractor backed by Claude. Returns the raw array that promises.js validates; a quote that is
// not literally in the message is dropped there.
export function createClaudeExtractor(client, model = config.anthropicModel) {
  return async (message) => {
    const response = await client.messages.create({
      model,
      max_tokens: 800,
      system: PROMISE_SYSTEM,
      tools: [RECORD_PROMISE_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: `Support message:\n"""${message.text}"""` }],
    })
    return response.content
      .filter((b) => b.type === 'tool_use' && b.name === 'record_promise')
      .map((b) => inputSchema.safeParse(b.input))
      .filter((r) => r.success)
      .map((r) => ({ claimsDone: false, ...r.data }))
  }
}

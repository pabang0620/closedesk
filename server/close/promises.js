import { z } from 'zod'
import { toCents } from '../util/money.js'

// A promise the shop made to a customer. The model (or the fallback rules) only decides the
// type, the claimed tense and the quoted sentence. The amount is never taken from the model.
export const PROMISE_TYPES = ['refund', 'discount', 'cancel', 'none']

export const promiseSchema = z.object({
  type: z.enum(PROMISE_TYPES),
  claimsDone: z.boolean().default(false),
  quote: z.string().min(1).max(500),
})

const NEGATING = /\b(if|unless|can|could|might|may|would|should|policy|policies|look into|looking into|review|check(ing)?|asked|request received)\b/i
const REFUND_DONE = /\b(?:i['’]?ve|we['’]?ve|i have|we have|has been|have been)\s+(?:just\s+)?(?:refunded|issued (?:a |the )?refund)|\byour refund (?:is|has been|was) (?:processed|issued|sent|done)/i
const REFUND_WILL = /\b(?:i['’]?ll|we['’]?ll|i will|we will)\s+(?:be\s+)?(?:refund|send (?:you )?(?:a|your) refund|issue (?:a |your )?refund)/i
const DISCOUNT_APPLIED = /\b(?:your|the)\s+(\d{1,2})%\s+(?:code|discount|coupon)\s+(?:is|has been|was)\s+applied/i
const CANCEL_DONE = /\b(?:your order is|i['’]?ve|we['’]?ve|has been)\s+cancel+ed/i

// Rule based fallback used when no Anthropic key is configured. Returns the same shape as the model path.
export function extractPromisesRules(message) {
  const out = []
  for (const sentence of message.text.match(/[^.!?]+[.!?]?/g) || []) {
    const text = sentence.trim()
    if (!text) continue
    if (REFUND_DONE.test(text) && !NEGATING.test(text.replace(REFUND_DONE, ''))) out.push({ type: 'refund', claimsDone: true, quote: text })
    else if (REFUND_WILL.test(text) && !NEGATING.test(text.replace(REFUND_WILL, ''))) out.push({ type: 'refund', claimsDone: false, quote: text })
    else if (DISCOUNT_APPLIED.test(text)) out.push({ type: 'discount', claimsDone: true, quote: text })
    else if (CANCEL_DONE.test(text)) out.push({ type: 'cancel', claimsDone: true, quote: text })
  }
  return out
}

// Dollar amount mentioned in the quote, used only to cross-check the code's own number.
export function mentionedAmountCents(quote) {
  const m = /\$\s?(\d+(?:\.\d{1,2})?)/.exec(quote)
  return m ? toCents(m[1]) : null
}

// Turns raw extractions into stored promises. A quote that is not literally in the message
// is dropped, so a hallucinated "promise" can never become an exception.
export function validatePromises({ orderNo, message, extracted }) {
  const promises = []
  for (const raw of extracted) {
    const parsed = promiseSchema.safeParse(raw)
    if (!parsed.success || parsed.data.type === 'none') continue
    const start = message.text.indexOf(parsed.data.quote)
    if (start < 0) continue
    if (message.from !== 'agent') continue // only the shop's own words are promises
    promises.push({
      id: `${message.id}:${start}`,
      orderNo,
      messageId: message.id,
      type: parsed.data.type,
      claimsDone: parsed.data.claimsDone,
      at: message.at,
      quote: parsed.data.quote,
      span: { start, end: start + parsed.data.quote.length },
      mentionedAmountCents: mentionedAmountCents(parsed.data.quote),
    })
  }
  return promises
}

// extractor(message) -> raw extraction array. Defaults to the rules; the Claude path is injected.
export async function collectPromises({ threads, extractor = async (m) => extractPromisesRules(m), onStep }) {
  const promises = []
  for (const thread of threads) {
    for (const message of thread.messages) {
      if (message.from !== 'agent') continue
      const extracted = await extractor(message, thread.orderNo)
      const valid = validatePromises({ orderNo: thread.orderNo, message, extracted })
      onStep?.({ orderNo: thread.orderNo, message, found: valid.length })
      promises.push(...valid)
    }
  }
  return promises
}

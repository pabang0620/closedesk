import { api } from '../lib/api.js'

// The ag-studio package has no Claude adapter. This is the Claude one: it posts the provider-neutral
// turn to our server, which holds the key and talks to Anthropic (or the stand-in without a key),
// then replays the answer as AG Studio protocol events.
function* eventsFor(output) {
  for (const item of output) {
    if (item.type === 'message') {
      yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' }
      for (const part of item.content) yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: part.type === 'text' ? part.text : part.refusal }
      yield { type: 'TEXT_MESSAGE_END', messageId: item.id }
    } else if (item.type === 'function_call') {
      yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name }
      yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments }
      yield { type: 'TOOL_CALL_END', toolCallId: item.callId }
    } else if (item.type === 'reasoning') {
      yield { type: 'REASONING_MESSAGE_START', messageId: item.id, role: 'reasoning' }
      yield { type: 'REASONING_MESSAGE_CONTENT', messageId: item.id, delta: item.summary.map((s) => s.text).join('\n') }
      yield { type: 'REASONING_MESSAGE_END', messageId: item.id }
    }
  }
}

export function claudeProxyAdapter() {
  return {
    executeTurn(request, options) {
      const complete = api('/studio/turn', { method: 'POST', body: { request } }, options?.signal).then((data) => data.response)
      complete.catch(() => {})
      return {
        complete,
        stream: {
          async *[Symbol.asyncIterator]() {
            const response = await complete
            yield* eventsFor(response.output)
          },
        },
      }
    },
  }
}

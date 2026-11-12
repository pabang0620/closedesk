import { callToolkit } from '../paypal/toolkit.js'
import { toCents, formatUsd } from '../util/money.js'
import { remapIds, shiftDates } from './recordedRuns.js'
import { TOOLKIT_TOOL_NAMES, clipSentences, HYPOTHESIS_MAX } from './tools.js'

// "Ask the Close Agent why", without a model. A fixed read sequence on the PayPal Agent Toolkit tools
// (get_order, get_invoice, list_transactions), then an answer written from those results. No money moves.
// Every call is appended to the Agent trace with source "agent-toolkit".
const iso = (ms) => new Date(ms).toISOString()

function describeOrder(order) {
  const unit = order.purchase_units?.[0]
  const caps = unit?.payments?.captures || []
  const auths = unit?.payments?.authorizations || []
  const refunds = unit?.payments?.refunds || []
  const total = (list) => formatUsd(list.reduce((s, x) => s + toCents(x.amount?.value ?? '0'), 0))
  const parts = [`order ${order.id} is ${order.status}`]
  parts.push(caps.length ? `${caps.length} capture(s) worth ${total(caps)}, ${caps.map((c) => c.status).join('/')}` : 'no capture')
  if (auths.length) parts.push(`${auths.length} authorization(s), ${auths.map((a) => a.status).join('/')}`)
  if (refunds.length) parts.push(`${refunds.length} refund(s) worth ${total(refunds)}`)
  return parts.join(', ')
}

export async function explainException(close, exceptionId, { now = Date.now(), call = callToolkit } = {}) {
  const ex = close.exceptions.find((e) => e.id === exceptionId)
  const book = ex.orderNo ? close.books.orders.find((o) => o.orderNo === ex.orderNo) : null
  const events = []
  const facts = []
  const run = async (tool, input, summarize) => {
    try {
      const result = await call(tool, input)
      const output = summarize(result)
      events.push({ tool, ok: true, input, output, source: 'agent-toolkit' })
      facts.push(output)
    } catch (err) {
      events.push({ tool, ok: false, input, output: `failed: ${err.message}`, source: 'agent-toolkit' })
    }
  }
  if (book?.paypalOrderId) await run('get_order', { id: book.paypalOrderId }, describeOrder)
  if (ex.invoiceId) await run('get_invoice', { invoice_id: ex.invoiceId }, (inv) => `invoice ${inv.id || ex.invoiceId} is ${inv.status}`)
  if (ex.captureId || book) {
    const input = { start_date: iso(close.period.startMs), end_date: iso(now), ...(ex.captureId ? { transaction_id: ex.captureId } : {}), page_size: 20 }
    await run('list_transactions', input, (res) => `${res.transaction_details?.length ?? 0} transaction line(s) returned${ex.captureId ? ` for ${ex.captureId}` : ''}`)
  }
  close.trace = [...close.trace, ...events.map((e) => ({ tool: e.tool, input: e.input, output: e.output, source: e.source, atMs: now }))]
  const reply = `${ex.hypothesis || ex.narrative} PayPal says: ${facts.length ? `${facts.join('; ')}.` : 'the read calls did not return anything usable, so this rests on the books and the support thread.'}`
  return { reply, events, label: 'Fixed Agent Toolkit read sequence (no model)' }
}

// Replays a recorded real model run of "Ask the Close Agent why" (builtin/recorded-runs/ask-E*.json).
// The model's tool calls run again, in the recorded order, against this session's PayPal data (ids remapped,
// the search window shifted by the time since the recording), so every result on screen is live. Only the model text is recorded.
export async function replayAsk(close, run, { now = Date.now(), runTool, currentIds, label }) {
  const events = []
  for (const turn of run.turns) {
    for (const use of turn.toolCalls) {
      let input = remapIds(use.input, run.idMap, currentIds)
      if (use.name === 'list_transactions') input = shiftDates(input, run.recordedAt, now)
      // The recorded hypothesis lands on the card, so it carries the label there too.
      if (use.name === 'classify_exception' && input.hypothesis) input = { ...input, hypothesis: `${clipSentences(input.hypothesis, HYPOTHESIS_MAX - label.length - 3)} (${label})` }
      let ok = true
      try { await runTool(use.name, input) } catch { ok = false }
      events.push({ tool: use.name, ok, input, output: ok ? 'ok' : 'failed', source: use.name in TOOLKIT_TOOL_NAMES ? 'agent-toolkit' : 'code', modelMs: turn.ms })
    }
  }
  close.trace = [...close.trace, ...events.map((e) => ({ tool: e.tool, input: e.input, output: `${e.output} (${label})`, source: e.source, atMs: now }))]
  return { reply: remapIds(run.reply, run.idMap, currentIds), events, label, modelSteps: run.turns.map((t) => ({ ms: t.ms, tools: t.toolCalls.map((c) => c.name) })) }
}

import { callToolkit } from '../paypal/toolkit.js'
import { toCents, formatUsd } from '../util/money.js'

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
  return { reply, events }
}

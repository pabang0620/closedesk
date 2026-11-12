import { toolkitSchema, callToolkit } from '../paypal/toolkit.js'
import { computeBridge } from '../close/bridge.js'

// Close Agent tools (server side). PayPal write calls are deliberately absent.
export const CLOSE_AGENT_SYSTEM = `You are the Close Agent of CloseDesk. You investigate gaps between PayPal and what a seller promised customers.
Read with the tools. Classify each exception with classify_exception. You never move money and you never state an amount that did not come from a tool. Only the owner approves refunds, captures and voids.`

const INTERNAL = [
  { name: 'get_books', description: 'Orders (with PayPal order ids), coupons, invoices and bank receipts of this period.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_support_thread', description: 'Support messages for one order.', input_schema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] } },
  { name: 'get_ledger_lines', description: 'Normalized PayPal ledger lines of this period with their source.', input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['payment', 'refund', 'other'] } } } },
  { name: 'classify_exception', description: 'Record a hypothesis for an exception. No amount field.', input_schema: { type: 'object', properties: { ref: { type: 'string' }, hypothesis: { type: 'string' }, evidence_ids: { type: 'array', items: { type: 'string' } } }, required: ['ref', 'hypothesis'] } },
]

// Keeps whole sentences only, so a long model hypothesis never ends mid-word on the card or in the package.
export const HYPOTHESIS_MAX = 1000
export function clipSentences(text, max = HYPOTHESIS_MAX) {
  const value = String(text).trim()
  if (value.length <= max) return value
  const head = value.slice(0, max)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'))
  return end > 0 ? head.slice(0, end + 1) : `${head.slice(0, head.lastIndexOf(' '))}...`
}

export const TOOLKIT_TOOL_NAMES = { list_transactions: true, get_order: true, get_invoice: true, search_invoicing: true }
export const closeAgentTools = () => [...INTERNAL, ...Object.keys(TOOLKIT_TOOL_NAMES).map(toolkitSchema)]

export function makeToolRunner(close) {
  return async (name, input) => {
    switch (name) {
      case 'get_books': return { orders: close.books.orders.map(({ orderNo, customer, totalCents, status, paypalOrderId, couponCode }) => ({ orderNo, customer, totalCents, status, paypalOrderId, couponCode })), invoices: close.books.invoices }
      case 'get_support_thread': return close.books.threads.find((t) => t.orderNo === input.order_id) || { messages: [] }
      case 'get_ledger_lines': return { source: close.ledger.badge, lines: close.ledger.lines.filter((l) => !input.kind || l.kind === input.kind || (input.kind === 'other' && !['payment', 'refund'].includes(l.kind))) }
      case 'classify_exception': {
        const ex = close.exceptions.find((e) => e.id === input.ref)
        if (!ex) throw new Error(`Unknown exception ${input.ref}`)
        ex.hypothesis = clipSentences(input.hypothesis)
        return { ok: true, bridge: computeBridge(close.exceptions).unexplainedCents }
      }
      default: return callToolkit(name, input)
    }
  }
}

import { collectPromises } from './promises.js'
import { loadLedger } from './ledger.js'
import { detectExceptions } from './match.js'
import { modes } from '../config.js'

// The daily check. It walks the same tool sequence the agent trace panel shows:
// get_books -> get_support_thread -> record_promise -> get_ledger_lines -> list_transactions
// -> get_invoice -> classify_exception. Detection itself is deterministic code.
// Each trace line names what really ran: books, support, rules or model (promise reading), code, the PayPal SDK or REST
// (the mock when no keys are set), or agent-toolkit (only the "Ask the Close Agent why" reads).
export async function runDailyCheck(close, { paypal, extractor, now = () => Date.now(), forceMode, hypothesizer } = {}) {
  const trace = []
  const paypalSource = modes.paypal === 'sandbox' ? 'paypal-sdk' : 'paypal-mock'
  const step = (tool, input, output, source = 'books') => trace.push({ tool, input, output, source, atMs: now() })
  const { books, period } = close

  step('get_books', { filter: 'period' }, `${books.orders.length} orders, ${books.invoices.length} invoice`)

  const withThreads = books.threads.filter((t) => t.messages.length)
  step('get_support_thread', { orders: withThreads.length }, `${withThreads.reduce((s, t) => s + t.messages.length, 0)} messages`, 'support')

  const promises = await collectPromises({ threads: books.threads, extractor })
  step('record_promise', { messages: 'agent replies' }, `${promises.length} promises: ${promises.map((p) => `${p.orderNo} ${p.type}`).join(', ')}`, extractor ? 'model' : 'rules (no model key)')

  const calls = []
  const ledger = await loadLedger({ paypal, books, period, nowMs: now(), trace: (c) => calls.push(c), forceMode })
  step('get_ledger_lines', { mode: ledger.mode }, `${ledger.lines.length} lines kept of ${ledger.rawCount} (${ledger.badge})`, paypalSource)
  for (const c of calls.slice(0, 6)) step('list_transactions', { call: c.call, status: c.status, page: c.page }, `${c.count ?? ''} ${c.totalItems != null ? `of ${c.totalItems}` : ''}`.trim() || c.id || '', paypalSource)

  const orderStates = new Map()
  for (const o of books.orders.filter((x) => x.paypalOrderId)) orderStates.set(o.paypalOrderId, await paypal.getOrder(o.paypalOrderId))
  const invoiceStates = new Map()
  for (const inv of books.invoices) {
    const res = await paypal.searchInvoices({ invoiceNumber: inv.number })
    const found = res.items?.[0]
    if (found) invoiceStates.set(inv.number, found)
    step('get_invoice', { invoice_number: inv.number }, found ? `${found.id} ${found.status}` : 'not found', modes.paypal === 'sandbox' ? 'paypal-rest' : 'paypal-mock')
  }

  const detected = detectExceptions({ books, promises, ledger, orderStates, invoiceStates, nowMs: now(), knownRefunds: close.refundIndex })

  // Keep every exception that already exists (and whatever happened to it). Only new keys are added.
  const known = new Set(close.exceptions.map((e) => e.key))
  let nextNo = close.exceptions.length + 1
  const fresh = detected.filter((e) => !known.has(e.key))
  const firstRun = close.exceptions.length === 0
  const added = fresh.map((e) => ({ ...e, id: firstRun ? e.id : `E${nextNo++}` }))
  close.exceptions = [...close.exceptions, ...added]
  close.promises = promises
  close.ledger = { mode: ledger.mode, badge: ledger.badge, lines: ledger.lines, skippedChecks: ledger.skippedChecks }
  close.checkedAtMs = now()

  for (const e of added) {
    const hypothesis = hypothesizer ? await hypothesizer(e) : e.narrative
    e.hypothesis = hypothesis
    step('classify_exception', { ref: e.id, type: e.code, evidence_ids: e.evidence.map((x) => x.id).filter(Boolean) }, hypothesis, hypothesizer ? 'model' : 'code')
  }
  close.trace = trace
  return { added: added.length, mode: ledger.mode, trace }
}


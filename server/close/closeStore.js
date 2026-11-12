import { randomId } from '../util/ids.js'

// In-memory store of close runs. One close per judge session, bound to one period.
const closes = new Map()
const bySession = new Map()

export function createClose({ sessionId, period, books }) {
  const close = {
    id: randomId(10).toLowerCase(),
    sessionId,
    periodId: period.id,
    period,
    books,
    ledger: null,
    promises: [],
    exceptions: [],
    actions: [],
    audit: [],
    trace: [],
    refundIndex: new Map(), // capture id -> cents refunded by this app
    invoiceSerial: books.nextInvoiceSerial,
    nextActionNo: 1,
    signed: null,
    checkedAtMs: null,
    createdAtMs: Date.now(),
  }
  closes.set(close.id, close)
  bySession.set(sessionId, close.id)
  return close
}

export const getClose = (id) => closes.get(id) || null
export const getCloseForSession = (sessionId) => closes.get(bySession.get(sessionId)) || null
export const resetStoreForTests = () => { closes.clear(); bySession.clear() }

// Words for people. The server sends enum names and camelCase keys; the screen never shows them raw.
export const ACTION_LABEL = {
  REFUND_FULL: 'Refund in full',
  REFUND_PARTIAL: 'Partial refund',
  CAPTURE_AUTH: 'Capture the hold',
  VOID_AUTH: 'Release the hold',
  SEND_INVOICE: 'Send invoice',
  RECORD_PAYMENT: 'Record payment',
  JOURNAL_ONLY: 'Explain in journal',
}

export const EVIDENCE_LABEL = {
  support_quote: 'Support reply',
  capture: 'PayPal capture',
  authorization: 'PayPal hold',
  search_line: 'PayPal ledger',
  books: 'Books',
  search: 'PayPal search',
  twin: 'Same cart',
  support: 'Support',
  invoice: 'PayPal invoice',
  rule: 'Rule',
}
export const evidenceLabel = (kind) => EVIDENCE_LABEL[kind] || kind.replaceAll('_', ' ')

const ID_LABEL = { refundId: 'Refund', captureId: 'Capture', authId: 'Hold', invoiceId: 'Invoice', invoiceNumber: 'Invoice number', paymentId: 'Payment' }
export const idLabel = (key) => ID_LABEL[key] || key.replace(/([A-Z])/g, ' $1').toLowerCase()

export const when = (value) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

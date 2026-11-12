import { randomId } from '../util/ids.js'
import { toAmount, toCents, fromAmount, toValue } from '../util/money.js'

// Mock PayPal. Response bodies follow PayPal's published schemas:
//  - Transaction Search v1 (GET /v1/reporting/transactions): transaction_details[], transaction_info,
//    payer_info, account_number, start_date, end_date, last_refreshed_datetime, page, total_items, total_pages, links
//  - Orders v2, Payments v2 (authorizations, captures, refunds), Invoicing v2.
// Documented behaviours reproduced: 31 day maximum range, page_size up to 500, status filter D/P/S/V,
// three hour indexing delay, custom_id surfacing as transaction_info.custom_field, negative amounts for refunds.

const DAY = 86_400_000
const HOUR = 3_600_000
export const HONOR_PERIOD_MS = 3 * DAY
export const AUTH_VALID_MS = 29 * DAY
const SEARCH_RANGE_MAX_MS = 31 * DAY
const FEE_PERCENT = 0.029
const FEE_FIXED_CENTS = 30

export class PayPalError extends Error {
  constructor(status, name, message, issue) {
    super(`${name}${issue ? `: ${issue}` : ''}${message ? ` (${message})` : ''}`)
    this.status = status
    this.name = name
    this.issue = issue
    this.paypal = { name, message, details: issue ? [{ issue }] : [] }
  }
}

const iso = (ms) => new Date(ms).toISOString()
// Transaction Search uses ISO 8601 with a numeric offset, e.g. 2026-11-11T09:00:00+0000.
const searchTime = (ms) => iso(ms).replace(/\.\d{3}Z$/, '+0000')

export function createMockPaypal({ now = () => Date.now(), options = {} } = {}) {
  const settings = {
    searchDelayMs: options.searchDelayMs ?? 0,
    searchScope: options.searchScope ?? true,
    balancesScope: options.balancesScope ?? true,
    cardReauthSupported: options.cardReauthSupported ?? false,
    invoicingWorks: options.invoicingWorks ?? true,
  }
  const orders = new Map()
  const authorizations = new Map()
  const captures = new Map()
  const refunds = new Map()
  const invoices = new Map()
  const transactions = [] // Transaction Search index entries
  const requestCache = new Map()
  let accountBalanceCents = 100_000_00
  let invoiceCounter = 0
  const callLog = []

  const record = (call) => callLog.push({ at: now(), ...call })

  // PayPal-Request-Id: a repeated id returns the first result instead of acting twice.
  async function idempotent(requestId, fn) {
    if (requestId && requestCache.has(requestId)) return structuredClone(requestCache.get(requestId))
    const result = await fn()
    if (requestId) requestCache.set(requestId, structuredClone(result))
    return result
  }

  function feeFor(cents) {
    return Math.round(cents * FEE_PERCENT) + FEE_FIXED_CENTS
  }

  function payerOf(source) {
    return {
      account_id: source.accountId,
      email_address: source.email || undefined,
      address_status: 'N',
      payer_status: 'Y',
      payer_name: { given_name: source.given || 'Test', surname: source.surname || 'Buyer', alternate_full_name: `${source.given || 'Test'} ${source.surname || 'Buyer'}` },
      country_code: 'US',
    }
  }

  function indexTransaction(entry) {
    transactions.push({ ...entry, visibleAt: entry.createdAt + settings.searchDelayMs })
  }

  function txnInfo(entry) {
    const fee = entry.feeCents ? -Math.abs(entry.feeCents) : 0
    return {
      paypal_account_id: 'MOCKMERCHANT1',
      transaction_id: entry.id,
      ...(entry.referenceId ? { paypal_reference_id: entry.referenceId, paypal_reference_id_type: entry.referenceType || 'TXN' } : {}),
      transaction_event_code: entry.eventCode,
      transaction_initiation_date: searchTime(entry.createdAt),
      transaction_updated_date: searchTime(entry.createdAt),
      transaction_amount: toAmount(entry.amountCents),
      fee_amount: toAmount(fee),
      transaction_status: entry.status || 'S',
      transaction_subject: entry.subject || '',
      ...(entry.invoiceId ? { invoice_id: entry.invoiceId } : {}),
      ...(entry.customField ? { custom_field: entry.customField } : {}),
      protection_eligibility: '01',
      ending_balance: toAmount(entry.endingBalanceCents ?? 0),
      available_balance: toAmount(entry.endingBalanceCents ?? 0),
    }
  }

  // ---------- Orders v2 ----------

  function authorizationBody(auth) {
    return {
      id: auth.id,
      status: auth.status,
      amount: toAmount(auth.amountCents),
      invoice_id: auth.invoiceId,
      custom_id: auth.customId,
      seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] },
      expiration_time: iso(auth.createdAt + AUTH_VALID_MS),
      create_time: iso(auth.createdAt),
      update_time: iso(auth.updatedAt),
    }
  }

  function captureBody(cap) {
    const fee = cap.feeCents
    const refunded = cap.refundedCents
    return {
      id: cap.id,
      status: refunded >= cap.amountCents ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : 'COMPLETED',
      amount: toAmount(cap.amountCents),
      invoice_id: cap.invoiceId,
      custom_id: cap.customId,
      final_capture: cap.finalCapture,
      seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] },
      seller_receivable_breakdown: {
        gross_amount: toAmount(cap.amountCents),
        paypal_fee: toAmount(fee),
        net_amount: toAmount(cap.amountCents - fee),
      },
      create_time: iso(cap.createdAt),
      update_time: iso(cap.updatedAt),
    }
  }

  function orderBody(order) {
    const unit = order.unit
    const auths = unit.authorizationIds.map((id) => authorizationBody(authorizations.get(id)))
    const caps = unit.captureIds.map((id) => captureBody(captures.get(id)))
    return {
      id: order.id,
      status: order.status,
      intent: order.intent,
      payment_source: order.source.kind === 'card'
        ? { card: { name: 'Test Buyer', last_digits: order.source.last4 || '1111', brand: 'VISA', type: 'CREDIT' } }
        : { paypal: { email_address: order.source.email || 'buyer@example.com', account_id: order.source.accountId, name: { given_name: 'Test', surname: 'Buyer' } } },
      purchase_units: [{
        reference_id: 'default',
        amount: toAmount(unit.amountCents),
        custom_id: unit.customId,
        invoice_id: unit.invoiceId,
        payments: {
          ...(auths.length ? { authorizations: auths } : {}),
          ...(caps.length ? { captures: caps } : {}),
        },
      }],
      create_time: iso(order.createdAt),
      update_time: iso(order.createdAt),
      links: [{ href: `https://api.sandbox.paypal.com/v2/checkout/orders/${order.id}`, rel: 'self', method: 'GET' }],
    }
  }

  function makeCapture({ authId, order, amountCents, finalCapture, invoiceId, customId }) {
    const createdAt = authId ? now() : order.createdAt
    const cap = {
      id: randomId(17), amountCents, feeCents: feeFor(amountCents), refundedCents: 0, finalCapture: !!finalCapture,
      invoiceId, customId, createdAt, updatedAt: createdAt, orderId: order.id, authId, source: order.source,
    }
    captures.set(cap.id, cap)
    order.unit.captureIds.push(cap.id)
    accountBalanceCents += amountCents - cap.feeCents
    indexTransaction({
      id: cap.id, eventCode: 'T0006', createdAt, amountCents, feeCents: cap.feeCents, customField: customId, invoiceId,
      subject: 'Checkout payment', payer: payerOf(order.source), endingBalanceCents: accountBalanceCents,
    })
    return cap
  }

  const api = {
    settings,
    callLog,
    now,

    // Orders v2: seed helper for authorizations and captures. A card source completes without a buyer screen.
    // `createdAtMs` back-dates the payment (seed helper: a duplicate that happened minutes after the first).
    async createOrder({ intent, amountCents, customId, invoiceId, source = { kind: 'card', last4: '1111' }, buyerEmail, createdAtMs }) {
      if (!['CAPTURE', 'AUTHORIZE'].includes(intent)) throw new PayPalError(400, 'INVALID_REQUEST', 'intent must be CAPTURE or AUTHORIZE', 'INVALID_PARAMETER_VALUE')
      if (customId && customId.length > 255) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'custom_id too long', 'FIELD_VALUE_TOO_LONG')
      const createdAt = createdAtMs ?? now()
      const src = source.kind === 'paypal'
        ? { accountId: randomId(13), email: buyerEmail || 'buyer@example.com', ...source }
        : { accountId: randomId(13), ...source } // card payers often carry no e-mail in payer_info
      const order = {
        id: randomId(17), intent, status: 'COMPLETED', createdAt, source: src,
        unit: { amountCents, customId, invoiceId, authorizationIds: [], captureIds: [] },
      }
      orders.set(order.id, order)
      if (intent === 'AUTHORIZE') {
        const auth = { id: randomId(17), status: 'CREATED', amountCents, createdAt, updatedAt: createdAt, customId, invoiceId, orderId: order.id, capturedCents: 0, source: src }
        authorizations.set(auth.id, auth)
        order.unit.authorizationIds.push(auth.id)
      } else {
        makeCapture({ order, amountCents, finalCapture: true, invoiceId, customId })
      }
      record({ call: 'POST /v2/checkout/orders', intent })
      return orderBody(order)
    },

    // The mock completes every order at creation, so completing again just reads it.
    async completeOrder(id) {
      return api.getOrder(id)
    },

    async getOrder(id) {
      const order = orders.get(id)
      if (!order) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
      record({ call: 'GET /v2/checkout/orders/{id}', id })
      return orderBody(order)
    },

    // ---------- Payments v2 ----------

    async getAuthorization(id) {
      const auth = authorizations.get(id)
      if (!auth) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
      record({ call: 'GET /v2/payments/authorizations/{id}', id })
      return authorizationBody(auth)
    },

    async captureAuthorization(id, { amountCents, finalCapture = true, invoiceId, requestId } = {}) {
      return idempotent(requestId, async () => {
        const auth = authorizations.get(id)
        if (!auth) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
        record({ call: 'POST /v2/payments/authorizations/{id}/capture', id, amountCents })
        if (auth.status === 'VOIDED') throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Authorization has been voided.', 'AUTHORIZATION_VOIDED')
        if (auth.status === 'CAPTURED') throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Authorization already captured.', 'AUTHORIZATION_ALREADY_CAPTURED')
        if (now() > auth.createdAt + AUTH_VALID_MS) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Authorization has expired.', 'AUTHORIZATION_EXPIRED')
        const value = amountCents ?? auth.amountCents - auth.capturedCents
        if (auth.capturedCents + value > auth.amountCents) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Capture exceeds the authorized amount.', 'CAPTURE_AMOUNT_EXCEEDS_AUTHORIZED')
        const order = orders.get(auth.orderId)
        const cap = makeCapture({ authId: id, order, amountCents: value, finalCapture, invoiceId: invoiceId || auth.invoiceId, customId: auth.customId })
        auth.capturedCents += value
        auth.status = finalCapture ? 'CAPTURED' : 'PARTIALLY_CAPTURED'
        auth.updatedAt = now()
        return captureBody(cap)
      })
    },

    // A reauthorization generates a new authorization ID and restarts the honor period.
    async reauthorizeAuthorization(id, { amountCents, requestId } = {}) {
      return idempotent(requestId, async () => {
        const auth = authorizations.get(id)
        if (!auth) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
        record({ call: 'POST /v2/payments/authorizations/{id}/reauthorize', id })
        if (auth.source.kind === 'card' && !settings.cardReauthSupported) {
          throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Reauthorization is not supported for this payment source.', 'REAUTHORIZATION_NOT_SUPPORTED')
        }
        if (now() < auth.createdAt + HONOR_PERIOD_MS) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Reauthorization is only allowed after the honor period.', 'REAUTHORIZATION_TOO_SOON')
        if (now() > auth.createdAt + AUTH_VALID_MS) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Authorization has expired.', 'AUTHORIZATION_EXPIRED')
        if (auth.status !== 'CREATED') throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Authorization is not open.', 'AUTHORIZATION_ALREADY_CAPTURED')
        const next = { ...auth, id: randomId(17), createdAt: now(), updatedAt: now(), amountCents: amountCents ?? auth.amountCents, status: 'CREATED', capturedCents: 0 }
        authorizations.set(next.id, next)
        auth.status = 'VOIDED'
        const order = orders.get(auth.orderId)
        order.unit.authorizationIds = order.unit.authorizationIds.filter((x) => x !== id).concat(next.id)
        return authorizationBody(next)
      })
    },

    async voidAuthorization(id, { requestId } = {}) {
      return idempotent(requestId, async () => {
        const auth = authorizations.get(id)
        if (!auth) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
        record({ call: 'POST /v2/payments/authorizations/{id}/void', id })
        if (auth.status === 'VOIDED') throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Authorization already voided.', 'PREVIOUSLY_VOIDED')
        if (auth.status === 'CAPTURED') throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Authorization already captured.', 'AUTHORIZATION_ALREADY_CAPTURED')
        auth.status = 'VOIDED'
        auth.updatedAt = now()
        return { id, status: 'VOIDED' }
      })
    },

    async getCapture(id) {
      const cap = captures.get(id)
      if (!cap) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
      record({ call: 'GET /v2/payments/captures/{id}', id })
      return captureBody(cap)
    },

    async refundCapture(id, { amountCents = null, noteToPayer, invoiceId, requestId } = {}) {
      return idempotent(requestId, async () => {
        const cap = captures.get(id)
        if (!cap) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
        record({ call: 'POST /v2/payments/captures/{id}/refund', id, amountCents })
        const remaining = cap.amountCents - cap.refundedCents
        const value = amountCents ?? remaining
        if (value <= 0) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Capture is already fully refunded.', 'CAPTURE_FULLY_REFUNDED')
        if (value > remaining) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Refund amount exceeds the captured amount.', 'REFUND_AMOUNT_EXCEEDED')
        const createdAt = now()
        const refund = { id: randomId(17), captureId: id, amountCents: value, createdAt, noteToPayer, invoiceId }
        refunds.set(refund.id, refund)
        cap.refundedCents += value
        accountBalanceCents -= value
        // The refund line has no custom_field of its own: it points at the original payment.
        indexTransaction({
          id: refund.id, eventCode: 'T1107', createdAt, amountCents: -value, feeCents: 0,
          referenceId: id, referenceType: 'TXN', subject: 'Payment refund', payer: payerOf(cap.source), endingBalanceCents: accountBalanceCents,
        })
        return {
          id: refund.id,
          status: 'COMPLETED',
          amount: toAmount(value),
          note_to_payer: noteToPayer,
          invoice_id: invoiceId,
          seller_payable_breakdown: {
            gross_amount: toAmount(value),
            paypal_fee: toAmount(0),
            net_amount: toAmount(value),
            total_refunded_amount: toAmount(cap.refundedCents),
          },
          create_time: iso(createdAt),
          update_time: iso(createdAt),
        }
      })
    },

    // ---------- Transaction Search v1 ----------

    async searchTransactions({ startDate, endDate, transactionStatus, transactionId, page = 1, pageSize = 100, fields = 'transaction_info' } = {}) {
      if (!settings.searchScope) {
        throw new PayPalError(403, 'NOT_AUTHORIZED', 'Authorization failed due to insufficient permissions.', 'PERMISSION_DENIED')
      }
      const start = Date.parse(startDate)
      const end = Date.parse(endDate)
      if (Number.isNaN(start) || Number.isNaN(end)) throw new PayPalError(400, 'INVALID_REQUEST', 'start_date and end_date are required ISO 8601 date times.', 'MISSING_REQUIRED_PARAMETER')
      if (end - start > SEARCH_RANGE_MAX_MS) throw new PayPalError(400, 'INVALID_REQUEST', 'Date range is greater than 31 days.', 'DATE_RANGE_TOO_LARGE')
      if (pageSize < 1 || pageSize > 500) throw new PayPalError(400, 'INVALID_REQUEST', 'page_size must be between 1 and 500.', 'INVALID_PARAMETER_VALUE')
      const wantStatus = transactionStatus || null
      const current = now()
      const hits = transactions.filter((t) => {
        if (current < t.visibleAt) return false // not indexed yet (up to three hours)
        if (t.createdAt < start || t.createdAt > end) return false
        if (transactionId && t.id !== transactionId) return false
        if (wantStatus && (t.status || 'S') !== wantStatus) return false
        return true
      }).sort((a, b) => a.createdAt - b.createdAt)
      const totalItems = hits.length
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
      const slice = hits.slice((page - 1) * pageSize, page * pageSize)
      const wantAll = fields === 'all'
      record({ call: 'GET /v1/reporting/transactions', startDate, endDate, page, pageSize, count: slice.length })
      return {
        transaction_details: slice.map((entry) => ({
          transaction_info: txnInfo(entry),
          ...(wantAll || fields.includes('payer_info') ? { payer_info: entry.payer } : {}),
          ...(wantAll || fields.includes('cart_info') ? { cart_info: {} } : {}),
        })),
        account_number: 'MOCKMERCHANT1',
        start_date: searchTime(start),
        end_date: searchTime(end),
        last_refreshed_datetime: searchTime(current),
        page,
        total_items: totalItems,
        total_pages: totalPages,
        links: [{ href: 'https://api-m.sandbox.paypal.com/v1/reporting/transactions', rel: 'self', method: 'GET' }],
      }
    },

    async getBalances() {
      if (!settings.balancesScope) throw new PayPalError(403, 'NOT_AUTHORIZED', 'Authorization failed due to insufficient permissions.', 'PERMISSION_DENIED')
      record({ call: 'GET /v1/reporting/balances' })
      return {
        balances: [{ currency: 'USD', primary: true, total_balance: toAmount(accountBalanceCents), available_balance: toAmount(accountBalanceCents), withheld_balance: toAmount(0) }],
        account_id: 'MOCKMERCHANT1',
        as_of_time: iso(now()),
        last_refresh_time: iso(now()),
      }
    },

    // ---------- Invoicing v2 ----------

    async createInvoice({ invoiceNumber, amountCents, description, recipientEmail, requestId }) {
      if (!settings.invoicingWorks) throw new PayPalError(500, 'INTERNAL_SERVER_ERROR', 'Invoicing is not available in this sandbox.', 'INTERNAL')
      if (invoiceNumber && invoiceNumber.length > 25) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'invoice_number is too long.', 'FIELD_VALUE_TOO_LONG')
      return idempotent(requestId, async () => {
        if ([...invoices.values()].some((inv) => inv.detail.invoice_number === invoiceNumber)) {
          throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Duplicate invoice number.', 'DUPLICATE_INVOICE_NUMBER')
        }
        invoiceCounter += 1
        const id = `INV2-${randomId(4)}-${randomId(4)}-${randomId(4)}-${randomId(4)}`
        const invoice = {
          id,
          status: 'DRAFT',
          detail: { invoice_number: invoiceNumber || `0000${invoiceCounter}`, invoice_date: iso(now()).slice(0, 10), currency_code: 'USD', note: description },
          invoicer: { business_name: 'Brightloom Candles' },
          primary_recipients: [{ billing_info: { email_address: recipientEmail } }],
          items: [{ name: description || 'Order', quantity: '1', unit_amount: toAmount(amountCents) }],
          amount: { currency_code: 'USD', value: toValue(amountCents) },
          due_amount: toAmount(amountCents),
          payments: { transactions: [] },
        }
        invoices.set(id, invoice)
        record({ call: 'POST /v2/invoicing/invoices', invoiceNumber })
        return { rel: 'self', href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}`, method: 'GET' }
      })
    },

    async sendInvoice(id, { requestId } = {}) {
      return idempotent(requestId, async () => {
        const invoice = invoices.get(id)
        if (!invoice) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
        if (invoice.status !== 'DRAFT') throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Invoice was already sent.', 'INVALID_INVOICE_STATUS')
        invoice.status = 'SENT'
        record({ call: 'POST /v2/invoicing/invoices/{id}/send', id })
        return { rel: 'self', href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}`, method: 'GET' }
      })
    },

    async getInvoice(id) {
      const invoice = invoices.get(id)
      if (!invoice) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
      return structuredClone(invoice)
    },

    // POST /v2/invoicing/search-invoices. Looks up by exact invoice number only.
    async searchInvoices({ invoiceNumber } = {}) {
      const items = [...invoices.values()].filter((inv) => !invoiceNumber || inv.detail.invoice_number === invoiceNumber)
      record({ call: 'POST /v2/invoicing/search-invoices', invoiceNumber, count: items.length })
      return { total_items: items.length, total_pages: 1, items: structuredClone(items) }
    },

    // POST /v2/invoicing/invoices/{id}/payments
    async recordInvoicePayment(id, { method = 'BANK_TRANSFER', amountCents, date, requestId }) {
      return idempotent(requestId, async () => {
        const invoice = invoices.get(id)
        if (!invoice) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', 'INVALID_RESOURCE_ID')
        if (!['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(invoice.status)) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Invoice cannot take a payment in this status.', 'INVALID_INVOICE_STATUS')
        const paymentId = `EXTR-${randomId(12)}`
        invoice.payments.transactions.push({ payment_id: paymentId, method, amount: toAmount(amountCents), payment_date: date })
        invoice.status = amountCents >= fromAmount(invoice.amount) ? 'MARKED_AS_PAID' : 'PARTIALLY_PAID'
        invoice.due_amount = toAmount(Math.max(0, fromAmount(invoice.amount) - amountCents))
        record({ call: 'POST /v2/invoicing/invoices/{id}/payments', id })
        return { payment_id: paymentId }
      })
    },

    // ---------- test and demo controls ----------
    setSearchScope(on) { settings.searchScope = on },
    expireAuthorization(id, ageMs = AUTH_VALID_MS + DAY) {
      const auth = authorizations.get(id)
      auth.createdAt = now() - ageMs
    },
    ageAuthorization(id, ageMs) {
      const auth = authorizations.get(id)
      auth.createdAt = now() - ageMs
    },
    rawTransactions: () => transactions,
    customerRefundTotal: (captureId) => captures.get(captureId)?.refundedCents ?? 0,
    holdStatus: (authId) => authorizations.get(authId)?.status,
    toCents,
  }
  return api
}

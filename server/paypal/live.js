import { config } from '../config.js'
import { toAmount, toValue, fromAmount } from '../util/money.js'
import { PayPalError } from './mock.js'
import { createSdkPaypal } from './sdk.js'
import { getSdkClient, resetSdkClient } from './sdkClient.js'

// Live sandbox client. It exposes the same methods as the mock in mock.js and is only used when
// PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set. Nothing here runs in tests.
// Orders, Payments and Transaction Search live in sdk.js (APIMatic SDK). This file keeps what the SDK lacks:
// Invoicing, the scope probe and the token terminate call.
const API_BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com'
let token = { value: null, expires: 0, scope: '' }

async function accessToken() {
  if (token.value && Date.now() < token.expires - 60_000) return token.value
  const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64')
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new PayPalError(res.status, 'AUTH_FAILED', 'PayPal OAuth failed', String(res.status))
  const data = await res.json()
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000, scope: data.scope || '' }
  return token.value
}

export const tokenScopes = async () => {
  await accessToken()
  return token.scope.split(' ').filter(Boolean)
}

// VERIFY.md item 1: the terminate endpoint is not in the REST reference. See VERIFY.md for the fallback.
export async function terminateToken() {
  const current = await accessToken()
  const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64')
  const res = await fetch(`${API_BASE}/v1/oauth2/token/terminate`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: current }).toString(),
  })
  token = { value: null, expires: 0, scope: '' }
  resetSdkClient() // the SDK client caches its own token
  return { ok: res.ok, status: res.status }
}

async function rest(method, path, body, requestId) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const issue = data.details?.[0]?.issue
    throw new PayPalError(res.status, data.name || 'ERROR', data.message, issue)
  }
  return data
}

export function createLivePaypal({ sdk = createSdkPaypal({ client: getSdkClient }) } = {}) {
  return {
    // Orders, Payments and Transaction Search go through the APIMatic SDK (sdk.js).
    ...sdk,
    // Not in the SDK (it has no Invoicing resource): these stay on REST.
    // With Prefer: return=representation the sandbox answers the whole invoice, not a link. Callers read the
    // self link, so it is rebuilt from the id (seen 2026-11-12).
    createInvoice: async ({ invoiceNumber, amountCents, description, recipientEmail, requestId }) => {
      const res = await rest('POST', '/v2/invoicing/invoices', {
        detail: { invoice_number: invoiceNumber, currency_code: 'USD', note: description },
        primary_recipients: [{ billing_info: { email_address: recipientEmail } }],
        items: [{ name: description || 'Order', quantity: '1', unit_amount: toAmount(amountCents) }],
      }, requestId)
      if (res.href) return res
      if (!res.id) throw new PayPalError(502, 'UNREADABLE', 'Invoice create answered without an id.')
      return { rel: 'self', href: `${API_BASE}/v2/invoicing/invoices/${res.id}`, method: 'GET' }
    },
    sendInvoice: (id, { requestId } = {}) => rest('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true }, requestId),
    getInvoice: (id) => rest('GET', `/v2/invoicing/invoices/${id}`),
    searchInvoices: ({ invoiceNumber }) => rest('POST', '/v2/invoicing/search-invoices?page=1&page_size=20&total_required=true', { invoice_number: invoiceNumber }),
    recordInvoicePayment: (id, { method = 'BANK_TRANSFER', amountCents, date, requestId }) =>
      rest('POST', `/v2/invoicing/invoices/${id}/payments`, { method, payment_date: date, amount: { currency_code: 'USD', value: toValue(amountCents) } }, requestId),
    fromAmount,
  }
}

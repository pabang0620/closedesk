import {
  orderSchema, orderAuthorizeResponseSchema, capturedPaymentSchema, paymentAuthorizationSchema,
  refundSchema, searchResponseSchema, balancesResponseSchema,
} from 'paypal'
import { toValue, toCents, CURRENCY } from '../util/money.js'
import { stableHash } from '../util/ids.js'
import { createClaimStore } from './claims.js'
import { classify, UnreadableAnswer } from './sdkErrors.js'
import { runWrite } from './sdkWrites.js'

// PayPal operations that the APIMatic SDK covers. Same method names and result shapes as mock.js and live.js:
// results are handed out in wire (snake_case) shape with `<model>Schema.encode`, so callers do not change.
// Invoicing is not in the SDK and stays on REST in live.js.
// Writes are sent once (no resend) because the claim plus the re-read is the policy here.
const WRITE_ONCE = { retry: { maxRetries: 0 } }
const FULL_ORDER = 'return=representation'
const REREAD_WINDOW_BEFORE_MS = 5 * 60_000
// Sandbox test card, the same one live.js used for seeding without a buyer screen.
const TEST_CARD = {
  number: '4111111111111111', expiry: '2030-12', name: 'Test Buyer',
  billingAddress: { addressLine1: '1 Main St', adminArea2: 'San Jose', adminArea1: 'CA', postalCode: '95131', countryCode: 'US' },
}

const toMoney = (cents) => ({ currencyCode: CURRENCY, value: toValue(cents) })
const wire = (schema, value) => schema.encode(value)
const has = (value, operation) => {
  if (!value?.id) throw new UnreadableAnswer(operation)
  return value
}

export function createSdkPaypal({ client: clientOrGetter, now = () => Date.now(), claims = createClaimStore({ now }), log = (message) => console.error(message) } = {}) {
  // A getter lets resetSdkClient() swap the client (and its token cache) without rebuilding this adapter.
  const api = () => (typeof clientOrGetter === 'function' ? clientOrGetter() : clientOrGetter)

  const read = async (call, schema) => {
    try {
      return wire(schema, await call())
    } catch (err) {
      throw classify(err, { write: false, log }).error
    }
  }

  const authorization = (authorizationId) => read(() => api().payments.getAuthorizedPayment({ authorizationId }), paymentAuthorizationSchema)

  async function searchWindow(sinceMs) {
    return api().transactionSearch.searchTransactions({
      startDate: new Date(sinceMs - REREAD_WINDOW_BEFORE_MS).toISOString(),
      endDate: new Date(now() + 60_000).toISOString(),
      fields: 'all', pageSize: 500, page: 1,
    })
  }

  async function refundCapture(captureId, { amountCents, noteToPayer, invoiceId, requestId } = {}) {
    const rid = requestId || stableHash('refund', captureId)
    const body = {
      ...(amountCents == null ? {} : { amount: toMoney(amountCents) }),
      ...(noteToPayer ? { noteToPayer } : {}),
      ...(invoiceId ? { invoiceId } : {}),
    }
    return runWrite({
      claims, log, key: `refund:${captureId}:${rid}`,
      send: () => api().payments.refundCapturedPayment({ captureId, payPalRequestId: rid, body }, WRITE_ONCE),
      check: (res) => wire(refundSchema, has(res, 'refundCapturedPayment')),
      // Transaction Search shows the refund as a T1107 line that points back at the capture.
      reread: async (claimMs) => {
        const res = await searchWindow(claimMs)
        const line = (res.transactionDetails || []).map((d) => d.transactionInfo).find((i) => i?.paypalReferenceId === captureId
          && i.transactionEventCode === 'T1107'
          && (amountCents == null || Math.abs(toCents(i.transactionAmount?.value ?? '0')) === amountCents))
        return line ? { id: line.transactionId, status: 'COMPLETED' } : null
      },
    })
  }

  async function captureAuthorization(authorizationId, { amountCents, finalCapture = true, invoiceId, requestId } = {}) {
    const rid = requestId || stableHash('capture', authorizationId)
    const body = { ...(amountCents == null ? {} : { amount: toMoney(amountCents) }), finalCapture, ...(invoiceId ? { invoiceId } : {}) }
    return runWrite({
      claims, log, key: `capture:${authorizationId}:${rid}`,
      send: () => api().payments.captureAuthorizedPayment({ authorizationId, payPalRequestId: rid, body }, WRITE_ONCE),
      check: (res) => wire(capturedPaymentSchema, has(res, 'captureAuthorizedPayment')),
      reread: async (claimMs) => {
        const auth = await authorization(authorizationId)
        if (auth.status !== 'CAPTURED') return null
        let id = null
        try {
          const res = await searchWindow(claimMs)
          id = (res.transactionDetails || []).map((d) => d.transactionInfo).find((i) => i?.paypalReferenceId === authorizationId)?.transactionId ?? null
        } catch {
          // The capture id is a nicety. The authorization state already settles the outcome.
        }
        return { id, status: 'COMPLETED', amount: auth.amount }
      },
    })
  }

  async function reauthorizeAuthorization(authorizationId, { amountCents, requestId } = {}) {
    const rid = requestId || stableHash('reauth', authorizationId)
    const body = amountCents == null ? {} : { amount: toMoney(amountCents) }
    return runWrite({
      claims, log, key: `reauth:${authorizationId}:${rid}`,
      send: () => api().payments.reauthorizePayment({ authorizationId, payPalRequestId: rid, body }, WRITE_ONCE),
      check: (res) => wire(paymentAuthorizationSchema, has(res, 'reauthorizePayment')),
      reread: async (claimMs) => {
        const auth = await authorization(authorizationId)
        return auth.status === 'CREATED' && Date.parse(auth.update_time) >= claimMs ? auth : null
      },
    })
  }

  async function voidAuthorization(authorizationId, { requestId } = {}) {
    const rid = requestId || stableHash('void', authorizationId)
    return runWrite({
      claims, log, key: `void:${authorizationId}:${rid}`,
      // PayPal may answer a void with 204 and no body. That reads as an unreadable 2xx and is settled by the re-read.
      send: () => api().payments.voidPayment({ authorizationId, payPalRequestId: rid }, WRITE_ONCE),
      check: () => ({ id: authorizationId, status: 'VOIDED' }),
      reread: async () => {
        const auth = await authorization(authorizationId)
        return auth.status === 'VOIDED' ? { id: authorizationId, status: 'VOIDED' } : null
      },
    })
  }

  // The order is settled when PayPal holds it as COMPLETED.
  const orderDone = async (id) => {
    const order = await read(() => api().orders.getOrder({ id }), orderSchema)
    return order.status === 'COMPLETED' ? order : null
  }

  async function finishOrder(order, intent) {
    const op = intent === 'AUTHORIZE' ? 'authorize-order' : 'capture-order'
    const call = intent === 'AUTHORIZE' ? api().orders.authorizeOrder.bind(api().orders) : api().orders.captureOrder.bind(api().orders)
    return runWrite({
      claims, log, key: `${op}:${order.id}`,
      send: () => call({ id: order.id, payPalRequestId: stableHash(op, order.id), body: {}, prefer: FULL_ORDER }, WRITE_ONCE),
      check: (res) => wire(intent === 'AUTHORIZE' ? orderAuthorizeResponseSchema : orderSchema, has(res, op)),
      reread: () => orderDone(order.id),
    })
  }

  // Card source: the sandbox business account must have card processing, and the order completes with no buyer screen.
  // PayPal source: the order waits for the buyer (PAYER_ACTION_REQUIRED, `payer-action` link). After the buyer approves,
  // completeOrder authorizes or captures it. This path works on a sandbox account without card processing.
  const paymentSourceFor = (source, returnUrl, cancelUrl) => (source?.kind === 'paypal'
    ? { paypal: { experienceContext: { returnUrl, cancelUrl: cancelUrl || returnUrl, userAction: 'PAY_NOW', shippingPreference: 'NO_SHIPPING' } } }
    : { card: TEST_CARD })

  async function createOrder({ intent, amountCents, customId, invoiceId, source, returnUrl = 'https://example.com/return', cancelUrl }) {
    const body = {
      intent,
      purchaseUnits: [{ amount: toMoney(amountCents), customId, invoiceId }],
      paymentSource: paymentSourceFor(source, returnUrl, cancelUrl),
    }
    const order = await runWrite({
      claims, log, key: `create-order:${invoiceId}`,
      send: () => api().orders.createOrder({ body, payPalRequestId: stableHash('create-order', invoiceId), prefer: FULL_ORDER }, WRITE_ONCE),
      check: (res) => wire(orderSchema, has(res, 'createOrder')),
      // PayPal offers no lookup of an order by our reference. See paypal-plan.md, Blockers.
      reread: async () => null,
    })
    if (order.status === 'COMPLETED' || source?.kind === 'paypal') return order
    return finishOrder(order, intent)
  }

  // After the buyer approved a PayPal-account order: authorize or capture it.
  const completeOrder = async (orderId, intent) => {
    const order = await read(() => api().orders.getOrder({ id: orderId }), orderSchema)
    return order.status === 'COMPLETED' ? order : finishOrder(order, intent)
  }

  return {
    createOrder,
    completeOrder,
    getOrder: (id) => read(() => api().orders.getOrder({ id }), orderSchema),
    getAuthorization: authorization,
    captureAuthorization,
    reauthorizeAuthorization,
    voidAuthorization,
    getCapture: (captureId) => read(() => api().payments.getCapturedPayment({ captureId }), capturedPaymentSchema),
    refundCapture,
    searchTransactions: ({ startDate, endDate, transactionStatus, transactionId, page = 1, pageSize = 100, fields = 'transaction_info' }) =>
      read(() => api().transactionSearch.searchTransactions({
        startDate, endDate, fields, pageSize, page,
        ...(transactionStatus ? { transactionStatus } : {}),
        ...(transactionId ? { transactionId } : {}),
      }), searchResponseSchema),
    getBalances: () => read(() => api().transactionSearch.searchBalances({ asOfTime: new Date(now()).toISOString(), currencyCode: CURRENCY }), balancesResponseSchema),
  }
}

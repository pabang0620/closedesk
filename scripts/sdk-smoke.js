// Read-only smoke of the SDK path against a real sandbox credential. NOT run by tests or CI.
// Usage: PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npm run sdk:smoke
// It only calls GET operations: searchBalances, searchTransactions (last 24 hours, one row) and, when
// SMOKE_ORDER_ID / SMOKE_CAPTURE_ID / SMOKE_AUTH_ID are set, getOrder / getCapturedPayment / getAuthorizedPayment.
import 'dotenv/config'
import { createSdkPaypal } from '../server/paypal/sdk.js'
import { buildSdkClient } from '../server/paypal/sdkClient.js'

const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret, PAYPAL_API_BASE: baseUrl } = process.env
if (!clientId || !clientSecret) {
  process.stderr.write('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox).\n')
  process.exit(2)
}

const paypal = createSdkPaypal({ client: buildSdkClient({ clientId, clientSecret, ...(baseUrl ? { baseUrl } : {}) }) })
const out = (line) => process.stdout.write(`${line}\n`)
const now = Date.now()

const steps = [
  ['searchBalances', () => paypal.getBalances(), (r) => `${r.balances?.length ?? 0} balances`],
  ['searchTransactions', () => paypal.searchTransactions({ startDate: new Date(now - 86_400_000).toISOString(), endDate: new Date(now).toISOString(), pageSize: 1, fields: 'transaction_info' }), (r) => `${r.total_items ?? 0} items, ${r.total_pages ?? 0} pages`],
  ...(process.env.SMOKE_ORDER_ID ? [['getOrder', () => paypal.getOrder(process.env.SMOKE_ORDER_ID), (r) => r.status]] : []),
  ...(process.env.SMOKE_CAPTURE_ID ? [['getCapturedPayment', () => paypal.getCapture(process.env.SMOKE_CAPTURE_ID), (r) => r.status]] : []),
  ...(process.env.SMOKE_AUTH_ID ? [['getAuthorizedPayment', () => paypal.getAuthorization(process.env.SMOKE_AUTH_ID), (r) => r.status]] : []),
]

let failed = 0
for (const [name, call, show] of steps) {
  try {
    out(`ok   ${name}: ${show(await call())}`)
  } catch (err) {
    failed += 1
    out(`FAIL ${name}: status ${err.status ?? '-'} ${err.message}`)
  }
}
process.exit(failed ? 1 : 0)

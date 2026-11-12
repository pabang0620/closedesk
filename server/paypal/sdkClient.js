import { PaypalClient } from 'paypal'
import { config } from '../config.js'

// The SDK declares one environment (the sandbox) and no selector, so another host is a base-URL override.
// This app only ever talks to the sandbox. Anything else fails here, before a credential is sent.
export const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com'
const LOCAL_HOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/

export function assertSandboxHost(baseUrl) {
  const clean = String(baseUrl).replace(/\/$/, '')
  if (clean === SANDBOX_BASE || LOCAL_HOST.test(clean)) return clean
  throw new Error(`PAYPAL_API_BASE must be the PayPal sandbox (${SANDBOX_BASE}) or a local test server. Got ${clean}.`)
}

// Logging is off and set explicitly so PAYPAL_CLIENT_LOG cannot turn it on. A JSON request body is logged
// verbatim, and createOrder carries card data, so the body is never logged.
export function buildSdkClient({ clientId, clientSecret, baseUrl = SANDBOX_BASE, fetchImpl, retry } = {}) {
  return new PaypalClient({
    oauth2: { clientId, clientSecret },
    serverOptions: { baseUrl: assertSandboxHost(baseUrl) },
    retry: { timeout: 20_000, ...retry },
    logging: { level: 'off' },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
}

// One client per process: resources and the OAuth token cache live on it.
let held = null

export function getSdkClient() {
  if (!held) held = buildSdkClient({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, baseUrl: config.paypalApiBase })
  return held
}

export function resetSdkClient() {
  held = null
}

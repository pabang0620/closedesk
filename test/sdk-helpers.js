import { buildSdkClient } from '../server/paypal/sdkClient.js'
import { createSdkPaypal } from '../server/paypal/sdk.js'
import { createClaimStore } from '../server/paypal/claims.js'

export const json = (status, body) => new Response(JSON.stringify(body), { status })
export const empty = (status = 204) => new Response(null, { status })
export const tokenOk = () => json(200, { access_token: 'T', token_type: 'Bearer', expires_in: 3600 })

export const money = (value) => ({ currency_code: 'USD', value })
export const errorBody = (name, issue, description) => ({ name, message: `${name} message`, debug_id: 'dbg-1', details: [{ issue, description }] })

// A fake PayPal behind ClientOptions.fetch. The SDK hands it one Request and no init.
// `route(call)` returns a Response, throws to simulate a dropped connection, or returns a promise that never settles.
export function makeFake(route, { token = tokenOk } = {}) {
  const calls = []
  const fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/v1/oauth2/token') return token()
    const text = request.body === null ? undefined : await request.clone().text()
    const call = { method: request.method, path: url.pathname, query: url.searchParams, headers: request.headers, body: text === undefined ? undefined : JSON.parse(text) }
    calls.push(call)
    return route(call, request)
  }
  return { fetch, calls, at: (method, suffix) => calls.filter((c) => c.method === method && c.path.endsWith(suffix)) }
}

// Hangs until the SDK aborts the attempt (retry.timeout), as the testing skill describes.
export const hang = (request) => new Promise((_resolve, reject) => {
  request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
})

export function makeAdapter(route, opts = {}) {
  const fake = makeFake(route, opts)
  const client = buildSdkClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: fake.fetch, retry: { maxRetries: 0, timeout: 40 } })
  const claims = opts.claims || createClaimStore()
  const logged = []
  const paypal = createSdkPaypal({ client, claims, log: (m) => logged.push(m) })
  return { paypal, fake, claims, logged }
}

export const expectErr = async (promise) => {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected a rejection')
}

export const searchPage = (infos) => ({ transaction_details: infos.map((transaction_info) => ({ transaction_info })), page: 1, total_items: infos.length, total_pages: 1 })

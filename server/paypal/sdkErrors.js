import { PaypalError } from 'paypal'
import { PayPalError } from './mock.js'

// One translator for every SDK failure. The provider status stays on `status` (reporting code reads a 403 as
// "scope missing"); `appStatus` is what this app answers. SDK `message` text names the call and is never sent
// to the caller. Only the API's own reason (4xx the caller caused) or a fixed sentence is.
export const OUTCOME_UNKNOWN = 'OUTCOME_UNKNOWN'

export class UnreadableAnswer extends Error {
  constructor(operation) {
    super(`${operation} answered without the identifier the app depends on.`)
    this.name = 'UnreadableAnswer'
  }
}

const FIXED = {
  credentials: 'PayPal rejected this app’s credentials or scope.',
  quota: 'PayPal is rate limiting this app. Try again later.',
  server: 'PayPal had an error.',
  unreadable: 'PayPal answered with something unreadable.',
  unreachable: 'PayPal could not be reached.',
  rejected: 'PayPal rejected the request.',
  unknown: 'Outcome unknown. PayPal may have acted on this request. Check PayPal before trying again.',
  defect: 'The app built a request PayPal client code refused to send.',
}

function make({ status, appStatus, code, message, issue, unknown = false }) {
  const err = new PayPalError(status, code, message, issue)
  err.message = message
  err.code = code
  err.appStatus = appStatus
  err.unknown = unknown
  return err
}

// The declared error body of the operation (Error, SearchError, DefaultError all share name, message, details).
function reasonOf(payload) {
  const body = payload && typeof payload === 'object' && 'body' in payload ? payload.body : undefined
  if (!body || typeof body !== 'object') return {}
  const details = Array.isArray(body.details) ? body.details : []
  const text = [...new Set([body.message, ...details.map((d) => d.description || d.issue)].filter(Boolean))].join('; ')
  return { name: body.name, issue: details[0]?.issue, text, debugId: body.debugId }
}

function fromStatus(status, reason = {}) {
  if (status === 401 || status === 403) return make({ status, appStatus: 502, code: 'PAYPAL_CREDENTIALS', message: FIXED.credentials, issue: reason.issue || reason.name })
  if (status === 429) return make({ status, appStatus: 503, code: 'PAYPAL_RATE_LIMIT', message: FIXED.quota })
  if (status >= 400 && status < 500) return make({ status, appStatus: status, code: reason.name || 'PAYPAL_REJECTED', message: reason.text || FIXED.rejected, issue: reason.issue })
  return make({ status, appStatus: 502, code: 'PAYPAL_SERVER', message: FIXED.server })
}

export const outcomeUnknown = () => make({ status: 502, appStatus: 502, code: OUTCOME_UNKNOWN, message: FIXED.unknown, unknown: true })
export const duplicateInFlight = (key) => make({ status: 409, appStatus: 409, code: 'DUPLICATE_IN_FLIGHT', message: `An identical PayPal request is already in progress (${key}).` })

function describe(err) {
  const debugId = err.headers?.get?.('paypal-debug-id') || reasonOf(err.payload).debugId || '-'
  return `PayPal SDK ${err.kind} ${err.method} ${err.uri} status=${err.status ?? '-'} debug_id=${debugId}`
}

// disposition: 'refused' (PayPal answered no), 'unknown' (write may have happened), 'never-sent', 'rethrow'.
export function classify(err, { write, log }) {
  if (err instanceof UnreadableAnswer) return { disposition: write ? 'unknown' : 'refused', error: write ? outcomeUnknown() : make({ status: 502, appStatus: 502, code: 'PAYPAL_UNREADABLE', message: FIXED.unreadable }) }
  if (!(err instanceof PaypalError)) return { disposition: 'rethrow', error: err }
  log(describe(err))
  switch (err.kind) {
    case 'api':
      return { disposition: 'refused', error: fromStatus(err.status, reasonOf(err.payload)) }
    case 'decode':
      if (err.status >= 200 && err.status < 300) {
        return write
          ? { disposition: 'unknown', error: outcomeUnknown() }
          : { disposition: 'refused', error: make({ status: 502, appStatus: 502, code: 'PAYPAL_UNREADABLE', message: FIXED.unreadable }) }
      }
      return { disposition: 'refused', error: fromStatus(err.status) }
    case 'connection':
    case 'timeout':
      return write
        ? { disposition: 'unknown', error: outcomeUnknown() }
        : { disposition: 'refused', error: make({ status: 502, appStatus: 502, code: 'PAYPAL_UNREACHABLE', message: FIXED.unreachable }) }
    case 'auth':
      return { disposition: 'never-sent', error: make({ status: 502, appStatus: 502, code: 'PAYPAL_CREDENTIALS', message: FIXED.credentials }) }
    case 'encode':
      return { disposition: 'never-sent', error: make({ status: 500, appStatus: 500, code: 'INTEGRATION_DEFECT', message: FIXED.defect }) }
    default:
      return { disposition: 'rethrow', error: err }
  }
}

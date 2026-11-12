import { DuplicateClaimError } from './claims.js'
import { classify, outcomeUnknown, duplicateInFlight } from './sdkErrors.js'

// One write: claim -> SDK call -> record the result. A lost answer is settled in this function's own catch by
// re-reading PayPal. Not found, or the re-read failing, stays "unknown" and is never reported as "failed".
//   send()          the SDK call (sent once, no resend)
//   check(raw)      returns the app result or throws UnreadableAnswer when the identifier is missing
//   reread(claimMs) returns the result PayPal holds, or null when it cannot find the write
export async function runWrite({ claims, key, send, check, reread, log }) {
  let claimedAtMs
  try {
    claimedAtMs = claims.claim(key).claimedAtMs
  } catch (err) {
    if (!(err instanceof DuplicateClaimError)) throw err
    return replay({ claims, key, prior: err.entry, reread, log })
  }
  try {
    const result = check(await send())
    claims.settle(key, result)
    return result
  } catch (err) {
    const { disposition, error } = classify(err, { write: true, log })
    if (disposition === 'unknown') return settleUnknown({ claims, key, claimedAtMs, reread, log })
    claims.release(key)
    throw error
  }
}

async function replay({ claims, key, prior, reread, log }) {
  if (prior.state === 'done') return prior.result
  if (prior.state === 'unknown') return settleUnknown({ claims, key, claimedAtMs: prior.claimedAtMs, reread, log })
  throw duplicateInFlight(key)
}

async function settleUnknown({ claims, key, claimedAtMs, reread, log }) {
  claims.markUnknown(key)
  try {
    const found = await reread(claimedAtMs)
    if (found) {
      const result = { ...found, reconciled: true }
      claims.settle(key, result)
      return result
    }
  } catch (err) {
    log(`PayPal re-read for ${key} failed: ${err.kind || err.name}`)
  }
  throw outcomeUnknown()
}

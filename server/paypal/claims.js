// Claims for PayPal writes. A claim is its own entry, inserted before the SDK call. The second claim for the
// same key is refused by the store itself (check and insert happen in one synchronous step).
export class DuplicateClaimError extends Error {
  constructor(key, entry) {
    super(`A PayPal write for ${key} is already ${entry.state}.`)
    this.name = 'DuplicateClaimError'
    this.key = key
    this.entry = entry
  }
}

export function createClaimStore({ now = () => Date.now() } = {}) {
  const claims = new Map()
  return {
    claim(key) {
      const existing = claims.get(key)
      if (existing) throw new DuplicateClaimError(key, existing)
      const entry = { state: 'pending', claimedAtMs: now(), result: null }
      claims.set(key, entry)
      return entry
    },
    get: (key) => claims.get(key) || null,
    settle(key, result) {
      const entry = claims.get(key)
      if (entry) claims.set(key, { ...entry, state: 'done', result })
    },
    markUnknown(key) {
      const entry = claims.get(key)
      if (entry) claims.set(key, { ...entry, state: 'unknown' })
    },
    release: (key) => claims.delete(key),
    size: () => claims.size,
  }
}

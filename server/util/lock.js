// Serializes async work per key, so two money moves on the same order never interleave.
const tails = new Map()

export function withLock(key, fn) {
  const previous = tails.get(key) || Promise.resolve()
  const run = previous.then(fn, fn)
  const tail = run.catch(() => {})
  tails.set(key, tail)
  tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return run
}

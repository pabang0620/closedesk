import { createHash, randomBytes } from 'node:crypto'

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function randomId(length = 17) {
  return Array.from(randomBytes(length), (b) => ALNUM[b % ALNUM.length]).join('')
}

export function stableHash(...parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
}

export function periodIdFor(now = new Date()) {
  const d = now.toISOString().slice(2, 10).replaceAll('-', '')
  return `p${d}${randomId(3).toLowerCase()}`
}

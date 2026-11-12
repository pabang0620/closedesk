import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { HttpError } from '../http.js'

// Signed one-time owner links. The token binds one close and one action, expires in 30 minutes
// and can be used once.
const secret = config.approvalSecret || randomBytes(32).toString('hex')
const used = new Set()
const b64 = (buf) => Buffer.from(buf).toString('base64url')

const sign = (payload) => createHmac('sha256', secret).update(payload).digest()

export function createOwnerToken({ closeId, actionId, nowMs = Date.now(), minutes = config.ownerLinkMinutes }) {
  const body = b64(JSON.stringify({ c: closeId, a: actionId, n: randomBytes(8).toString('hex'), e: nowMs + minutes * 60_000 }))
  return `${body}.${b64(sign(body))}`
}

export function readOwnerToken(token, { nowMs = Date.now(), consume = false } = {}) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) throw new HttpError(400, 'Invalid approval link.', 'TOKEN_INVALID')
  const expected = sign(body)
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(400, 'Invalid approval link.', 'TOKEN_INVALID')
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (nowMs > payload.e) throw new HttpError(410, 'This approval link has expired.', 'TOKEN_EXPIRED')
  if (used.has(payload.n)) throw new HttpError(409, 'This approval link was already used.', 'TOKEN_USED')
  if (consume) used.add(payload.n)
  return { closeId: payload.c, actionId: payload.a, nonce: payload.n, expiresAt: payload.e }
}

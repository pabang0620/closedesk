// Thin fetch wrapper. The session id lives in localStorage when it is available.
const SESSION_KEY = 'closedesk-session'
let memorySession = null

export function sessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID().replaceAll('-', '')
      localStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    memorySession ||= crypto.randomUUID().replaceAll('-', '')
    return memorySession
  }
}

export async function api(path, { method = 'GET', body, session = true } = {}, signal) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { 'x-session-id': sessionId() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  const json = await res.json().catch(() => ({ success: false, error: 'Bad response' }))
  if (!res.ok || json.success === false) {
    const err = new Error(json.error || `Request failed (${res.status})`)
    err.status = res.status
    err.code = json.code
    throw err
  }
  return json.data
}

export const usd = (cents) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

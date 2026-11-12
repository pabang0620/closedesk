// Transaction Search helpers: 31-day window splitting, paging at 500, one pass per status.
const DAY = 86_400_000
const MAX_RANGE_MS = 31 * DAY
export const STATUSES = ['S', 'P', 'V', 'D']

export function splitRange(startMs, endMs) {
  const windows = []
  for (let from = startMs; from < endMs; from += MAX_RANGE_MS) windows.push([from, Math.min(from + MAX_RANGE_MS, endMs)])
  return windows.length ? windows : [[startMs, endMs]]
}

export async function listAllTransactions(paypal, { startMs, endMs, statuses = STATUSES, pageSize = 500, trace }) {
  const details = []
  for (const [from, to] of splitRange(startMs, endMs)) {
    for (const status of statuses) {
      let page = 1
      let totalPages = 1
      do {
        const res = await paypal.searchTransactions({
          startDate: new Date(from).toISOString(),
          endDate: new Date(to).toISOString(),
          transactionStatus: status,
          fields: 'all',
          pageSize,
          page,
        })
        // An empty page comes back without transaction_details (seen in the sandbox 2026-11-12).
        const rows = res.transaction_details || []
        trace?.({ call: 'GET /v1/reporting/transactions', status, page, count: rows.length, totalItems: res.total_items ?? 0 })
        details.push(...rows)
        totalPages = res.total_pages ?? 0
        page += 1
      } while (page <= totalPages)
    }
  }
  return details
}

// Cheap scope probe: one tiny search tells whether the app may read Transaction Search at all.
export async function searchAvailable(paypal, nowMs) {
  try {
    await paypal.searchTransactions({ startDate: new Date(nowMs - DAY).toISOString(), endDate: new Date(nowMs).toISOString(), pageSize: 1, fields: 'transaction_info' })
    return { ok: true }
  } catch (err) {
    if (err.status === 403 || err.issue === 'PERMISSION_DENIED') return { ok: false, reason: 'scope-missing' }
    throw err
  }
}

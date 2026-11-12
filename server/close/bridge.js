import { formatUsd } from '../util/money.js'

// Books vs PayPal bridge. Integer cents everywhere.
// PayPal OVER books and PayPal UNDER books are added separately as absolute values, so a refund
// owed to one customer can never hide a charge missing from another.
export function computeBridge(exceptions) {
  const open = exceptions.filter((e) => e.status === 'open')
  const sum = (list, dir) => list.filter((e) => e.direction === dir).reduce((s, e) => s + e.amountCents, 0)
  const overCents = sum(open, 'over')
  const underCents = sum(open, 'under')
  const carried = exceptions.filter((e) => e.status === 'carried')
  return {
    overCents,
    underCents,
    unexplainedCents: overCents + underCents,
    carriedForwardCents: carried.reduce((s, e) => s + (e.carriedCents ?? e.amountCents), 0),
    heldForCustomersCents: open.filter((e) => e.code === 'CANCELLED_HOLD_OPEN').reduce((s, e) => s + e.heldCents, 0),
    resolvedCents: exceptions.filter((e) => e.status === 'resolved').reduce((s, e) => s + e.amountCents, 0),
    journalOnlyCents: exceptions.filter((e) => e.status === 'journal').reduce((s, e) => s + e.amountCents, 0),
    openCount: open.length,
    over: open.filter((e) => e.direction === 'over').map((e) => ({ id: e.id, amountCents: e.amountCents, title: e.title })),
    under: open.filter((e) => e.direction === 'under').map((e) => ({ id: e.id, amountCents: e.amountCents, title: e.title })),
  }
}

// What the bridge would show if this exception were handled. Used by the approval card.
export function previewAfter(exceptions, exceptionId, outcome = 'resolved') {
  const before = computeBridge(exceptions)
  const after = computeBridge(exceptions.map((e) => (e.id === exceptionId ? { ...e, status: outcome } : e)))
  const target = exceptions.find((e) => e.id === exceptionId)
  const unchanged = before.unexplainedCents === after.unexplainedCents
  let text = `Unexplained ${formatUsd(before.unexplainedCents)} -> ${formatUsd(after.unexplainedCents)}`
  if (target?.code === 'CANCELLED_HOLD_OPEN' && unchanged) text = `Bridge unchanged, releases ${formatUsd(target.heldCents)} held from the customer`
  else if (unchanged) text = `Unexplained stays ${formatUsd(before.unexplainedCents)}`
  return { beforeCents: before.unexplainedCents, afterCents: after.unexplainedCents, text }
}

// Matched = orders with no open gap. An order whose gap was carried forward (an invoice is open) is counted
// separately, so "19 matched, 1 carried forward" reads right to an accountant.
export function matchedOrders(books, exceptions) {
  const against = (status) => new Set(exceptions.filter((e) => e.status === status && e.countsAgainstOrder && e.orderNo).map((e) => e.orderNo))
  const bad = against('open')
  const carried = new Set([...against('carried')].filter((no) => !bad.has(no)))
  return { matched: books.orders.length - bad.size - carried.size, carried: carried.size, total: books.orders.length }
}

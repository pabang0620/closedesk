import { listAllTransactions } from '../paypal/reporting.js'
import { fromAmount } from '../util/money.js'

// PayPal against PayPal: the ending balance of the newest Transaction Search line should equal the
// Balances API total. It says nothing about the books, so it is a side tile and not a close result.
// Hidden (available: false) when the Balances scope is missing.
export async function dataCompleteness({ paypal, period, nowMs }) {
  let balances
  try {
    balances = await paypal.getBalances()
  } catch (err) {
    if (err.status === 403) return { available: false, reason: 'Balances API scope not active' }
    throw err
  }
  const details = await listAllTransactions(paypal, { startMs: period.startMs, endMs: nowMs + 60_000, statuses: ['S'] })
  const infos = details.map((d) => d.transaction_info).sort((a, b) => Date.parse(a.transaction_initiation_date) - Date.parse(b.transaction_initiation_date))
  const last = infos.at(-1)
  const primary = balances.balances.find((b) => b.primary) || balances.balances[0]
  const searchBalanceCents = last ? fromAmount(last.ending_balance) : 0
  const balancesCents = fromAmount(primary.total_balance)
  return {
    available: true,
    searchBalanceCents,
    balancesCents,
    differenceCents: balancesCents - searchBalanceCents,
    matches: balancesCents === searchBalanceCents,
    transactionCount: infos.length,
  }
}

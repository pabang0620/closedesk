import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.FORCE_MOCK = '1'
const { clipSentences } = await import('../server/agent/tools.js')
const { studioKeyOf, studioRunName } = await import('../server/agent/recordedRuns.js')

const userTurn = (text) => ({ input: [{ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] }], tools: [] })

test('a long hypothesis is cut after a whole sentence, never mid-word', () => {
  const text = `${'The first sentence is here. '.repeat(30)}The tail carries invoice ID p1-1051b and more words.`
  const out = clipSentences(text, 120)
  assert.ok(out.length <= 120)
  assert.ok(out.endsWith('.'))
  assert.equal(clipSentences('Short one.', 120), 'Short one.')
})

test('a typed starter label replays the same recording as the starter button', () => {
  const button = studioKeyOf(userTurn('Chart the money at stake by exception type'))
  const typed = studioKeyOf(userTurn('Chart money at stake'))
  const typedDot = studioKeyOf(userTurn('chart money at stake.'))
  assert.equal(typed.prompt, button.prompt)
  assert.equal(typedDot.prompt, button.prompt)
  assert.equal(studioRunName(typed.prompt), 'studio-chart-the-money-at-stake-by-exception-type')
  assert.equal(studioKeyOf(userTurn('Pie of money by direction')).prompt, 'add a pie chart of the exception amounts by direction')
})

test('an empty Transaction Search page (no transaction_details) counts as zero rows', async () => {
  const { listAllTransactions } = await import('../server/paypal/reporting.js')
  const paypal = { searchTransactions: async ({ transactionStatus }) => (transactionStatus === 'S' ? { transaction_details: [{ transaction_info: { transaction_id: 'A' } }], total_pages: 1, total_items: 1 } : { total_items: 0, total_pages: 0 }) }
  const rows = await listAllTransactions(paypal, { startMs: Date.now() - 86_400_000, endMs: Date.now() })
  assert.equal(rows.length, 1)
})

// Read-only: has Transaction Search caught up with a prepared sandbox period? NOT run by tests.
// Usage: node scripts/probe-index.js <periodId>   (reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from .env)
// Prints the newest searchable line, how many of the period's payments and refunds are indexed,
// and for each indexed refund line the payment it points at (paypal_reference_id).
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { getPaypal } from '../server/paypal/index.js'
import { listAllTransactions } from '../server/paypal/reporting.js'
import { normalizeDetail } from '../server/close/ledger.js'
import { filterToPeriod } from '../server/close/periodTag.js'

const periodId = process.argv[2]
if (!periodId) {
  process.stderr.write('Usage: node scripts/probe-index.js <periodId>\n')
  process.exit(2)
}
const { manifest } = JSON.parse(readFileSync(new URL(`../data/periods/${periodId}.json`, import.meta.url), 'utf8'))
const paypal = getPaypal()
const out = (line) => process.stdout.write(`${line}\n`)
const now = Date.now()
const startMs = manifest.seededAtMs - 3_600_000

const details = await listAllTransactions(paypal, { startMs, endMs: now })
const all = details.map(normalizeDetail)
const newest = details.map((d) => d.transaction_info?.transaction_updated_date || d.transaction_info?.transaction_initiation_date).filter(Boolean).sort().at(-1)
const mine = filterToPeriod(all, periodId)
const payments = mine.filter((l) => l.kind === 'payment')
const refunds = mine.filter((l) => l.kind === 'refund')
out(`checked at ${new Date(now).toISOString()}, period seeded ${new Date(manifest.seededAtMs).toISOString()}`)
out(`lines since seed: ${details.length}, newest line: ${newest || 'none'}`)
out(`period payments indexed: ${payments.length} (needs ${Object.keys(manifest.captureIds).length})`)
out(`duplicate ${manifest.duplicateCaptureId} indexed: ${payments.some((l) => l.id === manifest.duplicateCaptureId)}`)
for (const r of refunds) out(`refund line ${r.id} ${r.eventCode} ${r.amountCents} cents, paypal_reference_id ${r.referenceId || '-'}`)

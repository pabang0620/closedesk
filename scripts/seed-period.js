// Prepares one sandbox period without card processing. Run by a person, never by the server or the tests.
//   node scripts/seed-period.js create            creates the orders (PayPal-account source), sends the invoice, writes
//                                                 data/periods/<id>.json with state "awaiting_approval"
//   python3 scripts/approve-buyer.py <id>         the sandbox buyer approves every order (headless browser)
//   node scripts/seed-period.js finish <id>       authorizes or captures the approved orders (the 1051 duplicate comes
//                                                 two minutes after the first one), sets state "ready"
// The server reads finished files at start. See VERIFY.md items 15 and 16.
import { config, modes } from '../server/config.js'
import { createLivePaypal } from '../server/paypal/live.js'
import { seedPeriod, finishSeed } from '../server/close/seed.js'
import { savePeriodRecord, readPeriodRecord } from '../server/close/periodStore.js'
import { periodIdFor } from '../server/util/ids.js'

const [, , command, periodArg] = process.argv

if (modes.paypal !== 'sandbox') {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) first. This script never runs against the mock.')
  process.exit(1)
}

const paypal = createLivePaypal()

if (command === 'create') {
  const periodId = periodIdFor(new Date())
  const { books, manifest } = await seedPeriod({ paypal, periodId, useCard: false, returnUrl: `${config.appUrl}/seed-return` })
  const file = savePeriodRecord(config.periodsDir, { books, manifest })
  console.info(`Created ${manifest.pending.length} orders for ${periodId}, waiting for the buyer.\nFile: ${file}\nNext: python3 scripts/approve-buyer.py ${periodId}`)
} else if (command === 'finish' && /^[A-Za-z0-9]{3,14}$/.test(periodArg || '')) {
  const { books, manifest } = readPeriodRecord(config.periodsDir, periodArg)
  if (manifest.state === 'ready') {
    console.info('Already finished.')
  } else {
    const done = await finishSeed({ paypal, manifest })
    savePeriodRecord(config.periodsDir, { books, manifest: done })
    console.info(`Period ${periodArg} is ready: ${Object.keys(done.captureIds).length} captures, ${done.authorizationIds.length} holds. Restart the server to load it.`)
  }
} else {
  console.error('Usage: node scripts/seed-period.js create | finish <periodId>')
  process.exit(1)
}

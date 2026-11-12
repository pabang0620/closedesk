import { createMockPaypal } from '../server/paypal/mock.js'
import { seedPeriod, EXPECTED_PAYMENTS } from '../server/close/seed.js'
import { createClose, resetStoreForTests } from '../server/close/closeStore.js'
import { runDailyCheck } from '../server/close/check.js'

export const DAY = 86_400_000
export const START = Date.UTC(2026, 10, 12, 9, 0, 0)

// A mock PayPal world on a clock the test controls.
export function makeWorld({ options = {}, startMs = START } = {}) {
  const clock = { t: startMs }
  const paypal = createMockPaypal({ now: () => clock.t, options })
  return { paypal, clock, now: () => clock.t, advance: (ms) => { clock.t += ms } }
}

export async function makeClose(world, { periodId = 'p261112aaa', forceMode, sessionId = 'session-1', buyerPaypalAccountFor = [], afterSeed } = {}) {
  resetStoreForTests()
  const { books, manifest } = await seedPeriod({ paypal: world.paypal, periodId, buyerPaypalAccountFor })
  if (afterSeed) afterSeed(manifest)
  const period = { id: periodId, startMs: Date.UTC(2026, 10, 1), rangeLabel: 'Nov 1-12', expectedPayments: EXPECTED_PAYMENTS, manifest }
  const close = createClose({ sessionId, period, books: structuredClone(books) })
  world.advance(60_000)
  await runDailyCheck(close, { paypal: world.paypal, now: world.now, forceMode })
  return { close, manifest, deps: { paypal: world.paypal, now: world.now } }
}

export const byCode = (close, code) => close.exceptions.find((e) => e.code === code)

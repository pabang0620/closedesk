import { periodIdFor } from '../util/ids.js'
import { seedPeriod, EXPECTED_PAYMENTS } from './seed.js'
import { listAllTransactions, searchAvailable } from '../paypal/reporting.js'
import { normalizeDetail } from './ledger.js'
import { filterToPeriod } from './periodTag.js'
import { DAY_MS } from './constants.js'
import { loadFinishedRecords } from './periodStore.js'

export const NO_PREPARED_PERIOD = 'No prepared sandbox period. Seed one with scripts/seed-period.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function rangeFor(nowMs) {
  const d = new Date(nowMs)
  return { startMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), label: `${MONTHS[d.getUTCMonth()]} 1-${d.getUTCDate()}` }
}

// Prepared periods. Seeded payments appear in Transaction Search up to three hours later, so
// periods are seeded ahead of time and handed to judges once they show up there.
// States: seeded -> ready -> assigned, or discarded (never assigned and older than the max age).
export function createPeriodManager({ paypal, now = () => Date.now(), targetReady = 5, maxAgeDays = 3, assignPerDay = 200, useCard = true, periodsDir = null, log = () => {} }) {
  const periods = new Map()
  let assignedToday = { day: '', count: 0 }
  let lastError = null

  // Reads finished period files that are not known yet (written by scripts/seed-period.js).
  function loadPrepared() {
    const added = []
    for (const { books, manifest } of loadFinishedRecords(periodsDir)) {
      if (periods.has(manifest.periodId)) continue
      const { startMs, label } = rangeFor(manifest.seededAtMs)
      periods.set(manifest.periodId, { id: manifest.periodId, status: 'seeded', startMs, rangeLabel: label, expectedPayments: EXPECTED_PAYMENTS, seededAtMs: manifest.seededAtMs, manifest, books, assignedTo: null })
      added.push(manifest.periodId)
    }
    return added
  }

  async function seedOne(options = {}) {
    if (!useCard) throw new Error(NO_PREPARED_PERIOD)
    const id = periodIdFor(new Date(now()))
    const { books, manifest } = await seedPeriod({ paypal, periodId: id, useCard, ...options })
    const { startMs, label } = rangeFor(now())
    const period = { id, status: 'seeded', startMs, rangeLabel: label, expectedPayments: EXPECTED_PAYMENTS, seededAtMs: manifest.seededAtMs, manifest, books, assignedTo: null }
    periods.set(id, period)
    return period
  }

  async function isIndexed(period) {
    const probe = await searchAvailable(paypal, now())
    if (!probe.ok) return false
    const details = await listAllTransactions(paypal, { startMs: period.startMs, endMs: now() + 60_000, statuses: ['S'] })
    const mine = filterToPeriod(details.map(normalizeDetail), period.id).filter((l) => l.kind === 'payment')
    return mine.length >= period.expectedPayments
  }

  async function refresh() {
    for (const p of periods.values()) {
      if (p.status === 'seeded' && (await isIndexed(p))) p.status = 'ready'
    }
  }

  async function discardStale() {
    const discarded = []
    for (const p of periods.values()) {
      if (!['seeded', 'ready'].includes(p.status) || p.assignedTo) continue
      if (now() - p.seededAtMs <= maxAgeDays * DAY_MS) continue
      for (const authId of p.manifest.authorizationIds) {
        try { await paypal.voidAuthorization(authId) } catch { /* already voided or expired */ }
      }
      p.status = 'discarded'
      discarded.push(p.id)
    }
    return discarded
  }

  // Keeps at least targetReady fresh periods. Runs every few hours from the server.
  async function replenish() {
    const discarded = await discardStale()
    await refresh()
    const fresh = [...periods.values()].filter((p) => ['seeded', 'ready'].includes(p.status) && !p.assignedTo).length
    const created = []
    if (useCard) for (let i = fresh; i < targetReady; i += 1) created.push((await seedOne()).id)
    await refresh()
    return { discarded, created }
  }

  // Never throws: a seed or lookup failure leaves the server up and shows on /api/health and the desk banner.
  async function safeReplenish() {
    try {
      loadPrepared()
      const result = await replenish()
      const prepared = [...periods.values()].some((p) => ['seeded', 'ready'].includes(p.status) && !p.assignedTo)
      lastError = prepared || useCard ? null : NO_PREPARED_PERIOD
      return result
    } catch (err) {
      lastError = err.message
      log(`period replenish failed: ${err.message}`)
      return null
    }
  }

  function takeOne(statuses, sessionId) {
    const pick = [...periods.values()].filter((p) => statuses.includes(p.status) && !p.assignedTo).sort((a, b) => b.seededAtMs - a.seededAtMs)[0]
    if (!pick) return null
    pick.status = 'assigned'
    pick.assignedTo = sessionId
    pick.assignedAtMs = now()
    return pick
  }

  // One period per session, with a daily cap. A period that is seeded but not yet indexed is
  // still usable: the close then runs in mode B and says so.
  function assign(sessionId) {
    const existing = [...periods.values()].find((p) => p.assignedTo === sessionId)
    if (existing) return { period: existing }
    const day = new Date(now()).toISOString().slice(0, 10)
    if (assignedToday.day !== day) assignedToday = { day, count: 0 }
    if (assignedToday.count >= assignPerDay) return { period: closedView(), limited: true }
    const pick = takeOne(['ready'], sessionId) || takeOne(['seeded'], sessionId)
    if (!pick) { topUpSoon(); return { period: closedView(), exhausted: true } }
    assignedToday.count += 1
    topUpSoon()
    return { period: pick }
  }

  // Refill in the background as soon as fresh periods run low, instead of waiting for the timer.
  let toppingUp = null
  function topUpSoon() {
    const fresh = [...periods.values()].filter((p) => ['seeded', 'ready'].includes(p.status) && !p.assignedTo).length
    if (fresh >= 2 || toppingUp || !useCard) return toppingUp
    toppingUp = safeReplenish().finally(() => { toppingUp = null })
    return toppingUp
  }

  // When nothing is left, show the oldest used period read-only. New actions are blocked.
  function closedView() {
    const used = [...periods.values()].filter((p) => p.status === 'assigned').sort((a, b) => a.seededAtMs - b.seededAtMs)[0]
    return used ? { ...used, readOnly: true } : null
  }

  return { periods, seedOne, refresh, replenish, safeReplenish, loadPrepared, lastError: () => lastError, discardStale, assign, topUpSoon, closedView, stats: () => Object.groupBy([...periods.values()], (p) => p.status) }
}

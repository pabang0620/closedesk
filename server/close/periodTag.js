// Period tags. Every seeded order carries custom_id "cd:{period_id}:{cart_ref}" so several judges
// can share one sandbox merchant without seeing each other's payments.
const PERIOD_RE = /^[A-Za-z0-9]{3,14}$/
const CART_RE = /^[A-Za-z0-9_-]{1,40}$/
const CUSTOM_FIELD_MAX = 127 // Transaction Search custom_field limit (Orders custom_id allows 255)

export function tagCustomId(periodId, cartRef) {
  if (!PERIOD_RE.test(periodId)) throw new Error(`Invalid period id: ${periodId}`)
  if (!CART_RE.test(cartRef)) throw new Error(`Invalid cart ref: ${cartRef}`)
  const tag = `cd:${periodId}:${cartRef}`
  if (tag.length > CUSTOM_FIELD_MAX) throw new Error('custom_id tag too long')
  return tag
}

export function parseTag(customField) {
  const m = /^cd:([A-Za-z0-9]{3,14}):([A-Za-z0-9_-]{1,40})$/.exec(customField || '')
  return m ? { periodId: m[1], cartRef: m[2] } : null
}

// Invoice numbers are limited to 25 characters, so the period prefix must stay short.
export function invoiceNumberFor(periodId, serial) {
  const number = `${periodId}-INV-${String(serial).padStart(4, '0')}`
  if (number.length > 25) throw new Error('Invoice number too long')
  return number
}

// Keeps only the lines that belong to one period.
// Payments carry the tag. Refunds and other follow-up lines carry none, so they belong to the
// period when paypal_reference_id points at a payment of that period.
export function filterToPeriod(lines, periodId) {
  const own = new Set(lines.filter((l) => l.periodId === periodId).map((l) => l.id))
  let grew = true
  while (grew) {
    grew = false
    for (const l of lines) {
      if (!own.has(l.id) && !l.periodId && l.referenceId && own.has(l.referenceId)) {
        own.add(l.id)
        grew = true
      }
    }
  }
  return lines.filter((l) => own.has(l.id))
}

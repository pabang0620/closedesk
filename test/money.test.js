import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCents, toValue, percentOf, formatUsd } from '../server/util/money.js'
import { planCapture } from '../server/close/capturePlan.js'
import { DAY_MS } from '../server/close/constants.js'

test('money converts strings and cents exactly', () => {
  assert.equal(toCents('46.67'), 4667)
  assert.equal(toCents('-89.00'), -8900)
  assert.equal(toCents('5'), 500)
  assert.equal(toValue(467), '4.67')
  assert.equal(toValue(-5), '-0.05')
  assert.throws(() => toCents('1.234'))
  assert.throws(() => toValue(1.5))
  assert.equal(formatUsd(1234567), '$12,345.67')
})

test('coupon rounding boundary: 10% of 46.67 is 4.67, of 5.05 is 0.51 (half up)', () => {
  assert.equal(percentOf(4667, 10), 467)
  assert.equal(percentOf(505, 10), 51)
  assert.equal(percentOf(504, 10), 50)
  assert.equal(4667 - percentOf(4667, 10), 4200)
})

test('capture plan covers every branch', () => {
  const base = { authCreatedMs: 0, nowMs: 0, funding: 'card', status: 'CREATED' }
  assert.equal(planCapture({ ...base, nowMs: 2 * DAY_MS }).path, 'CAPTURE')
  assert.equal(planCapture({ ...base, nowMs: 3 * DAY_MS }).path, 'CAPTURE')
  assert.equal(planCapture({ ...base, nowMs: 4 * DAY_MS, funding: 'paypal' }).path, 'REAUTH_THEN_CAPTURE')
  assert.equal(planCapture({ ...base, nowMs: 4 * DAY_MS, funding: 'card' }).path, 'CAPTURE_NOT_GUARANTEED')
  assert.equal(planCapture({ ...base, nowMs: 29 * DAY_MS, funding: 'paypal' }).path, 'REAUTH_THEN_CAPTURE')
  assert.equal(planCapture({ ...base, nowMs: 29 * DAY_MS + 1 }).path, 'INVOICE')
  assert.equal(planCapture({ ...base, status: 'EXPIRED' }).path, 'INVOICE')
  assert.match(planCapture({ ...base, nowMs: 5 * DAY_MS, funding: 'paypal' }).reason, /reauthorizing first/)
  assert.match(planCapture({ ...base, nowMs: 5 * DAY_MS }).reason, /capture not guaranteed/)
})

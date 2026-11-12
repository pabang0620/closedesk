import { tagCustomId, invoiceNumberFor } from './periodTag.js'
import { percentOf } from '../util/money.js'

// Brightloom Candles is a made-up shop used for the demo. All names and e-mails are fictional.
const ORDER_TABLE = [
  // [no, customer, item, subtotal cents, coupon pct, status, note]
  [1041, 'Maya Ortiz', 'Lavender soy candle', 2400],
  [1042, 'Hannah Lee', 'Candle gift set', 8900],
  [1043, 'Noah Brooks', 'Cedar wick trimmer set', 1850],
  [1044, 'Priya Nair', 'Amber jar trio', 5000, 10],
  [1045, 'Liam Carter', 'Vanilla pillar candle', 3200],
  [1046, 'Zoe Alvarez', 'Travel tin pair', 2775],
  [1047, 'Ethan Wu', 'Sandalwood jar set', 4667, 10],
  [1048, 'Grace Kim', 'Winter spice bundle', 6400],
  [1049, 'Omar Haddad', 'Mini votive box', 1999],
  [1050, 'Chloe Martin', 'Large amber jar', 7525],
  [1051, 'Ben Foster', 'Linen mist and candle', 3450],
  [1052, 'Ivy Chen', 'Wick refill pack', 1200],
  [1053, 'Lucas Silva', 'Gift candle box', 5840],
  [1054, 'Sofia Rossi', 'Eucalyptus candle', 4100],
  [1055, 'Aiden Murphy', 'Home scent collection', 12000, 0, 'shipped', 'AUTHORIZE'],
  [1056, 'Mia Johansson', 'Pine travel candle', 2999],
  [1057, 'Jack Dubois', 'Citrus candle trio', 3600],
  [1058, 'Ella Novak', 'Holiday candle bundle', 6500, 0, 'cancelled', 'AUTHORIZE'],
  [1059, 'Leo Santos', 'Rose petal candle', 2250],
  [1060, 'Nora Evans', 'Phone order: two jar candles', 5800, 0, 'shipped', 'PHONE'],
]

// The shop's replies are dated the day before the check, so "yesterday" is true when the judge opens the period.
const SUPPORT_LEAD_MS = 30 * 3_600_000

const SUPPORT = [
  [1041, 'customer', 'Thanks, the lavender candle smells great!'],
  [1042, 'customer', 'Hi, my candle set arrived with a cracked jar. Can I get my money back?'],
  [1042, 'agent', "I'm so sorry about that. I've refunded your order, you'll see it in a few days."],
  [1044, 'customer', 'Does my code work on this order?'],
  [1044, 'agent', 'Yes, your 10% code is applied to the order.'],
  [1045, 'customer', 'I would like to return one candle.'],
  [1045, 'agent', 'Refund request received, we will review it within a week.'],
  [1046, 'customer', 'Where is my package? Tracking has not moved.'],
  [1046, 'agent', "I'll look into it and get back to you."],
  [1047, 'customer', 'I used code SAVE10 but I was charged the full price.'],
  [1047, 'agent', 'You are right, sorry. Your 10% code is applied to the order now.'],
  [1048, 'customer', 'Package is late, can I cancel?'],
  [1048, 'agent', "We can refund you if it doesn't arrive by Friday."],
  [1050, 'customer', 'What is your return window?'],
  [1050, 'agent', 'Our refund policy allows returns within 30 days of delivery.'],
  [1051, 'customer', 'I think I was charged twice for this order.'],
  [1051, 'agent', 'Thanks for flagging this, we are checking the payment records.'],
  [1053, 'agent', "I've asked the warehouse to check the stock for your gift box."],
  [1055, 'agent', 'Your order has shipped! Tracking is on its way by email.'],
  [1057, 'agent', "I'll send you a refund if the item turns out to be damaged."],
  [1058, 'customer', 'Please cancel my order, I ordered by mistake.'],
  [1058, 'agent', 'Done, your order is cancelled. No charge will be taken.'],
  [1060, 'agent', 'Your phone order shipped today.'],
]

// Builds the seller books and support threads for one period. Pure: no PayPal calls.
export function buildBooks({ periodId, seededAtMs, paypalOrderIds = {} }) {
  const orders = ORDER_TABLE.map(([no, customer, item, subtotalCents, couponPct = 0, status = 'shipped', kind = 'CAPTURE']) => {
    const discountCents = couponPct ? percentOf(subtotalCents, couponPct) : 0
    return {
      orderNo: String(no),
      cartRef: `C-${no}`,
      customer,
      email: `${customer.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
      item,
      subtotalCents,
      couponCode: couponPct ? `SAVE${couponPct}` : null,
      couponPct,
      discountCents,
      totalCents: subtotalCents - discountCents,
      status,
      channel: kind === 'PHONE' ? 'phone' : 'web',
      intent: kind === 'AUTHORIZE' ? 'AUTHORIZE' : 'CAPTURE',
      paypalOrderId: paypalOrderIds[String(no)] || null,
    }
  })
  const threads = []
  SUPPORT.forEach(([no, from, text], i) => {
    let thread = threads.find((t) => t.orderNo === String(no))
    if (!thread) {
      thread = { orderNo: String(no), messages: [] }
      threads.push(thread)
    }
    thread.messages.push({ id: `m${i + 1}`, at: new Date(seededAtMs - SUPPORT_LEAD_MS + i * 60_000).toISOString(), from, text })
  })
  return {
    orders,
    threads,
    invoices: [{ number: invoiceNumberFor(periodId, 7), customer: 'Tidewater Cafe', amountCents: 15000, receivedBy: 'BANK_TRANSFER', receivedOn: new Date(seededAtMs).toISOString().slice(0, 10), paypalInvoiceId: null }],
    nextInvoiceSerial: 12,
    coupons: [{ code: 'SAVE10', pct: 10, rule: 'Percent off the item subtotal, rounded to the nearest cent' }],
  }
}

const DUPLICATE_GAP_MS = 120_000
const PENDING_STATES = ['PAYER_ACTION_REQUIRED', 'CREATED', 'APPROVED']
const approveLinkOf = (order) => (order.links || []).find((l) => ['payer-action', 'approve'].includes(l.rel))?.href || null

// Creates the period's payments in PayPal and returns the books.
//   useCard (default): card sources, no buyer screen. Needs card processing on the sandbox business account.
//   useCard false: PayPal-account sources. Each order waits for the sandbox buyer (scripts/approve-buyer.py) and
//   lands in manifest.pending. finishSeed() then authorizes or captures them.
// The duplicate payment of cart C-1051 is created two minutes after the first one.
export async function seedPeriod({ paypal, periodId, useCard = true, buyerPaypalAccountFor = [], returnUrl }) {
  const seededAtMs = paypal.now ? paypal.now() : Date.now()
  const skeleton = buildBooks({ periodId, seededAtMs })
  const paypalOrderIds = {}
  const manifest = { periodId, seededAtMs, state: 'ready', authorizationIds: [], captureIds: {}, duplicateCaptureId: null, invoiceId: null, pending: [] }

  const place = async (order, { orderKey, invoiceId, amountCents, createdAtMs }) => {
    const accountPays = !useCard || buyerPaypalAccountFor.includes(order.orderNo)
    const source = accountPays ? { kind: 'paypal', email: order.email } : { kind: 'card', last4: '1111' }
    const res = await paypal.createOrder({
      intent: order.intent, amountCents, customId: tagCustomId(periodId, order.cartRef), invoiceId, source, buyerEmail: order.email, returnUrl, createdAtMs,
    })
    if (PENDING_STATES.includes(res.status)) {
      manifest.state = 'awaiting_approval'
      manifest.pending.push({ key: orderKey, orderNo: order.orderNo, orderId: res.id, intent: order.intent, approveUrl: approveLinkOf(res) })
      return res
    }
    record(orderKey, res)
    return res
  }
  const record = (key, res) => {
    const unit = res.purchase_units[0]
    const auth = unit.payments?.authorizations?.[0]
    const cap = unit.payments?.captures?.[0]
    if (auth) manifest.authorizationIds.push(auth.id)
    if (cap) manifest.captureIds[key] = cap.id
  }

  for (const order of skeleton.orders) {
    if (order.channel === 'phone') continue
    // Order 1047 is charged the full subtotal: the shop forgot to apply the coupon at checkout.
    const chargedCents = order.orderNo === '1047' ? order.subtotalCents : order.totalCents
    const first = await place(order, { orderKey: order.orderNo, invoiceId: `${periodId}-${order.orderNo}`, amountCents: chargedCents, createdAtMs: order.orderNo === '1051' ? seededAtMs - DUPLICATE_GAP_MS : undefined })
    paypalOrderIds[order.orderNo] = first.id
    if (order.orderNo === '1051') {
      // Same cart, a second PayPal order two minutes later. The books only know the first.
      const second = await place(order, { orderKey: `${order.orderNo}b`, invoiceId: `${periodId}-${order.orderNo}b`, amountCents: order.totalCents })
      if (!PENDING_STATES.includes(second.status)) manifest.duplicateCaptureId = manifest.captureIds[`${order.orderNo}b`]
    }
  }

  const invoiceNumber = skeleton.invoices[0].number
  const created = await paypal.createInvoice({ invoiceNumber, amountCents: skeleton.invoices[0].amountCents, description: 'Corporate candle order', recipientEmail: 'accounts@tidewater.example' })
  const invoiceId = created.href.split('/').pop()
  await paypal.sendInvoice(invoiceId)
  manifest.invoiceId = invoiceId

  const books = buildBooks({ periodId, seededAtMs, paypalOrderIds })
  books.invoices[0].paypalInvoiceId = invoiceId
  return { books, manifest }
}

// Second half of a PayPal-account seed: every order the buyer approved is authorized or captured.
// The duplicate (key ending in "b") waits `gapMs` after the first 1051 so the two payments really are minutes apart.
export async function finishSeed({ paypal, manifest, gapMs = DUPLICATE_GAP_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const next = { ...manifest, authorizationIds: [...manifest.authorizationIds], captureIds: { ...manifest.captureIds }, pending: [] }
  const ordered = [...manifest.pending].sort((a, b) => Number(a.key.endsWith('b')) - Number(b.key.endsWith('b')))
  let slept = false
  for (const item of ordered) {
    if (item.key.endsWith('b') && !slept) { await sleep(gapMs); slept = true }
    const res = await paypal.completeOrder(item.orderId, item.intent)
    const unit = res.purchase_units[0]
    const auth = unit.payments?.authorizations?.[0]
    const cap = unit.payments?.captures?.[0]
    if (auth) next.authorizationIds.push(auth.id)
    if (cap) next.captureIds[item.key] = cap.id
  }
  next.duplicateCaptureId = next.captureIds['1051b'] ?? next.duplicateCaptureId
  next.state = 'ready'
  return next
}

export const EXPECTED_PAYMENTS = 18

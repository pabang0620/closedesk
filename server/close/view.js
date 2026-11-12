import { computeBridge, matchedOrders } from './bridge.js'
import { buildPackage } from './package.js'
import { eventLabel } from './constants.js'

const dollars = (cents) => cents / 100

export const merchantLabel = (mode) => `Brightloom Candles (${mode.paypal === 'mock' ? 'mock PayPal' : 'PayPal sandbox'})`

const publicException = (e) => ({
  id: e.id, code: e.code, title: e.title, orderNo: e.orderNo, direction: e.direction, amountCents: e.amountCents, heldCents: e.heldCents,
  status: e.status, proposedAction: e.proposedAction, approver: e.approver, evidence: e.evidence, narrative: e.narrative, hypothesis: e.hypothesis && e.hypothesis !== e.narrative ? e.hypothesis : null,
  flags: e.flags, disputed: !!e.disputed, resolution: e.resolution || null, captureId: e.captureId, authId: e.authId, invoiceNumber: e.invoiceNumber,
})

const publicCard = (a) => ({
  id: a.id, exceptionId: a.exceptionId, action: a.action, approver: a.approver, movesMoney: a.movesMoney, amountCents: a.amountCents,
  amountSource: a.amountSource, preview: a.preview, status: a.status, result: a.result, error: a.error, capturePlan: a.capturePlan,
})

// What the browser gets. No tokens, no secrets.
export function closeView(close, { mode, recordedLabel = null }) {
  const bridge = computeBridge(close.exceptions)
  return {
    closeId: close.id,
    period: { id: close.periodId, rangeLabel: close.period.rangeLabel, readOnly: !!close.period.readOnly },
    merchant: merchantLabel(mode),
    checkedAt: close.checkedAtMs ? new Date(close.checkedAtMs).toISOString() : null,
    modes: mode,
    // Set when no model is configured and a recorded real model run is replayed instead of the stand-in.
    recordedLabel,
    ledger: { mode: close.ledger.mode, badge: close.ledger.badge, skippedChecks: close.ledger.skippedChecks, lineCount: close.ledger.lines.length },
    bridge,
    matched: matchedOrders(close.books, close.exceptions),
    exceptions: close.exceptions.map(publicException),
    actions: close.actions.map(publicCard),
    trace: close.trace,
    signed: close.signed ? new Date(close.signed.atMs).toISOString() : null,
    canSign: bridge.unexplainedCents === 0 && bridge.openCount === 0 && !close.signed,
  }
}

// Tables handed to AG Studio's data engine. Money is in dollars here because the widgets chart it.
export function studioTables(close) {
  const bridge = computeBridge(close.exceptions)
  const lines = close.ledger.lines
  const exceptionByOrder = new Map(close.exceptions.filter((e) => e.orderNo).map((e) => [e.orderNo, e]))
  const nowMs = close.checkedAtMs || Date.now()
  return {
    exceptions: close.exceptions.map((e) => ({
      id: e.id, order: e.orderNo || '', title: e.title, direction: e.direction, amount: dollars(e.amountCents), status: e.status,
      approver: e.approver, action: e.proposedAction, narrative: e.hypothesis || e.narrative, quote: e.evidence.find((x) => x.kind === 'support_quote')?.text || '',
    })),
    ledger: lines.map((l) => ({
      id: l.id, eventCode: l.eventCode, event: eventLabel(l.eventCode), date: l.date, amount: dollars(l.amountCents), fee: dollars(l.feeCents),
      cartRef: l.cartRef || '', kind: l.kind, source: l.source,
    })),
    promises: close.promises.map((p) => ({
      id: p.id, order: p.orderNo, type: p.type, claimsDone: p.claimsDone, madeAt: p.at, ageDays: Math.round(((nowMs - Date.parse(p.at)) / 86_400_000) * 10) / 10, quote: p.quote,
    })),
    orders: close.books.orders.map((o) => ({
      order: o.orderNo, customer: o.customer, item: o.item, total: dollars(o.totalCents), status: o.status, channel: o.channel,
      exception: exceptionByOrder.get(o.orderNo)?.id || '',
    })),
    // Brightloom's row is live. The other clients are not part of this demo, so they carry no amount.
    clients: [
      { client: 'Brightloom Candles', stage: close.signed ? 'Signed' : 'In progress', unexplained: dollars(bridge.unexplainedCents) },
      ...['Harbor Print Co', 'Tidewater Cafe', 'Fernhill Seeds', 'Quarry Lane Goods'].map((client) => ({ client, stage: 'Not started', unexplained: null })),
    ],
  }
}

export const packageView = (close) => buildPackage(close)

import { useEffect, useMemo, useState } from 'react'
import { useClose, closeActions } from '../lib/closeStore.js'
import { usd } from '../lib/api.js'
import { ACTION_LABEL, evidenceLabel, idLabel } from '../lib/labels.js'

const STATUS_LABEL = { open: 'Open', resolved: 'Resolved', carried: 'Carried forward', journal: 'Journal only' }
const MARK = { PROMISED_REFUND_MISSING: '!', DUPLICATE_PAYMENT: '!', UNKNOWN_PAYMENT: '!', COUPON_OVERCHARGE: '~', AMOUNT_MISMATCH: '~', AUTH_NOT_CAPTURED: '~', CANCELLED_HOLD_OPEN: '.', SHIPPED_NOT_BILLED: '.', INVOICE_PAID_OFFLINE: '.' }

function Evidence({ items }) {
  return (
    <ul className="cd-evidence">
      {items.map((ev, i) => (
        <li key={i}>
          {ev.kind === 'support_quote' ? <><span className="cd-tag">Support {ev.at ? new Date(ev.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span> <mark>{ev.text}</mark></> : null}
          {ev.kind === 'capture' || ev.kind === 'authorization' || ev.kind === 'search_line' ? <><span className="cd-tag">{evidenceLabel(ev.kind)}</span> {ev.text || ev.note || ev.kind} <code>{ev.id}</code>{ev.amountCents != null ? ` ${usd(ev.amountCents)}` : ''}</> : null}
          {!['support_quote', 'capture', 'authorization', 'search_line'].includes(ev.kind) ? <><span className="cd-tag">{evidenceLabel(ev.kind)}</span> {ev.text}{ev.id ? <> <code>{ev.id}</code></> : null}</> : null}
        </li>
      ))}
    </ul>
  )
}

function Explanation({ data }) {
  if (!data) return null
  return (
    <div className="cd-explain" data-testid="explanation">
      <p>{data.reply}</p>
      <ul className="cd-evidence">
        {data.events.map((ev, i) => (
          <li key={i}><code>{ev.tool}</code> <span className="cd-chip">{ev.source || 'agent-toolkit'}</span> <span className="cd-muted">{ev.output || (ev.ok ? 'ok' : 'failed')}</span></li>
        ))}
      </ul>
    </div>
  )
}

function ApprovalCard({ card, exception, ownerUrl }) {
  const [copied, setCopied] = useState(false)
  const owner = card.approver === 'owner'
  return (
    <div className="cd-approval" data-testid={`approval-${exception.id}`}>
      <div className="cd-approval-head">
        <strong>{ACTION_LABEL[card.action]}</strong> <span className="cd-money">{usd(card.amountCents)}</span>
        <span className="cd-chip">{owner ? 'needs owner' : 'bookkeeper'}</span>
      </div>
      <div className="cd-muted">Amount source: {card.amountSource}</div>
      <div className="cd-after">After: {card.preview.text}</div>
      {card.capturePlan ? <div className="cd-note">{card.capturePlan.reason}</div> : null}
      {card.status === 'failed' && card.result?.note ? <div className="cd-error">{card.result.note} The sale moved to an invoice.</div> : null}
      {card.status === 'done' ? <div className="cd-ok">Done. {Object.entries(card.result.ids || {}).map(([k, v]) => <span key={k}> {idLabel(k)}: <code>{v}</code></span>)}</div> : null}
      {['proposed', 'awaiting_owner'].includes(card.status) ? (
        <div className="cd-actions">
          {owner ? (
            <button className="cd-btn cd-btn-primary" onClick={() => closeActions.ownerLink(card.id)}>{card.status === 'awaiting_owner' ? 'Send a new owner link' : 'Send owner link'}</button>
          ) : (
            <button className="cd-btn cd-btn-primary" onClick={() => closeActions.bookkeeperApprove(card.id)}>Approve as bookkeeper</button>
          )}
          {ownerUrl?.actionId === card.id ? (
            <span className="cd-link">
              <a href={ownerUrl.url} target="_blank" rel="noreferrer">Open owner page</a>
              <button className="cd-btn" onClick={async () => { try { await navigator.clipboard.writeText(ownerUrl.url); setCopied(true) } catch { setCopied(false) } }}>{copied ? 'Copied' : 'Copy link'}</button>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function ExceptionQueue({ widgetApi, dataMapping }) {
  const { view, ownerUrl, selectedException: selected, explanations, busy } = useClose()
  const [visible, setVisible] = useState(null)

  // The ids that survive Studio's page filters and other widgets' cross filters.
  useEffect(() => {
    if (!widgetApi?.getData) return undefined
    let live = true
    const refresh = () => {
      const fields = (dataMapping?.items || []).filter(Boolean)
      if (!fields.length) return
      const apply = (res) => {
        if (!live || !res?.results?.rows) return
        const idField = fields[0]
        const key = idField.key
        const rows = res.results.rows
        setVisible(key && rows[0] && key in rows[0] ? new Set(rows.map((r) => r[key])) : null)
      }
      // onDataUpdated fires again whenever a page filter or another widget's cross filter changes.
      widgetApi.getData({ fields }, { onDataUpdated: apply }).then(apply).catch(() => {})
    }
    refresh()
    return () => { live = false }
  }, [widgetApi, dataMapping, view?.exceptions])

  const items = useMemo(() => (view ? view.exceptions.filter((e) => !visible || visible.has(e.id)) : []), [view, visible])
  if (!view) return <div className="cd-empty">Loading the daily check</div>
  // Only one card is open at a time (the one you picked, else the first open one), so all seven titles fit on screen.
  const firstOpenId = items.find((x) => x.status === 'open')?.id

  return (
    <div className="cd-queue" data-testid="exception-queue">
      {view.ledger.skippedChecks.map((s) => <div key={s} className="cd-skipped">{s}</div>)}
      {items.map((e) => {
        const card = view.actions.filter((a) => a.exceptionId === e.id).at(-1)
        const active = card && ['proposed', 'awaiting_owner', 'done', 'failed'].includes(card.status) && (e.status === 'open' ? card.status !== 'declined' : true)
        return (
          <article key={e.id} className={`cd-ex cd-status-${e.status} ${selected === e.id ? 'is-selected' : ''}`} data-testid={`exception-${e.id}`}>
            <header onClick={() => closeActions.select(e.id)}>
              <span className={`cd-mark cd-mark-${MARK[e.code] === '!' ? 'high' : MARK[e.code] === '~' ? 'mid' : 'low'}`}>{MARK[e.code]}</span>
              <span className="cd-ex-title"><b>{e.id}</b> {e.title}</span>
              <span className="cd-money">{e.code === 'CANCELLED_HOLD_OPEN' ? `${usd(e.heldCents)} held` : e.amountCents ? usd(e.amountCents) : ''}</span>
              <span className={`cd-badge cd-badge-${e.status}`}>{STATUS_LABEL[e.status]}</span>
            </header>
            {selected === e.id || (!selected && e.id === firstOpenId) || active ? (
              <div className="cd-ex-body">
                <p>{e.orderNo ? <span>Order #{e.orderNo}. </span> : null}{e.narrative}</p>
                <Evidence items={e.evidence} />
                {e.resolution ? <div className="cd-ok">Closed in PayPal: {Object.entries(e.resolution).filter(([k, v]) => typeof v === 'string' && !['kind', 'note', 'reason'].includes(k)).map(([k, v]) => <span key={k}>{idLabel(k)}: <code>{v}</code> </span>)}</div> : null}
                {e.status === 'open' && !active ? (
                  <button className="cd-btn cd-btn-primary" onClick={() => closeActions.propose(e.id, e.flags.includes('AMOUNT_REVIEW') ? { acknowledgeAmountReview: window.confirm('The support reply names a different amount than PayPal captured. Use the captured amount?') } : {})} disabled={e.disputed || !!view.signed}>
                    {e.disputed ? 'Disputed: refunds blocked' : `Propose: ${ACTION_LABEL[e.proposedAction]}${e.approver === 'owner' ? ' (owner)' : ''}`}
                  </button>
                ) : null}
                <button className="cd-btn" onClick={() => closeActions.askWhy(e.id)} disabled={busy} data-testid={`ask-${e.id}`}>Ask the Close Agent why</button>
                <Explanation data={explanations[e.id]} />
                {active ? <ApprovalCard card={card} exception={e} ownerUrl={ownerUrl} /> : null}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ACTION_LABEL, evidenceLabel, idLabel } from '../lib/labels.js'

const PAYPAL_DOES = { REFUND_FULL: 'sends the refund', REFUND_PARTIAL: 'sends the partial refund', CAPTURE_AUTH: 'captures the hold', VOID_AUTH: 'releases the hold', SEND_INVOICE: 'sends the invoice', RECORD_PAYMENT: 'records the payment' }

// The owner's tab: opened from a signed one-time link. It shows who asked, what, the amount and its
// source, the evidence, and two buttons. The page has no other way into the desk.
export default function OwnerPage({ token }) {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api(`/owner/${encodeURIComponent(token)}`, { session: false }).then(setInfo).catch((err) => setError(err.message))
  }, [token])

  async function decide(decision) {
    setBusy(true)
    try {
      setResult(await api(`/owner/${encodeURIComponent(token)}/decision`, { method: 'POST', body: { decision }, session: false }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const held = info?.action === 'VOID_AUTH' && info.heldText
  const amount = held ? info.heldText : info?.amountText
  const verb = info ? (held ? 'Release the hold' : ACTION_LABEL[info.action] || info.action) : ''
  return (
    <div className="cd-owner" data-testid="owner-page">
      <header className="cd-owner-top">
        <div className="cd-brand"><img className="brand-logo brand-logo--chip" src="/logo-512.png" width="28" height="28" alt="CloseDesk" />CloseDesk <small>Owner approval</small></div>
        {info ? <div className="cd-owner-shop">{info.merchant}</div> : null}
      </header>
      <div className="cd-owner-card">
        {error ? <p className="cd-error" role="alert">{error}</p> : null}
        {info && !result ? (
          <>
            <div className="cd-owner-ask">
              <p className="cd-eyebrow">The bookkeeper asks you to approve</p>
              <h1>{held ? `Release the ${info.heldText} hold` : `${verb} ${info.amountText}`}</h1>
              <p className="cd-owner-amount">{amount}</p>
              {info.orderNo ? <p className="cd-owner-to">{held ? 'back to' : 'for'} the customer of order #{info.orderNo}</p> : null}
            </div>
            <ol className="cd-chain" aria-label="Who does what">
              <li className="is-done"><b>{info.requestedBy}</b><span>proposed it</span></li>
              <li className="is-now"><b>You, the owner</b><span>approve or decline</span></li>
              <li><b>PayPal</b><span>{PAYPAL_DOES[info.action] || 'runs the action'}</span></li>
            </ol>
            <dl className="cd-facts">
              <dt>Shop</dt><dd>{info.merchant}</dd>
              <dt>Asked by</dt><dd>{info.requestedBy}</dd>
              <dt>Why</dt><dd>{info.title}{info.orderNo ? `, order #${info.orderNo}` : ''}</dd>
              <dt>Amount comes from</dt><dd>{info.amountSource}</dd>
              <dt>After</dt><dd>{info.preview.text}</dd>
            </dl>
            <div>
              <p className="cd-owner-h">Evidence</p>
              <ul className="cd-evidence">{info.evidence.map((e, i) => <li key={i}><span className="cd-tag">{evidenceLabel(e.kind)}</span> {e.kind === 'support_quote' ? <mark>{e.text}</mark> : e.text || ''} {e.id ? <code>{e.id}</code> : null}</li>)}</ul>
            </div>
            <div className="cd-owner-paypal">
              <p className="cd-owner-h">What PayPal will do</p>
              <ol>
                <li>{verb} <b className="cd-money">{amount}</b>, amount from {info.amountSource}.</li>
                <li>Sent once with a <code>PayPal-Request-Id</code>. A second click cannot run it twice.</li>
                <li>The PayPal id appears on the desk and in the close package.</li>
              </ol>
            </div>
            <div className="cd-owner-actions">
              <button className="cd-btn cd-btn-primary" onClick={() => decide('approve')} disabled={busy}>Approve {amount}</button>
              <button className="cd-btn" onClick={() => decide('decline')} disabled={busy}>Decline</button>
            </div>
            <p className="cd-owner-valid">Link valid until {new Date(info.expiresAt).toLocaleTimeString()}. It works once.</p>
          </>
        ) : null}
        {result ? (
          <div className="cd-owner-result" data-testid="owner-result">
            <h1>{result.status === 'done' ? 'Done in PayPal' : result.status === 'declined' ? 'Declined' : 'Not completed'}</h1>
            {result.result ? <p>{Object.entries(result.result.ids || {}).map(([k, v]) => <span key={k}>{idLabel(k)}: <code>{v}</code> </span>)}</p> : null}
            {result.status === 'failed' ? <p className="cd-muted">{result.result?.note || result.error}. The bookkeeper will send an invoice instead.</p> : null}
            <p className="cd-muted">You can close this tab.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

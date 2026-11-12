import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ACTION_LABEL, evidenceLabel, idLabel } from '../lib/labels.js'

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

  return (
    <div className="cd-owner" data-testid="owner-page">
      <div className="cd-owner-card">
        <div className="cd-brand"><span className="cd-logo" aria-hidden="true" />CloseDesk <small>Owner approval</small></div>
        {error ? <p className="cd-error" role="alert">{error}</p> : null}
        {info && !result ? (
          <>
            <h1>{ACTION_LABEL[info.action] || info.action} {info.amountText}</h1>
            <dl>
              <dt>Shop</dt><dd>{info.merchant}</dd>
              <dt>Asked by</dt><dd>{info.requestedBy}</dd>
              <dt>Why</dt><dd>{info.title}{info.orderNo ? `, order #${info.orderNo}` : ''}</dd>
              <dt>Amount comes from</dt><dd>{info.amountSource}</dd>
              <dt>After</dt><dd>{info.preview.text}</dd>
            </dl>
            <ul className="cd-evidence">{info.evidence.map((e, i) => <li key={i}><span className="cd-tag">{evidenceLabel(e.kind)}</span> {e.text || ''} {e.id ? <code>{e.id}</code> : null}</li>)}</ul>
            <p className="cd-muted">Link valid until {new Date(info.expiresAt).toLocaleTimeString()}. It works once.</p>
            <div className="cd-actions">
              <button className="cd-btn cd-btn-primary" onClick={() => decide('approve')} disabled={busy}>Approve</button>
              <button className="cd-btn" onClick={() => decide('decline')} disabled={busy}>Decline</button>
            </div>
          </>
        ) : null}
        {result ? (
          <div data-testid="owner-result">
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

import { useClose } from '../lib/closeStore.js'
import { usd } from '../lib/api.js'
import { ACTION_LABEL } from '../lib/labels.js'

const RESULT_LABEL = { refund: 'Refund', capture: 'Capture', void: 'Void', invoice: 'Invoice', 'record-payment': 'Invoice payment', journal: 'Journal', 'fallback-invoice': 'Invoice instead' }

export default function OwnerApprovals() {
  const { view } = useClose()
  if (!view) return <div className="cd-empty">Loading</div>
  const waiting = view.actions.filter((a) => a.approver === 'owner' && ['proposed', 'awaiting_owner'].includes(a.status))
  const done = view.actions.filter((a) => a.status === 'done')
  return (
    <div className="cd-owner-list" data-testid="owner-approvals">
      <h4>Waiting for the owner ({waiting.length})</h4>
      {waiting.length === 0 ? <p className="cd-muted">Nothing is waiting.</p> : waiting.map((a) => (
        <div key={a.id} className="cd-row"><b>{a.exceptionId}</b> {ACTION_LABEL[a.action] || a.action} <span className="cd-money">{usd(a.amountCents)}</span><span className="cd-muted">{a.preview.text}</span></div>
      ))}
      <h4>Done in PayPal ({done.length})</h4>
      {done.map((a) => (
        <div key={a.id} className="cd-row"><b>{a.exceptionId}</b> {RESULT_LABEL[a.result?.kind] || a.result?.kind} {Object.values(a.result?.ids || {}).map((id) => <code key={id}>{id}</code>)}</div>
      ))}
    </div>
  )
}

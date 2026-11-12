import { useClose, closeActions } from '../lib/closeStore.js'
import { usd } from '../lib/api.js'

// The left rail: how far the close is (Unexplained first), then Sign close at its foot.
export default function CloseMeter() {
  const { view, busy } = useClose()
  if (!view) return <div className="cd-empty">Loading</div>
  const { matched, bridge } = view
  return (
    <div className="cd-rail" data-testid="close-meter">
      <div className="cd-rail-stat cd-rail-unexp"><span>Unexplained</span><b className={bridge.unexplainedCents === 0 ? 'cd-zero' : 'cd-money'}>{usd(bridge.unexplainedCents)}</b></div>
      <div className="cd-rail-group">
        <div className="cd-rail-stat cd-rail-held"><span>Held for customers</span><b>{usd(bridge.heldForCustomersCents)}</b></div>
        <div className="cd-rail-stat"><span>Orders matched</span><b data-testid="matched">{matched.matched}/{matched.total}{matched.carried ? <small> · {matched.carried} carried</small> : null}</b></div>
        <div className="cd-rail-stat"><span>Exceptions open</span><b data-testid="open-count">{bridge.openCount}</b></div>
      </div>
      <div className="cd-rail-sign">
        <button className="cd-btn cd-btn-primary" disabled={!view.canSign || busy} onClick={() => closeActions.sign()} data-testid="sign-close">{view.signed ? 'Close signed' : 'Sign close'}</button>
        <small>{view.signed ? 'The close package is in the tab below.' : 'Opens at $0.00 unexplained, nothing open'}</small>
      </div>
    </div>
  )
}

import { useClose, closeActions } from '../lib/closeStore.js'
import { usd } from '../lib/api.js'

export default function CloseMeter() {
  const { view, busy } = useClose()
  if (!view) return <div className="cd-empty">Loading</div>
  const { matched, bridge } = view
  return (
    <div className="cd-meter" data-testid="close-meter">
      <div><span>Orders matched</span><b data-testid="matched">{matched.matched}/{matched.total}{matched.carried ? <small> · {matched.carried} carried</small> : null}</b></div>
      <div><span>Exceptions open</span><b data-testid="open-count">{bridge.openCount}</b></div>
      <div><span>Unexplained</span><b className={bridge.unexplainedCents === 0 ? 'cd-zero' : 'cd-money'}>{usd(bridge.unexplainedCents)}</b></div>
      <div className="cd-meter-sign">
        <button className="cd-btn cd-btn-primary" disabled={!view.canSign || busy} onClick={() => closeActions.sign()} data-testid="sign-close">{view.signed ? 'Close signed' : 'Sign close'}</button>
      </div>
    </div>
  )
}

import { useClose } from '../lib/closeStore.js'
import { usd } from '../lib/api.js'

export default function BridgeWidget() {
  const { view } = useClose()
  if (!view) return <div className="cd-empty">Loading</div>
  const { bridge } = view
  const total = Math.max(bridge.overCents, bridge.underCents, 1)
  const Row = ({ item, dir }) => (
    <div className="cd-bridge-row" key={item.id}>
      <span>{item.id} {item.title}</span>
      <span className="cd-bar"><i className={`cd-bar-${dir}`} style={{ width: `${Math.max(4, (item.amountCents / total) * 100)}%` }} /></span>
      <span className="cd-money">{usd(item.amountCents)}</span>
    </div>
  )
  return (
    <div className="cd-bridge" data-testid="bridge">
      <h4>PayPal OVER books <b className="cd-money">{usd(bridge.overCents)}</b></h4>
      {bridge.over.map((i) => <Row key={i.id} item={i} dir="over" />)}
      <h4>PayPal UNDER books <b className="cd-money">{usd(bridge.underCents)}</b></h4>
      {bridge.under.map((i) => <Row key={i.id} item={i} dir="under" />)}
      <div className="cd-bridge-sum">
        <div><span>Unexplained</span><b className={bridge.unexplainedCents === 0 ? 'cd-zero' : 'cd-money'} data-testid="unexplained">{usd(bridge.unexplainedCents)}</b></div>
        <div><span>Carried forward</span><b className="cd-money">{usd(bridge.carriedForwardCents)}</b></div>
        <div><span>Held for customers</span><b className="cd-money">{usd(bridge.heldForCustomersCents)}</b></div>
        <div><span>Resolved in PayPal</span><b className="cd-money">{usd(bridge.resolvedCents)}</b></div>
      </div>
    </div>
  )
}

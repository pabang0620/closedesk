import { useEffect, useState } from 'react'
import { api, usd } from '../lib/api.js'
import { useClose, closeActions } from '../lib/closeStore.js'
import { when } from '../lib/labels.js'

export function TracePanel() {
  const { view } = useClose()
  if (!view) return null
  return (
    <ol className="cd-trace" data-testid="agent-trace">
      {view.trace.map((t, i) => (
        <li key={i}>
          <code>{t.tool}</code> <span className="cd-chip">{t.source}</span>
          <span className="cd-muted"> {JSON.stringify(t.input)}</span>
          <div>{t.output}</div>
        </li>
      ))}
    </ol>
  )
}

export function CompletenessPanel() {
  const { view, version } = useClose()
  const [data, setData] = useState(null)
  useEffect(() => {
    let live = true
    api('/close/completeness').then((d) => live && setData(d)).catch(() => live && setData({ available: false, reason: 'Could not load' }))
    return () => { live = false }
  }, [version])
  if (!view) return null
  if (!data) return <p className="cd-muted">Checking balances</p>
  if (!data.available) return <p className="cd-muted">Hidden: {data.reason}. This tile compares PayPal with PayPal and is not part of the close.</p>
  return (
    <div className="cd-complete" data-testid="completeness">
      <p>PayPal against PayPal: the newest Transaction Search balance versus the Balances API. It does not say anything about the books.</p>
      <div className="cd-meter">
        <div><span>Transaction Search balance</span><b>{usd(data.searchBalanceCents)}</b></div>
        <div><span>Balances API total</span><b>{usd(data.balancesCents)}</b></div>
        <div><span>Difference</span><b className={data.matches ? 'cd-zero' : 'cd-money'}>{usd(data.differenceCents)}</b></div>
      </div>
    </div>
  )
}

export function PackagePanel() {
  const { view, package: pkg } = useClose()
  useEffect(() => { if (view?.signed && !pkg) closeActions.loadPackage() }, [view?.signed, pkg])
  if (!view) return null
  if (!view.signed || !pkg) return <p className="cd-muted">The closing package appears after Sign close. Sign opens when Unexplained is $0.00 and nothing is left open.</p>
  return (
    <div className="cd-package" data-testid="close-package">
      <h3>Close package</h3>
      <p>Signed {when(pkg.signed)}. {pkg.source}. Orders matched {pkg.matched.matched}/{pkg.matched.total}{pkg.matched.carried ? `, carried forward ${pkg.matched.carried}` : ''}. Unexplained {usd(pkg.bridge.unexplainedCents)}. Carried forward {usd(pkg.bridge.carriedForwardCents)}.</p>
      <h4>PayPal ids executed</h4>
      <ul>{pkg.idList.map((x) => <li key={x.id}>{x.label} <code>{x.id}</code> {x.amountCents ? usd(x.amountCents) : ''}</li>)}</ul>
      <h4>Carried forward</h4>
      <ul>{pkg.carriedForward.map((c) => <li key={c.exceptionId}>{c.exceptionId} order {c.orderNo} {usd(c.amountCents)} invoice <code>{c.invoiceNumber}</code></li>)}</ul>
      <h4>Books vs PayPal</h4>
      <table><thead><tr><th>Exception</th><th>Type</th><th>Direction</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>{pkg.reconciliation.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.title}</td><td>{r.direction}</td><td>{usd(r.amountCents)}</td><td>{r.status}</td></tr>)}</tbody></table>
      <h4>Approvals</h4>
      <ul>{pkg.approvals.map((a, i) => <li key={i}>{new Date(a.atMs).toLocaleTimeString('en-US')} {a.actor}: {a.event} {a.actionId || ''}</li>)}</ul>
      <a className="cd-btn" href={`data:text/csv;charset=utf-8,${encodeURIComponent(pkg.journalCsv)}`} download={`closedesk-${pkg.periodId}-journal.csv`}>Download journal CSV</a>
    </div>
  )
}

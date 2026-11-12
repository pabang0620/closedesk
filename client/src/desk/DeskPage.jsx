import { lazy, Suspense, useEffect, useState } from 'react'
import { useClose, closeActions } from '../lib/closeStore.js'
import { LAYOUTS } from '../studio/layouts.js'
// AG Studio and AG Charts are most of the bundle. They load as their own chunk so the shell paints first.
const StudioView = lazy(() => import('../studio/StudioView.jsx'))
import { TracePanel, CompletenessPanel, PackagePanel } from './Panels.jsx'

const LLM_LABEL = { mock: ' · stand-in model', live: ' · Claude', account: ' · Claude Sonnet (local account)' }
const TABS = [['trace', 'Agent trace'], ['complete', 'Data completeness'], ['package', 'Close package']]

function readTheme() {
  try { return localStorage.getItem('closedesk-theme') } catch { return null }
}

export default function DeskPage() {
  const { view, busy, error, notice } = useClose()
  const [layout, setLayout] = useState('bookkeeper')
  const [mode, setMode] = useState('view')
  const [tab, setTab] = useState('trace')
  const [dark, setDark] = useState(() => readTheme() === 'dark' || (readTheme() === null && window.matchMedia?.('(prefers-color-scheme: dark)').matches))

  useEffect(() => { closeActions.start() }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.dataset.agThemeMode = dark ? 'dark' : 'light'
    try { localStorage.setItem('closedesk-theme', dark ? 'dark' : 'light') } catch { /* storage may be blocked */ }
  }, [dark])
  useEffect(() => { if (view?.signed) setTab('package') }, [view?.signed])
  // The owner approves in another tab: poll while a link is waiting.
  const waiting = !!view?.actions.some((a) => a.status === 'awaiting_owner')
  useEffect(() => {
    if (!waiting) return undefined
    const timer = setInterval(() => closeActions.refresh(), 3000)
    return () => clearInterval(timer)
  }, [waiting])

  return (
    <div className="cd-shell">
      <header className="cd-top">
        <div className="cd-brand"><span className="cd-logo" aria-hidden="true" />CloseDesk <small>{view ? `${view.merchant} · ${view.period.rangeLabel} · Daily check ${view.checkedAt ? new Date(view.checkedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}` : 'Loading'}</small></div>
        <nav className="cd-controls" aria-label="Layouts">
          {LAYOUTS.map((l) => <button key={l.id} className={`cd-btn ${layout === l.id ? 'is-on' : ''}`} onClick={() => setLayout(l.id)}>{l.label}</button>)}
          <button className={`cd-btn ${mode === 'edit' ? 'is-on' : ''}`} onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')} data-testid="edit-toggle">{mode === 'edit' ? 'Done editing' : 'Edit layout and Close Agent'}</button>
          <button className="cd-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? 'Light' : 'Dark'}</button>
          <button className="cd-btn" onClick={() => closeActions.recheck()} disabled={busy}>Run daily check</button>
          <button className="cd-btn cd-btn-primary" onClick={() => closeActions.start()} disabled={busy || (view && !view.signed)} title={view && !view.signed ? 'Sign the current close first' : ''}>Start a fresh close</button>
        </nav>
      </header>
      {view ? <div className="cd-badge-line" data-testid="source-badge">{view.ledger.badge}{view.modes.paypal === 'mock' ? ' · mock PayPal' : ' · PayPal sandbox'}{LLM_LABEL[view.modes.llm]}</div> : null}
      {error ? <div className="cd-banner cd-error" role="alert">{error}</div> : null}
      {notice ? <div className="cd-banner">{notice}</div> : null}
      <main className="cd-studio"><Suspense fallback={<div className="cd-empty">Loading AG Studio</div>}><StudioView layout={layout} mode={mode} /></Suspense></main>
      <section className="cd-tabs">
        <div role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`cd-tab ${tab === id ? 'is-on' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</div>
        <div className="cd-tabpanel">
          {tab === 'trace' ? <TracePanel /> : null}
          {tab === 'complete' ? <CompletenessPanel /> : null}
          {tab === 'package' ? <PackagePanel /> : null}
        </div>
      </section>
    </div>
  )
}

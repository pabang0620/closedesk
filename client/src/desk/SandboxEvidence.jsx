import { SANDBOX_PASSED, SANDBOX_NOT_PASSED } from './sandboxEvidence.js'

export { SANDBOX_PASSED, SANDBOX_NOT_PASSED }

export function SandboxEvidencePanel() {
  return (
    <div className="cd-package" data-testid="sandbox-evidence">
      <p>Real calls run on 2026-11-12 against the PayPal sandbox and a real Claude model. Full results and fallbacks are in VERIFY.md.</p>
      <h4>Passed</h4>
      <ul>{SANDBOX_PASSED.map((x) => <li key={x.id + x.what}><b>{x.id}</b> {x.what}{x.ids.length ? <>: {x.ids.map((i) => <code key={i}> {i}</code>)}</> : null}</li>)}</ul>
      <h4>Not passed or not run</h4>
      <ul>{SANDBOX_NOT_PASSED.map((x) => <li key={x.id + x.what}><b>{x.id}</b> {x.what}</li>)}</ul>
    </div>
  )
}

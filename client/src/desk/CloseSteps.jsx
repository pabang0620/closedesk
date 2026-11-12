// The four close steps, read from the close view: where the bookkeeper is and what comes next.
const ACTIVE = ['proposed', 'awaiting_owner', 'done']

export default function CloseSteps({ view }) {
  const hasCard = (id) => view.actions.some((a) => a.exceptionId === id && ACTIVE.includes(a.status))
  const next = view.exceptions.find((e) => e.status === 'open' && !hasCard(e.id))
  const waiting = view.actions.filter((a) => a.status === 'awaiting_owner').length
  const now = view.signed ? 5 : view.canSign ? 4 : waiting ? 3 : 2
  const done = (n) => n === 1 || (n === 2 && !next) || (n === 3 && now >= 4) || (n === 4 && view.signed)
  const state = (n) => (n === now ? 'is-now' : done(n) ? 'is-done' : '')
  const steps = [
    ['Daily check ran', `${view.exceptions.length} gaps found`],
    ['Propose a fix', next ? `${view.actions.length ? 'next' : 'start with'} ${next.id}` : 'every gap has a fix'],
    ['Owner approves', waiting ? `${waiting} waiting for the owner` : 'one-time link'],
    ['Sign close', view.signed ? 'signed' : 'at $0.00 unexplained'],
  ]
  return (
    <ol className="cd-steps" aria-label="Close steps" data-testid="close-steps">
      {steps.map(([title, note], i) => (
        <li key={title} className={state(i + 1)} aria-current={i + 1 === now ? 'step' : undefined}>
          <b>{i + 1}</b><span>{title}<small>{note}</small></span>
        </li>
      ))}
    </ol>
  )
}

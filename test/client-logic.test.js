import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withOrderFilter } from '../client/src/studio/crossFilter.js'
import { PAGES } from '../client/src/studio/layouts.js'
import { mockStudioTurn } from '../server/agent/studioTurn.js'
import { idLabel, evidenceLabel, ACTION_LABEL, splitExplanation } from '../client/src/lib/labels.js'

const state = () => ({ pages: structuredClone(PAGES), selectedPageId: 'bookkeeper' })
const filtersOf = (s, page, widget) => s.pages.find((p) => p.id === page).filter?.widget?.[widget] || []

test('cross filter: E2 click puts an order filter on the ledger grid and the promise grid, not on the queue', () => {
  const next = withOrderFilter(state(), '1051')
  assert.deepEqual(filtersOf(next, 'bookkeeper', 'ledger'), [{ field: { id: 'ledger.order' }, model: { operator: 'equals', value: '1051' } }])
  assert.deepEqual(filtersOf(next, 'clients', 'promises'), [{ field: { id: 'promises.order' }, model: { operator: 'equals', value: '1051' } }])
  assert.deepEqual(filtersOf(next, 'bookkeeper', 'queue'), [])
  assert.deepEqual(filtersOf(next, 'clients', 'board'), []) // no ledger or promise columns
})

test('cross filter: another card replaces the filter, no card removes it, other filters stay', () => {
  const withOwn = withOrderFilter(state(), '1042')
  const own = { field: { id: 'promises.type' }, model: { operator: 'equals', value: 'refund' } }
  const seeded = { ...withOwn, pages: withOwn.pages.map((p) => (p.id === 'clients' ? { ...p, filter: { widget: { ...p.filter.widget, promises: [own, ...p.filter.widget.promises] } } } : p)) }
  const moved = withOrderFilter(seeded, '1051')
  assert.equal(filtersOf(moved, 'clients', 'promises').length, 2)
  assert.equal(filtersOf(moved, 'clients', 'promises').at(-1).model.value, '1051')
  const cleared = withOrderFilter(moved, null)
  assert.deepEqual(filtersOf(cleared, 'clients', 'promises'), [own])
  assert.deepEqual(filtersOf(cleared, 'bookkeeper', 'ledger'), [])
  assert.equal(JSON.stringify(state()).includes('1051'), false) // input state is never mutated
})

test('stand-in Studio turn: "Chart money at stake" calls the chart tool, the promise prompt still calls its own tool', () => {
  const tools = [{ name: 'add_money_chart' }, { name: 'show_promise_list' }, { name: 'get_close_status' }]
  const ask = (text) => ({ input: [{ type: 'message', kind: 'input', role: 'user', content: [{ type: 'text', text }] }], tools })
  assert.equal(mockStudioTurn(ask('Chart the money at stake by exception type')).output[0].name, 'add_money_chart')
  assert.equal(mockStudioTurn(ask('Show every refund promise older than 1 day')).output[0].name, 'show_promise_list')
  assert.equal(mockStudioTurn(ask('Where does the close stand right now?')).output[0].name, 'get_close_status')
})

test('labels: no enum or camelCase reaches the screen', () => {
  assert.equal(ACTION_LABEL.REFUND_FULL, 'Refund in full')
  assert.equal(evidenceLabel('support_quote'), 'Support reply')
  assert.equal(evidenceLabel('some_new_kind'), 'some new kind')
  assert.equal(idLabel('refundId'), 'Refund')
  assert.equal(idLabel('fooBarId'), 'foo bar id')
})

test('Ask why answer folds to a three-line summary and keeps every other line behind "Show more"', () => {
  const reply = '**E2 is a duplicate.**\n\n**Why**\n- two payments\n- one order\n- same cart'
  const { summary, rest } = splitExplanation(reply)
  assert.deepEqual(summary, ['E2 is a duplicate.', 'Why', '- two payments'])
  assert.deepEqual(rest, ['- one order', '- same cart'])
  assert.deepEqual(splitExplanation('One line.'), { summary: ['One line.'], rest: [] })
  assert.deepEqual(splitExplanation(undefined), { summary: [], rest: [] })
})

test('the card keeps the code narrative after Ask why; the model classification is a separate field', async () => {
  const { makeWorld, makeClose, byCode } = await import('./helpers.js')
  const { closeView } = await import('../server/close/view.js')
  const world = makeWorld()
  const { close } = await makeClose(world)
  const dup = byCode(close, 'DUPLICATE_PAYMENT')
  dup.hypothesis = 'A long model classification. '.repeat(10)
  const shown = closeView(close, { mode: { paypal: 'mock', llm: 'mock' } }).exceptions.find((e) => e.id === dup.id)
  assert.equal(shown.narrative, dup.narrative)
  assert.equal(shown.hypothesis, dup.hypothesis)
})

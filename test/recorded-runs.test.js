import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.FORCE_MOCK = '1'
const { createApp } = await import('../server/index.js')
const runs = await import('../server/agent/recordedRuns.js')
const { handleStudioTurn } = await import('../server/agent/studioTurn.js')
const { config } = await import('../server/config.js')

const BUILTIN = config.recordedRunsDir
const readBuiltin = (name) => JSON.parse(fs.readFileSync(path.join(BUILTIN, `${name}.json`), 'utf8'))

let server
let base
const call = async (p, { method = 'GET', body, session = 'recorded-session-01' } = {}) => {
  const res = await fetch(`${base}/api${p}`, { method, headers: { 'Content-Type': 'application/json', 'x-session-id': session }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json() }
}

before(async () => {
  const { app } = await createApp()
  await new Promise((resolve) => { server = app.listen(0, resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

const userTurn = (text, extra = []) => ({
  input: [{ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] }, ...extra],
  tools: ['add_money_chart', 'delegate_to', 'get_close_status', 'rename_thread', 'show_promise_list', 'view_report', 'view_schema'].map((name) => ({ name, description: name, parameters: { type: 'object' } })),
})

test('recorded runs: the builtin recordings come from a real model, not a script', () => {
  for (const name of ['daily-check', 'ask-E1', 'ask-E2', 'studio-show-every-refund-promise-older-than-1-day']) {
    const run = readBuiltin(name)
    assert.equal(run.backend, 'account')
    assert.equal(run.model, 'claude-sonnet-5-5')
    assert.match(runs.labelOf(run), /^Recorded run: Claude Sonnet, \d{4}-\d{2}-\d{2}$/)
  }
})

test('recorded runs: id remapping is one pass, so a new id is never replaced again', () => {
  const out = runs.remapIds({ text: 'A then B' }, { x: 'A', y: 'B' }, { x: 'B', y: 'C' })
  assert.equal(out.text, 'B then C')
  assert.deepEqual(runs.remapIds({ a: 1 }, {}, {}), { a: 1 })
})

test('recorded runs: a search window shifts by the time since the recording', () => {
  const shifted = runs.shiftDates({ start_date: '2026-11-01T00:00:00Z', page: 1 }, '2026-11-12T00:00:00Z', Date.parse('2026-11-14T00:00:00Z'))
  assert.equal(shifted.start_date, '2026-11-03T00:00:00.000Z')
  assert.equal(shifted.page, 1)
})

test('recorded runs: an unknown support message falls back to the rules and is counted', async () => {
  const { extractor, misses } = runs.recordedExtractor({ messages: [{ text: 'known', toolCalls: [{ name: 'record_promise', input: { type: 'refund', quote: 'known' } }] }] }, () => ['rules'])
  assert.deepEqual(await extractor({ id: 'm1', text: 'known' }), [{ claimsDone: false, type: 'refund', quote: 'known' }])
  assert.deepEqual(await extractor({ id: 'm2', text: 'other' }), ['rules'])
  assert.deepEqual(misses, ['m2'])
})

test('recorded runs: AG Studio replays the recorded turn for the same prompt, turn and tools, labelled', async () => {
  const first = await handleStudioTurn(userTurn('Show every refund promise older than 1 day'), { client: null })
  assert.equal(first.mode, 'recorded')
  assert.match(first.label, /^Recorded run: Claude Sonnet/)
  const callItem = first.response.output.find((o) => o.type === 'function_call')
  assert.equal(callItem.name, 'show_promise_list')
  const second = await handleStudioTurn(userTurn('Show every refund promise older than 1 day', [{ ...callItem }, { type: 'function_call_output', callId: callItem.callId, output: 'ok' }]), { client: null })
  assert.equal(second.mode, 'recorded')
  assert.match(second.response.output[0].content[0].text, /\(Recorded run: Claude Sonnet, .*, replayed\)$/)
  const other = await handleStudioTurn(userTurn('Which client closes next?'), { client: null })
  assert.equal(other.mode, 'mock')
  assert.equal(other.label, 'Stand-in (no model)')
})

test('recorded runs: live mode never reads a recording and saves one only when asked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-rec-'))
  const fake = { messages: { create: async () => ({ id: 'msg', content: [{ type: 'text', text: 'live answer' }], stop_reason: 'end_turn', model: 'claude-sonnet-5-5' }) } }
  const out = await handleStudioTurn(userTurn('Show every refund promise older than 1 day'), { client: fake, record: false })
  assert.equal(out.mode, 'live')
  assert.equal(out.response.output[0].content[0].text, 'live answer')
  runs.recordStudioTurn(userTurn('Chart it'), out.response, 12, dir)
  const saved = JSON.parse(fs.readFileSync(path.join(dir, `${runs.studioRunName('Chart it')}.json`), 'utf8'))
  assert.equal(saved.turns[0].ms, 12)
  assert.equal(saved.turns[0].output[0].content[0].text, 'live answer')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('recorded runs: without a model the desk replays the real promise reading and Ask why with live PayPal reads', async () => {
  const started = await call('/close/start', { method: 'POST' })
  assert.equal(started.status, 200)
  assert.equal(started.json.data.bridge.unexplainedCents, 30617)
  assert.match(started.json.data.recordedLabel, /^Recorded run: Claude Sonnet/)
  const reading = started.json.data.trace.find((t) => t.tool === 'record_promise')
  assert.match(reading.source, /^Recorded run: Claude Sonnet, \d{4}-\d{2}-\d{2}$/)

  const recorded = readBuiltin('ask-E1')
  const asked = await call('/agent/ask', { method: 'POST', body: { question: 'Why is this an exception? Check PayPal.', exceptionId: 'E1' } })
  assert.equal(asked.status, 200)
  const data = asked.json.data
  assert.equal(data.mode, 'recorded')
  assert.match(data.label, /^Recorded run: Claude Sonnet/)
  assert.deepEqual(data.events.map((e) => e.tool), recorded.turns.flatMap((t) => t.toolCalls.map((c) => c.name)))
  const getOrder = data.events.find((e) => e.tool === 'get_order')
  assert.equal(getOrder.source, 'agent-toolkit')
  assert.equal(getOrder.ok, true)
  // The ids in the answer are this session's ids, not the recorded ones.
  const view = (await call('/close')).json.data
  const e1 = view.exceptions.find((e) => e.id === 'E1')
  const capture = e1.evidence.find((x) => x.kind === 'capture')?.id
  assert.ok(capture && data.reply.includes(capture))
  assert.equal(data.reply.includes(recorded.idMap['captures:1042:0']), false)
  assert.ok(view.trace.some((t) => t.tool === 'get_order' && /Recorded run/.test(t.output)))

  const e3 = await call('/agent/ask', { method: 'POST', body: { question: 'Why?', exceptionId: 'E3' } })
  assert.equal(e3.json.data.mode, 'mock')
  assert.equal(e3.json.data.label, 'Fixed Agent Toolkit read sequence (no model)')
})

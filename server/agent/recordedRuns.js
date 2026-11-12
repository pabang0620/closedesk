import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

// Recorded real model runs. With RECORD_RUNS=1 and a real model (LLM_BACKEND=account or an API key) the server saves
// each AI scene as JSON: the tool calls in order, the model text and the time each model turn took.
// Without a model the app replays a recording where one exists, labelled "Recorded run: Claude Sonnet, <date>",
// instead of the scripted stand-in. Live mode never reads them.

const MODEL_NAME = { 'claude-sonnet-5-5': 'Claude Sonnet' }

export const labelOf = (run) => `Recorded run: ${MODEL_NAME[run.model] || run.model}, ${String(run.recordedAt).slice(0, 10)}`

const fileFor = (dir, name) => path.join(dir, `${name}.json`)

export function readRun(name, dir = config.replayRecordedRuns ? config.recordedRunsDir : '') {
  if (!dir) return null
  try {
    return JSON.parse(fs.readFileSync(fileFor(dir, name), 'utf8'))
  } catch {
    return null
  }
}

export function writeRun(name, run, dir = config.recordedRunsDir) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fileFor(dir, name), `${JSON.stringify(run, null, 2)}\n`)
}

// Wraps a `messages.create` client so each model turn is kept: tool calls, text and duration.
export function recordingClient(client, turns) {
  return {
    messages: {
      async create(body) {
        const started = Date.now()
        const response = await client.messages.create(body)
        turns.push({
          ms: Date.now() - started,
          toolCalls: response.content.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: b.input })),
          text: response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
        })
        return response
      },
    },
  }
}

export const newRun = (scene, extra = {}) => ({ scene, model: config.anthropicModel, backend: config.llmBackend, recordedAt: new Date().toISOString(), ...extra })

// ---- Daily check: promise reading ----

// One entry per support message: the record_promise calls the model made for that exact text.
// A message the recording does not know goes to `fallback` (the rules) and is counted in `misses`.
export function recordedExtractor(run, fallback) {
  const byText = new Map(run.messages.map((m) => [m.text, m.toolCalls]))
  const misses = []
  const extractor = async (message) => {
    const calls = byText.get(message.text)
    if (!calls) {
      misses.push(message.id)
      return fallback(message)
    }
    return calls.filter((c) => c.name === 'record_promise').map((c) => ({ claimsDone: false, ...c.input }))
  }
  return { extractor, misses }
}

// ---- Ask the Close Agent why: ids differ per period, so the recording keeps a map from stable keys to ids ----

export async function idMapOf(close, paypal) {
  const map = { period: close.period.id }
  for (const o of close.books.orders.filter((x) => x.paypalOrderId)) {
    map[`order:${o.orderNo}`] = o.paypalOrderId
    const order = await paypal.getOrder(o.paypalOrderId).catch(() => null)
    const pay = order?.purchase_units?.[0]?.payments || {}
    for (const kind of ['captures', 'authorizations', 'refunds']) (pay[kind] || []).forEach((x, i) => { map[`${kind}:${o.orderNo}:${i}`] = x.id })
  }
  // Transaction Search rows of this period: transaction id, payer account id and time of day, keyed by tag and position.
  const res = await paypal.searchTransactions({ startDate: new Date(close.period.startMs).toISOString(), endDate: new Date().toISOString(), transactionStatus: 'S', pageSize: 500, fields: 'all' }).catch(() => null)
  const seen = {}
  for (const d of res?.transaction_details || []) {
    const info = d.transaction_info || {}
    const tag = String(info.custom_field || '').replace(close.period.id, 'P')
    if (!tag) continue
    const n = (seen[tag] = (seen[tag] ?? -1) + 1)
    const key = `${tag}:${info.transaction_event_code}:${n}`
    map[`txn:${key}`] = info.transaction_id
    if (d.payer_info?.account_id) map[`payer:${key}`] = d.payer_info.account_id
    const time = /T(\d{2}:\d{2}:\d{2})/.exec(info.transaction_initiation_date || '')?.[1]
    if (time) map[`time:${key}`] = time
  }
  for (const t of close.books.threads) {
    for (const m of t.messages) {
      map[`day:${t.orderNo}:${m.id}`] = m.at.slice(0, 10)
      map[`short:${t.orderNo}:${m.id}`] = new Date(m.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    }
  }
  for (const e of close.exceptions) {
    if (e.captureId) map[`ex:${e.id}:capture`] = e.captureId
    if (e.invoiceId) map[`ex:${e.id}:invoice`] = e.invoiceId
  }
  return map
}

// Replaces every recorded id (and date or time of day) with the value the same key has in this session's period.
// One pass, so a replaced value is never replaced again.
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function remapIds(value, recordedMap = {}, currentMap = {}) {
  const swap = new Map()
  for (const [key, old] of Object.entries(recordedMap)) {
    if (old && currentMap[key] && currentMap[key] !== old && !swap.has(old)) swap.set(old, currentMap[key])
  }
  if (!swap.size) return value
  const pattern = new RegExp([...swap.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'g')
  return JSON.parse(JSON.stringify(value).replace(pattern, (m) => swap.get(m)))
}

// Shifts the ISO dates of a recorded search window by the time between the recording and now.
export function shiftDates(input, recordedAt, nowMs) {
  const delta = nowMs - Date.parse(recordedAt)
  const out = { ...input }
  for (const k of ['start_date', 'end_date']) if (out[k] && !Number.isNaN(Date.parse(out[k]))) out[k] = new Date(Date.parse(out[k]) + delta).toISOString()
  return out
}

// ---- AG Studio turns ----

const normalize = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()

// The Close Agent's prompt starters (client/src/studio/closeAgent.js). A typed button label replays the same
// recording as the button, so a judge who types "Chart money at stake" in a running chat still sees the real run.
export const STUDIO_STARTERS = [
  ['Refund promises older than 1 day', 'Show every refund promise older than 1 day'],
  ['Where do we stand?', 'Where does the close stand right now?'],
  ['Chart money at stake', 'Chart the money at stake by exception type'],
  ['Pie of money by direction', 'Add a pie chart of the exception amounts by direction'],
]
const STARTER_ALIAS = new Map(STUDIO_STARTERS.flatMap(([label, prompt]) => [[normalize(label), normalize(prompt)], [normalize(label).replace(/[?.!]+$/, ''), normalize(prompt)]]))
const canonicalPrompt = (text) => {
  const value = normalize(text)
  return STARTER_ALIAS.get(value) || STARTER_ALIAS.get(value.replace(/[?.!]+$/, '')) || value.replace(/[?.!]+$/, '')
}

export function studioKeyOf(request) {
  const items = request.input || []
  let lastUser = -1
  items.forEach((item, i) => { if (item.type === 'message' && item.kind === 'input' && item.role === 'user') lastUser = i })
  const prompt = lastUser < 0 ? '' : canonicalPrompt(items[lastUser].content.map((c) => c.text || '').join(' '))
  const turnIndex = items.slice(lastUser + 1).filter((i) => i.type === 'function_call_output' || (i.type === 'function_call' && i.result !== undefined)).length
  const tools = (request.tools || []).filter((t) => t.kind !== 'provided').map((t) => t.name).sort().join(',')
  return { prompt, turnIndex, tools }
}

export const studioRunName = (prompt) => `studio-${normalize(prompt).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`

// Returns the recorded AG Studio response for this turn, or null.
export function replayStudioTurn(request, dir = config.replayRecordedRuns ? config.recordedRunsDir : '') {
  const { prompt, turnIndex, tools } = studioKeyOf(request)
  if (!prompt) return null
  const run = readRun(studioRunName(prompt), dir)
  const turn = run?.turns?.find((t) => t.turnIndex === turnIndex && t.tools === tools)
  if (!turn) return null
  const label = labelOf(run)
  const output = turn.output.map((item) => (item.type === 'message'
    ? { ...item, content: item.content.map((c, i) => (i === 0 && c.type === 'text' ? { ...c, text: `${c.text}\n\n(${label}, replayed)` } : c)) }
    : item))
  return { response: { ...turn.response, createdAt: Date.now(), output }, label }
}

export function recordStudioTurn(request, response, ms, dir = config.recordedRunsDir) {
  const { prompt, turnIndex, tools } = studioKeyOf(request)
  if (!prompt) return
  const name = studioRunName(prompt)
  const run = (fs.existsSync(fileFor(dir, name)) && readRun(name, dir)) || newRun('studio', { prompt, turns: [] })
  const turns = run.turns.filter((t) => !(t.turnIndex === turnIndex && t.tools === tools))
  const { output, ...rest } = response
  writeRun(name, { ...run, recordedAt: new Date().toISOString(), turns: [...turns, { turnIndex, tools, ms, response: rest, output }].sort((a, b) => a.turnIndex - b.turnIndex) }, dir)
}

import { createAiHarness, directLlmRunner } from 'ag-studio'
import { claudeProxyAdapter } from './claudeAdapter.js'
import { getState } from '../lib/closeStore.js'
import { usd } from '../lib/api.js'

const CLOSE_PROMPT = `You are the Close Agent inside CloseDesk, a month-end close desk for a small online seller (Brightloom Candles).

Domain knowledge:
- Every gap between PayPal and what the seller promised customers is an exception. Over means PayPal holds more than the books say, under means less.
- Unexplained is the sum of open over and open under amounts, added separately as absolute values.
- Only the shop owner can move money (refund, partial refund, capture). The bookkeeper can send invoices and record payments. You never move money and you never state an amount you did not read from a tool: amounts come from the app.
- Exceptions are closed by a PayPal action or carried forward with a reason. A void releases a customer's held money and does not change the bridge.

How you work:
- For status questions call get_close_status.
- To show promises the shop made, call show_promise_list with the age in days. It adds a grid widget to the current page.
- To chart the money at stake, call add_money_chart. It adds a bar chart of exception amounts by type.
- Your own widget tools build exactly two widgets: the promise grid and the money-at-stake bar chart. You cannot build any other widget yourself.
- Any other widget (a pie, line or KPI chart, a grid of another table, a different field or grouping) or any question about the tables and fields: call delegate_to. Do not ask the user first.
  - A new widget takes two delegations, in order. First type "page": "Add one new <widget type> widget below the existing widgets on page <page id>." Its summary gives the new widget id. Then type "widget" with that new widget id: one concrete task naming the table and fields (for example "Show the sum of ledger.amount by ledger.eventCode, title PayPal ledger by event code").
  - Never delegate a change to an existing widget (queue, bridge, meter, ledger, promises, approvals, byStatus, board) unless the user asked to change that widget. They are the desk.
  - A data question: type "data".
- After the delegates return, summarise what they did in one or two sentences.
Style: short and concrete.`


// Builds the grid widget that lists refund promises older than N days.
export function addPromiseWidget(api, days) {
  const state = api.getState()
  const page = state.pages.find((p) => p.id === state.selectedPageId) || state.pages[0]
  const key = `promises-${Date.now().toString(36)}`
  const bottom = Object.values(page.widgetLayout || {}).reduce((m, l) => Math.max(m, l.yTrack + l.ySpan), 0)
  const field = (id) => ({ id })
  const widget = {
    type: 'grid',
    dataMapping: { cols: ['promises.order', 'promises.type', 'promises.madeAt', 'promises.ageDays', 'promises.quote'].map(field) },
    format: { title: { enabled: true, text: `Refund promises older than ${days} day${days === 1 ? '' : 's'}` } },
  }
  const filters = [
    { field: field('promises.type'), model: { operator: 'equals', value: 'refund' } },
    { field: field('promises.ageDays'), model: { operator: 'greaterThanOrEqual', value: days } },
  ]
  const next = {
    ...state,
    pages: state.pages.map((p) => (p.id !== page.id ? p : {
      ...p,
      widgets: { ...p.widgets, [key]: widget },
      widgetLayout: { ...p.widgetLayout, [key]: { xTrack: 0, yTrack: bottom, xSpan: 24, ySpan: 12 } },
      filter: { ...p.filter, widget: { ...(p.filter?.widget || {}), [key]: filters } },
    })),
  }
  api.setState(next)
  return key
}

// Builds a bar chart of exception amounts by type, split by status, on the current page.
export function addMoneyChart(api) {
  const state = api.getState()
  const page = state.pages.find((p) => p.id === state.selectedPageId) || state.pages[0]
  const key = `money-${Date.now().toString(36)}`
  const bottom = Object.values(page.widgetLayout || {}).reduce((m, l) => Math.max(m, l.yTrack + l.ySpan), 0)
  const field = (id, aggregation) => ({ id, ...(aggregation ? { aggregation } : {}) })
  const widget = {
    type: 'bar-chart-stacked',
    dataMapping: { categoryKey: [field('exceptions.title')], valueKey: [field('exceptions.amount', 'sum')], legendKey: [field('exceptions.status')] },
    format: { title: { enabled: true, text: 'Money at stake by exception type' } },
  }
  api.setState({
    ...state,
    pages: state.pages.map((p) => (p.id !== page.id ? p : {
      ...p,
      widgets: { ...p.widgets, [key]: widget },
      widgetLayout: { ...p.widgetLayout, [key]: { xTrack: 0, yTrack: bottom, xSpan: 24, ySpan: 14 } },
    })),
  })
  return key
}

function statusSummary() {
  const { view } = getState()
  if (!view) return 'No close is loaded yet.'
  const b = view.bridge
  const open = view.exceptions.filter((e) => e.status === 'open').map((e) => `${e.id} ${e.title} ${e.amountCents ? usd(e.amountCents) : ''}`.trim())
  return `${view.matched.matched}/${view.matched.total} orders matched. Unexplained ${usd(b.unexplainedCents)} (over ${usd(b.overCents)}, under ${usd(b.underCents)}). Carried forward ${usd(b.carriedForwardCents)}. Source: ${view.ledger.badge}. Open: ${open.join('; ') || 'none'}.`
}

// The harness: a custom Close Agent that knows the domain and hands data and widget work to
// Studio's built-in agents, all running on Claude through the server proxy adapter.
export function createCloseHarness(api) {
  const adapter = claudeProxyAdapter()
  const statusTool = api.defineAiTool({
    name: 'get_close_status',
    description: 'Read the current close: orders matched, unexplained amount, open exceptions and the PayPal source.',
    params: (s) => s.object({}),
    execute: (_args, ctx) => ctx.success(statusSummary()),
  })
  const promiseTool = api.defineAiTool({
    name: 'show_promise_list',
    description: 'Add a grid widget to the current page that lists refund promises support made, older than N days. Use for questions like "show every refund promise older than 1 day".',
    params: (s) => s.object({ olderThanDays: s.number({ description: 'Minimum age of the promise in days' }) }),
    execute: ({ olderThanDays }, ctx) => {
      const days = Math.max(0, Math.round(olderThanDays))
      addPromiseWidget(api, days)
      return ctx.success(`Added a grid of refund promises older than ${days} day(s) to the page.`)
    },
  })
  const chartTool = api.defineAiTool({
    name: 'add_money_chart',
    description: 'Add a bar chart of the money at stake by exception type to the current page. Use for "chart the money at stake" or "unexplained money by exception type".',
    params: (s) => s.object({}),
    execute: (_args, ctx) => {
      addMoneyChart(api)
      return ctx.success('Added a bar chart of money at stake by exception type to the page.')
    },
  })
  return createAiHarness(api, ({ tools, builtIn }) => ({
    agents: [
      directLlmRunner({
        id: 'close',
        name: 'Close Agent',
        description: 'Knows the close: exceptions, the bridge and who may approve what.',
        adapter,
        instructions: () => CLOSE_PROMPT,
        tools: ({ studio, tools: harnessTools }) => [statusTool, promiseTool, chartTool, studio.viewSchema(), studio.viewReport(), harnessTools.delegateTo(['data', 'page', 'widget']), harnessTools.renameThread()],
        maxTurns: 12,
      }),
      ...['lead', 'data', 'page', 'planning', 'widget'].map((id) => directLlmRunner({ ...builtIn[id], adapter })),
    ],
    primary: 'close',
    promptStarters: [
      { label: 'Refund promises older than 1 day', prompt: 'Show every refund promise older than 1 day' },
      { label: 'Where do we stand?', prompt: 'Where does the close stand right now?' },
      { label: 'Chart money at stake', prompt: 'Chart the money at stake by exception type' },
      { label: 'Pie of money by direction', prompt: 'Add a pie chart of the exception amounts by direction' },
    ],
  }))
}


import { Router } from 'express'
import { z } from 'zod'
import { HttpError, parse, sessionHeader } from './http.js'
import { config, modes } from './config.js'
import { getPaypal } from './paypal/index.js'
import { createClose, getClose, getCloseForSession } from './close/closeStore.js'
import { runDailyCheck } from './close/check.js'
import { proposeAction, createOwnerLink, ownerDecide, bookkeeperApprove, signClose } from './close/actions.js'
import { readOwnerToken } from './close/approvals.js'
import { closeView, studioTables, packageView, merchantLabel } from './close/view.js'
import { explainException } from './agent/explain.js'
import { handleStudioTurn } from './agent/studioTurn.js'
import { createClaudeExtractor } from './agent/promiseExtractor.js'
import { getAnthropic } from './agent/anthropicClient.js'
import { chatLimiter } from './demoLimits.js'
import { formatUsd } from './util/money.js'
import { runToolLoop } from './agent/claudeLoop.js'
import { closeAgentTools, makeToolRunner, CLOSE_AGENT_SYSTEM, TOOLKIT_TOOL_NAMES } from './agent/tools.js'
import { dataCompleteness } from './close/completeness.js'

function sessionOf(req) {
  const id = parse(sessionHeader, req.get('x-session-id'))
  return id
}

function requireClose(req) {
  const close = getCloseForSession(sessionOf(req))
  if (!close) throw new HttpError(404, 'No close yet. Start one first.', 'NO_CLOSE')
  return close
}

const viewOf = (close) => closeView(close, { mode: modes })
const extractorFor = () => {
  const client = getAnthropic()
  return client ? createClaudeExtractor(client) : undefined
}

export function createRoutes({ periods }) {
  const router = Router()
  const deps = () => ({ paypal: getPaypal(), now: () => Date.now() })

  router.get('/health', (_req, res) => {
    res.json({ success: true, data: { modes, periods: { ...Object.fromEntries(Object.entries(periods.stats()).map(([k, v]) => [k, v.length])), lastError: periods.lastError() } } })
  })

  // Start a fresh close: assigns one prepared period to this session and runs the daily check.
  router.post('/close/start', async (req, res, next) => {
    try {
      const sessionId = sessionOf(req)
      const existing = getCloseForSession(sessionId)
      if (existing && !existing.signed) return res.json({ success: true, data: viewOf(existing) })
      const { period, limited, exhausted } = periods.assign(`${sessionId}${existing ? `-${Date.now()}` : ''}`)
      if (!period) throw new HttpError(503, periods.lastError() || 'No prepared period is available right now. Try again in a few minutes.', 'NO_PERIOD')
      const close = createClose({ sessionId, period, books: structuredClone(period.books) })
      await runDailyCheck(close, { ...deps(), extractor: extractorFor() })
      res.json({ success: true, data: { ...viewOf(close), notice: limited ? 'Daily limit reached: showing a closed period.' : exhausted ? 'All prepared periods are used: showing a closed period.' : undefined } })
    } catch (err) { next(err) }
  })

  router.get('/close', (req, res, next) => {
    try { res.json({ success: true, data: viewOf(requireClose(req)) }) } catch (err) { next(err) }
  })

  router.post('/close/check', async (req, res, next) => {
    try {
      const close = requireClose(req)
      await runDailyCheck(close, { ...deps(), extractor: extractorFor() })
      res.json({ success: true, data: viewOf(close) })
    } catch (err) { next(err) }
  })

  router.get('/close/studio-data', (req, res, next) => {
    try { res.json({ success: true, data: studioTables(requireClose(req)) }) } catch (err) { next(err) }
  })

  const proposeBody = z.object({ action: z.enum(['REFUND_FULL', 'REFUND_PARTIAL', 'CAPTURE_AUTH', 'VOID_AUTH', 'SEND_INVOICE', 'RECORD_PAYMENT', 'JOURNAL_ONLY']).optional(), acknowledgeAmountReview: z.boolean().optional() }).strict()

  router.post('/exceptions/:id/propose', (req, res, next) => {
    try {
      const close = requireClose(req)
      const body = parse(proposeBody, req.body ?? {})
      const card = proposeAction(close, req.params.id, body)
      res.json({ success: true, data: { card, view: viewOf(close) } })
    } catch (err) { next(err) }
  })

  router.post('/actions/:id/owner-link', (req, res, next) => {
    try {
      const close = requireClose(req)
      const link = createOwnerLink(close, req.params.id, deps())
      res.json({ success: true, data: { url: link.url, expiresInMinutes: config.ownerLinkMinutes, view: viewOf(close) } })
    } catch (err) { next(err) }
  })

  router.post('/actions/:id/approve', async (req, res, next) => {
    try {
      const close = requireClose(req)
      await bookkeeperApprove(close, req.params.id, deps())
      res.json({ success: true, data: viewOf(close) })
    } catch (err) { next(err) }
  })

  // Owner page. The token alone identifies the close and the action.
  router.get('/owner/:token', (req, res, next) => {
    try {
      const claims = readOwnerToken(req.params.token)
      const close = getClose(claims.closeId)
      const card = close?.actions.find((a) => a.id === claims.actionId)
      if (!card) throw new HttpError(404, 'Approval not found.', 'NOT_FOUND')
      const ex = close.exceptions.find((e) => e.id === card.exceptionId)
      res.json({
        success: true,
        data: {
          merchant: merchantLabel(modes),
          requestedBy: 'Bookkeeper',
          action: card.action,
          amountCents: card.amountCents,
          amountText: formatUsd(card.amountCents),
          amountSource: card.amountSource,
          title: ex.title,
          orderNo: ex.orderNo,
          evidence: ex.evidence,
          preview: card.preview,
          status: card.status,
          expiresAt: new Date(claims.expiresAt).toISOString(),
        },
      })
    } catch (err) { next(err) }
  })

  router.post('/owner/:token/decision', async (req, res, next) => {
    try {
      const { decision } = parse(z.object({ decision: z.enum(['approve', 'decline']) }).strict(), req.body ?? {})
      const closes = { get: getClose }
      const card = await ownerDecide(closes, req.params.token, decision, deps())
      res.json({ success: true, data: { status: card.status, result: card.result, error: card.error } })
    } catch (err) { next(err) }
  })

  router.post('/close/sign', (req, res, next) => {
    try {
      const close = requireClose(req)
      signClose(close, deps())
      res.json({ success: true, data: { view: viewOf(close), package: packageView(close) } })
    } catch (err) { next(err) }
  })

  router.get('/close/completeness', async (req, res, next) => {
    try {
      const close = requireClose(req)
      res.json({ success: true, data: await dataCompleteness({ paypal: getPaypal(), period: close.period, nowMs: Date.now() }) })
    } catch (err) { next(err) }
  })

  // Question to the Close Agent (server side tool loop). With `exceptionId` it explains that exception.
  // Without a model it runs a fixed Agent Toolkit read sequence (get_order, list_transactions) and answers from the results.
  // Either way the tool calls are appended to the Agent trace with source "agent-toolkit".
  router.post('/agent/ask', chatLimiter, async (req, res, next) => {
    try {
      const close = requireClose(req)
      const { question, exceptionId } = parse(z.object({ question: z.string().min(1).max(500), exceptionId: z.string().regex(/^E\d{1,3}$/).optional() }).strict(), req.body)
      if (exceptionId && !close.exceptions.some((e) => e.id === exceptionId)) throw new HttpError(404, 'Exception not found.', 'NOT_FOUND')
      const client = req.demoLimited ? null : getAnthropic()
      if (!client) {
        if (exceptionId) return res.json({ success: true, data: { ...(await explainException(close, exceptionId, { now: Date.now() })), mode: 'mock' } })
        const b = viewOf(close).bridge
        return res.json({ success: true, data: { reply: `Unexplained ${formatUsd(b.unexplainedCents)} across ${b.openCount} open exceptions.`, mode: 'mock', events: [] } })
      }
      const ex = exceptionId ? close.exceptions.find((e) => e.id === exceptionId) : null
      const content = ex ? `Exception ${ex.id} (${ex.title}, order ${ex.orderNo || 'none'}): ${ex.narrative}\n${question}` : question
      const out = await runToolLoop({ client, model: config.anthropicModel, system: CLOSE_AGENT_SYSTEM, tools: closeAgentTools(), runTool: makeToolRunner(close), messages: [{ role: 'user', content }] })
      const events = out.events.map((e) => ({ ...e, source: e.tool in TOOLKIT_TOOL_NAMES ? 'agent-toolkit' : 'code' }))
      close.trace = [...close.trace, ...events.map((e) => ({ tool: e.tool, input: e.input, output: e.ok ? 'ok' : 'failed', source: e.source, atMs: Date.now() }))]
      res.json({ success: true, data: { reply: out.reply, mode: modes.llm, events } })
    } catch (err) { next(err) }
  })

  router.get('/close/package', (req, res, next) => {
    try { res.json({ success: true, data: packageView(requireClose(req)) }) } catch (err) { next(err) }
  })

  router.get('/close/journal.csv', (req, res, next) => {
    try {
      res.type('text/csv').send(packageView(requireClose(req)).journalCsv)
    } catch (err) { next(err) }
  })

  // AG Studio's Claude adapter posts its turns here. Over the demo limit it answers from the stand-in.
  router.post('/studio/turn', chatLimiter, async (req, res, next) => {
    try {
      requireClose(req)
      const body = parse(z.object({ request: z.object({ input: z.array(z.any()).max(400), tools: z.array(z.any()).max(80).optional(), instructions: z.string().max(60000).optional(), toolChoice: z.any().optional(), responseFormat: z.any() }).passthrough() }).strict(), req.body)
      const client = req.demoLimited ? null : getAnthropic()
      res.json({ success: true, data: await handleStudioTurn(body.request, { client }) })
    } catch (err) { next(err) }
  })

  return router
}

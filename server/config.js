import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

const here = path.dirname(fileURLToPath(import.meta.url))

const forceMock = process.env.FORCE_MOCK === '1'
const port = Number(process.env.PORT || 3003)
const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '')

export const config = {
  port,
  publicUrl,
  appUrl: (process.env.APP_URL || publicUrl).replace(/\/$/, ''),
  // LLM_BACKEND=account runs the model through the developer's Claude Code login (local use only). The API key is never read then.
  llmBackend: forceMock ? 'mock' : process.env.LLM_BACKEND === 'account' ? 'account' : 'api',
  anthropicKey: forceMock || process.env.LLM_BACKEND === 'account' ? '' : process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  paypalClientId: forceMock ? '' : process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: forceMock ? '' : process.env.PAYPAL_CLIENT_SECRET || '',
  // Sandbox only. The SDK path refuses any other host (see server/paypal/sdkClient.js).
  paypalApiBase: process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com',
  // Signs the one-time owner approval links. Required when a real PayPal sandbox app is configured.
  approvalSecret: process.env.APPROVAL_SECRET || '',
  readyPeriodTarget: Number(process.env.READY_PERIOD_TARGET || 5),
  periodMaxAgeDays: Number(process.env.PERIOD_MAX_AGE_DAYS || 3),
  assignPerDay: Number(process.env.ASSIGN_PER_DAY || 200),
  ownerLinkMinutes: 30,
  // Seed card payments via payment_source.card (needs sandbox verification, see VERIFY.md).
  seedWithCard: process.env.SEED_WITH_CARD === '1',
  // Prepared sandbox periods written by scripts/seed-period.js. The server reads them at start.
  periodsDir: process.env.PERIODS_DIR || path.resolve(here, '../data/periods'),
}

export const modes = {
  llm: config.llmBackend === 'account' ? 'account' : config.anthropicKey ? 'live' : 'mock',
  paypal: config.paypalClientId && config.paypalClientSecret ? 'sandbox' : 'mock',
}

if (modes.paypal === 'sandbox' && !config.approvalSecret) {
  throw new Error('APPROVAL_SECRET is required when PayPal sandbox credentials are set.')
}

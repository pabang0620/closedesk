import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { config, modes } from './config.js'
import { errorHandler } from './http.js'
import { getPaypal } from './paypal/index.js'
import { createPeriodManager } from './close/periods.js'
import { createRoutes } from './routes.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPLENISH_EVERY_MS = 3 * 3_600_000

export async function createApp({ paypal = getPaypal(), useCard = config.seedWithCard || modes.paypal === 'mock', periodsDir = config.periodsDir } = {}) {
  const periods = createPeriodManager({
    paypal, targetReady: config.readyPeriodTarget, maxAgeDays: config.periodMaxAgeDays, assignPerDay: config.assignPerDay, useCard, periodsDir, log: (message) => console.error(message),
  })
  // A seed failure must not stop the server: it starts, and the reason shows in /api/health and on the desk.
  await periods.safeReplenish()
  const timer = setInterval(() => periods.safeReplenish(), REPLENISH_EVERY_MS)
  timer.unref()

  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '1mb' }))
  app.use('/api', createRoutes({ periods }))
  app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Not found' }))
  const dist = path.resolve(here, '../dist')
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  app.use(errorHandler)
  return { app, periods }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app } = await createApp()
  app.listen(config.port, () => {
    console.info(`CloseDesk on ${config.publicUrl} (PayPal: ${modes.paypal}, model: ${modes.llm})`)
  })
}

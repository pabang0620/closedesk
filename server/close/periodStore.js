import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

// Prepared period files written by scripts/seed-period.js (one JSON file per period).
// The server reads the finished ones at start and hands them to judges like any seeded period.
const recordSchema = z.object({
  books: z.object({ orders: z.array(z.any()), threads: z.array(z.any()), invoices: z.array(z.any()) }).passthrough(),
  manifest: z.object({
    periodId: z.string().regex(/^[A-Za-z0-9]{3,14}$/),
    seededAtMs: z.number(),
    state: z.enum(['awaiting_approval', 'ready']),
    authorizationIds: z.array(z.string()),
    captureIds: z.record(z.string(), z.string()),
    duplicateCaptureId: z.string().nullable(),
    invoiceId: z.string().nullable(),
    pending: z.array(z.object({ key: z.string(), orderNo: z.string(), orderId: z.string(), intent: z.string(), approveUrl: z.string().nullable() })),
  }).passthrough(),
})

export function savePeriodRecord(dir, record) {
  const parsed = recordSchema.parse(record)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${parsed.manifest.periodId}.json`)
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  return file
}

export function readPeriodRecord(dir, periodId) {
  return recordSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, `${periodId}.json`), 'utf8')))
}

// Only finished periods. A file that does not parse is skipped so one bad file cannot stop the server.
export function loadFinishedRecords(dir) {
  if (!dir || !fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try {
      const record = recordSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
      return record.manifest.state === 'ready' ? [record] : []
    } catch {
      return []
    }
  })
}

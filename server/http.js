import { z } from 'zod'

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'VALIDATION')
  }
  return result.data
}

export const sessionHeader = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/)

// Central error handler: the single place that decides status codes and error JSON.
export function errorHandler(err, _req, res, _next) {
  const status = err instanceof HttpError ? err.status : 500
  if (status === 500) console.error(err)
  res.status(status).json({ success: false, error: status === 500 ? 'Internal error' : err.message, code: err.code })
}

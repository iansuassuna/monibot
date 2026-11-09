import { createLogger } from '@monibot/logger'
import type { ErrorHandler, NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { failure } from '../lib/envelope'
import { HttpError } from '../lib/http-error'

const logger = createLogger('ErrorHandler')

export const errorHandler: ErrorHandler = (error, c) => {
  if (error instanceof HttpError) {
    if (error.status >= 500) logger.error(error.message, { code: error.code, error })
    return c.json(failure(error.code, error.message, error.details), error.status)
  }
  if (error instanceof HTTPException) {
    const code =
      error.status === 401
        ? 'UNAUTHORIZED'
        : error.status === 403
          ? 'FORBIDDEN'
          : 'VALIDATION_ERROR'
    return c.json(failure(code, error.message), error.status)
  }
  logger.error('Unhandled error', { method: c.req.method, path: c.req.path, error })
  return c.json(failure('INTERNAL_ERROR', 'Internal server error'), 500)
}

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(failure('NOT_FOUND', `Route ${c.req.method} ${c.req.path} not found`), 404)

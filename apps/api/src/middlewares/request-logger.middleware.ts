import { createLogger } from '@monibot/logger'
import { createMiddleware } from 'hono/factory'

const logger = createLogger('Http')

export const requestLogger = createMiddleware(async (c, next) => {
  const start = performance.now()
  await next()
  logger.info('request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Math.round(performance.now() - start),
  })
})

import { getAuth } from '@monibot/auth'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './env'
import { success } from './lib/envelope'
import { errorHandler, notFoundHandler } from './middlewares/error.middleware'
import { requestLogger } from './middlewares/request-logger.middleware'
import { evaluationsRoutes } from './routes/evaluations.routes'
import { knowledgeRoutes } from './routes/knowledge.routes'
import { matrixRoutes } from './routes/matrix.routes'
import { sessionsRoutes } from './routes/sessions.routes'
import { telemetryRoutes } from './routes/telemetry.routes'

const app = new Hono()
  .basePath('/api')
  .use(requestLogger)
  .use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      allowHeaders: ['content-type', 'authorization', 'x-agent-secret'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    })
  )
  .on(['GET', 'POST'], '/auth/*', (c) => getAuth().handler(c.req.raw))
  .get('/health', (c) => c.json(success({ status: 'ok' as const }), 200))
  .route('/knowledge', knowledgeRoutes)
  .route('/sessions', sessionsRoutes)
  .route('/telemetry', telemetryRoutes)
  .route('/evaluations', evaluationsRoutes)
  .route('/matrix', matrixRoutes)

app.onError(errorHandler)
app.notFound(notFoundHandler)

export type AppType = typeof app
export { app }

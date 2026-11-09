import { createLogger } from '@monibot/logger'
import { env } from './env'
import { app } from './index'

const logger = createLogger('ApiServer')

const server = Bun.serve({ port: env.API_PORT, fetch: app.fetch, idleTimeout: 255 })

logger.info('MoniBot API listening', { url: server.url.href })

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    logger.info('Shutting down', { signal })
    await server.stop()
    process.exit(0)
  })
}

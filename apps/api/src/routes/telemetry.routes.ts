import { interactionLogCreateSchema } from '@monibot/types'
import { Hono } from 'hono'
import { success } from '../lib/envelope'
import { validate } from '../lib/validate'
import { requireResearcher } from '../middlewares/auth.middleware'
import { requireAgentSecret } from '../middlewares/internal-auth.middleware'
import { getAnalytics } from '../services/analytics.service'
import { recordInteraction } from '../services/telemetry.service'

export const telemetryRoutes = new Hono()
  .post('/logs', requireAgentSecret, validate('json', interactionLogCreateSchema), async (c) =>
    c.json(success(await recordInteraction(c.req.valid('json'))), 201)
  )
  .get('/analytics', requireResearcher, async (c) => c.json(success(await getAnalytics()), 200))

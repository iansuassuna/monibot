import {
  createLivekitTokenSchema,
  createTutoringSessionSchema,
  idParamsSchema,
  type LivekitToken,
  listTutoringSessionsQuerySchema,
  matrixCallMemberEventSchema,
} from '@monibot/types'
import { Hono } from 'hono'
import { success } from '../lib/envelope'
import { validate } from '../lib/validate'
import {
  requireResearcher,
  requireSession,
  requireUserOrAgent,
} from '../middlewares/auth.middleware'
import { requireMatrixWebhookSecret } from '../middlewares/internal-auth.middleware'
import {
  createParticipantToken,
  ensureAgentDispatched,
  livekitServerUrl,
} from '../services/livekit.service'
import { handleCallMemberEvent } from '../services/matrix.service'
import {
  createSession,
  endSession,
  getSession,
  getSessionRow,
  listSessions,
  markSessionActive,
} from '../services/sessions.service'

export const sessionsRoutes = new Hono()
  .post('/', requireResearcher, validate('json', createTutoringSessionSchema), async (c) =>
    c.json(success(await createSession(c.req.valid('json'))), 201)
  )
  .get('/', requireSession, validate('query', listTutoringSessionsQuerySchema), async (c) =>
    c.json(success(await listSessions(c.req.valid('query'))), 200)
  )
  .post(
    '/matrix-webhook',
    requireMatrixWebhookSecret,
    validate('json', matrixCallMemberEventSchema),
    async (c) => c.json(success(await handleCallMemberEvent(c.req.valid('json'))), 200)
  )
  .get('/:id', requireUserOrAgent, validate('param', idParamsSchema), async (c) =>
    c.json(success(await getSession(c.req.valid('param').id)), 200)
  )
  .post(
    '/:id/token',
    requireSession,
    validate('param', idParamsSchema),
    validate('json', createLivekitTokenSchema),
    async (c) => {
      const session = await markSessionActive(await getSessionRow(c.req.valid('param').id))
      const token = await createParticipantToken({
        roomName: session.livekitRoomName,
        identity: c.var.user.id,
        name: c.req.valid('json').participantName,
      })
      await ensureAgentDispatched(session.livekitRoomName, { sessionId: session.id })
      const data: LivekitToken = {
        token,
        serverUrl: livekitServerUrl,
        roomName: session.livekitRoomName,
        agentDispatched: true,
      }
      return c.json(success(data), 200)
    }
  )
  .post('/:id/end', requireResearcher, validate('param', idParamsSchema), async (c) =>
    c.json(success(await endSession(c.req.valid('param').id)), 200)
  )

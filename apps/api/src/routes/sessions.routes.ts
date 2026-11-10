import {
  agentPresenceSchema,
  agentStateEventSchema,
  createLivekitTokenSchema,
  createTutoringSessionSchema,
  idParamsSchema,
  type LivekitToken,
  listTutoringSessionsQuerySchema,
  matrixCallMemberEventSchema,
} from '@monibot/types'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { success } from '../lib/envelope'
import { validate } from '../lib/validate'
import {
  requireResearcher,
  requireSession,
  requireUserOrAgent,
} from '../middlewares/auth.middleware'
import {
  requireAgentSecret,
  requireMatrixWebhookSecret,
} from '../middlewares/internal-auth.middleware'
import { publishAgentEvent, subscribeAgentEvents } from '../services/agent-events.service'
import {
  createParticipantToken,
  ensureAgentDispatched,
  livekitServerUrl,
} from '../services/livekit.service'
import {
  agentIdentityForSession,
  handleCallMemberEvent,
  updateAgentPresence,
} from '../services/matrix.service'
import { issueCallCredentials } from '../services/matrix-students.service'
import {
  createSession,
  endSession,
  getAgentE2eeKey,
  getSession,
  getSessionRow,
  listSessions,
  markSessionActive,
} from '../services/sessions.service'

/** Below Bun's `idleTimeout` (255 s) and typical proxy timeouts. */
const AGENT_EVENTS_HEARTBEAT_MS = 15_000

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
      await ensureAgentDispatched(session.livekitRoomName, {
        sessionId: session.id,
        participantIdentity: agentIdentityForSession(session),
      })
      const data: LivekitToken = {
        token,
        serverUrl: livekitServerUrl,
        roomName: session.livekitRoomName,
        agentDispatched: true,
      }
      return c.json(success(data), 200)
    }
  )
  .post('/:id/matrix-credentials', requireSession, validate('param', idParamsSchema), async (c) => {
    const credentials = await issueCallCredentials(c.req.valid('param').id, {
      id: c.var.user.id,
      name: c.var.user.name,
    })
    // An access token and the call password: never cached by the browser or a proxy.
    c.header('Cache-Control', 'no-store')
    return c.json(success(credentials), 200)
  })
  .post('/:id/end', requireResearcher, validate('param', idParamsSchema), async (c) =>
    c.json(success(await endSession(c.req.valid('param').id)), 200)
  )
  .post(
    '/:id/agent-events',
    requireAgentSecret,
    validate('param', idParamsSchema),
    validate('json', agentStateEventSchema),
    (c) => c.json(success(publishAgentEvent(c.req.valid('param').id, c.req.valid('json'))), 202)
  )
  .get('/:id/agent-events', requireSession, validate('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    await getSessionRow(id)
    const response = streamSSE(c, async (stream) => {
      // Bun sends the response headers with the first chunk; without this the client would only
      // see the stream open at the first heartbeat.
      await stream.writeSSE({ event: 'ready', data: '' })
      const unsubscribe = subscribeAgentEvents(id, (event) => {
        void stream.writeSSE({ event: 'agent-state', data: JSON.stringify(event) })
      })
      // Proxies and Bun's idle timeout close a silent stream; a comment-like ping keeps it open.
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: '' })
      }, AGENT_EVENTS_HEARTBEAT_MS)
      await new Promise<void>((resolve) => stream.onAbort(resolve))
      clearInterval(heartbeat)
      unsubscribe()
    })
    // The web reaches this stream through Next's rewrite proxy, whose gzip would hold events in
    // its buffer; `no-transform` keeps proxies from compressing (or nginx from buffering) it.
    // Set on the context: Hono re-applies context headers over the returned response's.
    c.header('Cache-Control', 'no-cache, no-transform')
    c.header('X-Accel-Buffering', 'no')
    return response
  })
  .get('/:id/e2ee-key', requireAgentSecret, validate('param', idParamsSchema), async (c) =>
    c.json(success(await getAgentE2eeKey(c.req.valid('param').id)), 200)
  )
  .post(
    '/:id/agent-presence',
    requireAgentSecret,
    validate('param', idParamsSchema),
    validate('json', agentPresenceSchema),
    async (c) =>
      c.json(
        success(await updateAgentPresence(c.req.valid('param').id, c.req.valid('json').state)),
        200
      )
  )

import { createLogger } from '@monibot/logger'
import {
  matrixCallMemberEventSchema,
  matrixTransactionParamsSchema,
  matrixTransactionSchema,
} from '@monibot/types'
import { Hono } from 'hono'
import { validate } from '../lib/validate'
import { requireMatrixWebhookSecret } from '../middlewares/internal-auth.middleware'
import { handleCallMemberEvent } from '../services/matrix.service'

const logger = createLogger('MatrixAppService')

const CALL_MEMBER_TYPES = new Set(['m.call.member', 'org.matrix.msc3401.call.member'])

/**
 * Matrix Application Service endpoints (the homeserver appends `/_matrix/app/v1/...` to the
 * registration URL). Responses follow the Matrix spec (`{}`), not the API envelope.
 */
export const matrixRoutes = new Hono()
  .put(
    '/_matrix/app/v1/transactions/:txnId',
    requireMatrixWebhookSecret,
    validate('param', matrixTransactionParamsSchema),
    validate('json', matrixTransactionSchema),
    async (c) => {
      const { txnId } = c.req.valid('param')
      for (const raw of c.req.valid('json').events) {
        if (!CALL_MEMBER_TYPES.has(raw.type)) continue
        const event = matrixCallMemberEventSchema.safeParse(raw)
        if (!event.success) {
          logger.warn('Ignored malformed call membership event', {
            txnId,
            issues: event.error.issues,
          })
          continue
        }
        // One failing event must not fail the transaction, or the homeserver retries it forever.
        try {
          const result = await handleCallMemberEvent(event.data)
          logger.info('Call membership handled', { txnId, roomId: event.data.room_id, ...result })
        } catch (error) {
          logger.error('Call membership handling failed', {
            txnId,
            roomId: event.data.room_id,
            error,
          })
        }
      }
      return c.json({}, 200)
    }
  )
  .post('/_matrix/app/v1/ping', requireMatrixWebhookSecret, (c) => c.json({}, 200))

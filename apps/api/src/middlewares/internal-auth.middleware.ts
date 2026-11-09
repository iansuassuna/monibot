import { timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { env } from '../env'
import { HttpError } from '../lib/http-error'

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function isValidAgentSecret(provided: string | undefined): boolean {
  return provided !== undefined && safeEqual(provided, env.AGENT_SECRET)
}

/** Internal endpoints called only by apps/agent-worker. */
export const requireAgentSecret = createMiddleware(async (c, next) => {
  if (!isValidAgentSecret(c.req.header('x-agent-secret'))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid agent secret')
  }
  await next()
})

/** Matrix homeserver/appservice webhook: `Authorization: Bearer <MATRIX_WEBHOOK_SECRET>`. */
export const requireMatrixWebhookSecret = createMiddleware(async (c, next) => {
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!token || !safeEqual(token, env.MATRIX_WEBHOOK_SECRET)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid webhook token')
  }
  await next()
})

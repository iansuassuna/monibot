import { createLogger } from '@monibot/logger'
import { type MatrixStateEvent, matrixStateEventSchema } from '@monibot/types'
import { z } from 'zod'
import { env } from '../env'
import { upstreamUnavailable } from '../lib/http-error'

const logger = createLogger('MatrixClient')

const REQUEST_TIMEOUT_MS = 5000

const delayedEventResponseSchema = z.object({ delay_id: z.string().min(1) })
const profileResponseSchema = z.object({ displayname: z.string().optional() })

interface MatrixResponse {
  status: number
  body: unknown
}

/** Whether the appservice token is configured, i.e. the API may act as the bot user. */
export function isMatrixAppserviceConfigured(): boolean {
  return env.MATRIX_AS_TOKEN !== undefined
}

/** Client-server API call as the appservice's bot user (`?user_id=` assertion). */
async function asRequest(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  options: { body?: unknown; query?: Record<string, string> } = {}
): Promise<MatrixResponse> {
  const url = new URL(path, env.MATRIX_HOMESERVER_URL)
  url.searchParams.set('user_id', env.MATRIX_BOT_USER_ID)
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
  try {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${env.MATRIX_AS_TOKEN ?? ''}`,
        'content-type': 'application/json',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return { status: response.status, body: await response.json().catch(() => undefined) }
  } catch (error) {
    logger.error('Matrix request failed', { method, path: url.pathname, error })
    throw upstreamUnavailable('Matrix', error)
  }
}

async function expectOk(method: 'GET' | 'POST' | 'PUT', path: string, options = {}) {
  const response = await asRequest(method, path, options)
  if (response.status < 200 || response.status >= 300) {
    logger.error('Matrix request rejected', { method, path, status: response.status })
    throw upstreamUnavailable('Matrix', response.body)
  }
  return response.body
}

const enc = encodeURIComponent

/**
 * Joins `roomId` as the bot. Returns false when the homeserver refuses (4xx: unknown or remote
 * room, no invite); network failures and server errors still throw as an unavailable upstream.
 */
export async function joinRoom(roomId: string): Promise<boolean> {
  const response = await asRequest('POST', `/_matrix/client/v3/join/${enc(roomId)}`, { body: {} })
  if (response.status >= 200 && response.status < 300) return true
  if (response.status >= 400 && response.status < 500) {
    logger.warn('Homeserver refused to let the bot join the room', {
      roomId,
      status: response.status,
      reason: response.body,
    })
    return false
  }
  logger.error('Matrix request rejected', { method: 'POST', path: 'join', status: response.status })
  throw upstreamUnavailable('Matrix', response.body)
}

/** Sets the bot's display name unless it already has it (each change is announced to every room). */
export async function ensureDisplayName(displayName: string): Promise<void> {
  const profilePath = `/_matrix/client/v3/profile/${enc(env.MATRIX_BOT_USER_ID)}/displayname`
  const current = profileResponseSchema.safeParse((await asRequest('GET', profilePath)).body)
  if (current.data?.displayname === displayName) return
  await expectOk('PUT', profilePath, { body: { displayname: displayName } })
}

export async function getRoomState(roomId: string): Promise<MatrixStateEvent[]> {
  const body = await expectOk('GET', `/_matrix/client/v3/rooms/${enc(roomId)}/state`)
  return z.array(matrixStateEventSchema).parse(body)
}

export async function putState(
  roomId: string,
  eventType: string,
  stateKey: string,
  content: Record<string, unknown>
): Promise<void> {
  await expectOk(
    'PUT',
    `/_matrix/client/v3/rooms/${enc(roomId)}/state/${enc(eventType)}/${enc(stateKey)}`,
    { body: content }
  )
}

/**
 * Schedules a state event the homeserver sends by itself after `delayMs` unless restarted
 * (MSC4140). Returns its delay id.
 */
export async function putDelayedState(
  roomId: string,
  eventType: string,
  stateKey: string,
  content: Record<string, unknown>,
  delayMs: number
): Promise<string> {
  const body = await expectOk(
    'PUT',
    `/_matrix/client/v3/rooms/${enc(roomId)}/state/${enc(eventType)}/${enc(stateKey)}`,
    { body: content, query: { 'org.matrix.msc4140.delay': String(delayMs) } }
  )
  return delayedEventResponseSchema.parse(body).delay_id
}

/**
 * Restarts or cancels a delayed event. Returns false when the homeserver no longer knows it
 * (already sent, cancelled, or lost), so the caller can re-establish it.
 */
export async function updateDelayedEvent(
  delayId: string,
  action: 'restart' | 'cancel'
): Promise<boolean> {
  const path = `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/${enc(delayId)}`
  const response = await asRequest('POST', path, { body: { action } })
  if (response.status === 404) return false
  if (response.status < 200 || response.status >= 300) {
    logger.error('Matrix delayed event update rejected', { action, status: response.status })
    throw upstreamUnavailable('Matrix', response.body)
  }
  return true
}

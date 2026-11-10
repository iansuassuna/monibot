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
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface AsRequestOptions {
  body?: unknown
  query?: Record<string, string>
  /** User the appservice acts as (its namespace only); defaults to the bot. */
  asUser?: string
}

async function asRequest(
  method: HttpMethod,
  path: string,
  options: AsRequestOptions = {}
): Promise<MatrixResponse> {
  const url = new URL(path, env.MATRIX_HOMESERVER_URL)
  url.searchParams.set('user_id', options.asUser ?? env.MATRIX_BOT_USER_ID)
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

async function expectOk(method: HttpMethod, path: string, options: AsRequestOptions = {}) {
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

/** Sets a display name unless the user already has it (each change is announced to every room). */
export async function ensureDisplayName(
  displayName: string,
  userId: string = env.MATRIX_BOT_USER_ID
): Promise<void> {
  const profilePath = `/_matrix/client/v3/profile/${enc(userId)}/displayname`
  const current = profileResponseSchema.safeParse((await asRequest('GET', profilePath)).body)
  if (current.data?.displayname === displayName) return
  await expectOk('PUT', profilePath, { body: { displayname: displayName }, asUser: userId })
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

const createRoomResponseSchema = z.object({ room_id: z.string().min(1) })

/** Creates a room as the bot; returns its room ID. */
export async function createRoom(request: Record<string, unknown>): Promise<string> {
  const body = await expectOk('POST', '/_matrix/client/v3/createRoom', { body: request })
  return createRoomResponseSchema.parse(body).room_id
}

/** Removes a member or rescinds an invite. */
export async function kickFromRoom(roomId: string, userId: string, reason: string): Promise<void> {
  await expectOk('POST', `/_matrix/client/v3/rooms/${enc(roomId)}/kick`, {
    body: { user_id: userId, reason },
  })
}

export async function leaveRoom(roomId: string): Promise<void> {
  await expectOk('POST', `/_matrix/client/v3/rooms/${enc(roomId)}/leave`, { body: {} })
}

const loginResponseSchema = z.object({
  access_token: z.string().min(1),
  device_id: z.string().min(1),
})
const devicesResponseSchema = z.object({
  devices: z.array(z.object({ device_id: z.string(), display_name: z.string().optional() })),
})
const errorCodeSchema = z.object({ errcode: z.string() })

/** Registers a user in the appservice's namespace; an existing account is fine. */
export async function registerAppserviceUser(localpart: string): Promise<void> {
  const response = await asRequest('POST', '/_matrix/client/v3/register', {
    body: { type: 'm.login.application_service', username: localpart, inhibit_login: true },
  })
  if (response.status === 200) return
  if (errorCodeSchema.safeParse(response.body).data?.errcode === 'M_USER_IN_USE') return
  logger.error('Matrix request rejected', {
    method: 'POST',
    path: 'register',
    status: response.status,
  })
  throw upstreamUnavailable('Matrix', response.body)
}

/** Logs an appservice user in on `device`; the caller hands the token to that user only. */
export async function loginAppserviceUser(
  localpart: string,
  device: { id: string; name: string }
): Promise<{ accessToken: string; deviceId: string }> {
  // An existing device id is reused (Synapse keeps its earlier tokens valid until the device
  // is deleted).
  const body = await expectOk('POST', '/_matrix/client/v3/login', {
    body: {
      type: 'm.login.application_service',
      identifier: { type: 'm.id.user', user: localpart },
      device_id: device.id,
      initial_device_display_name: device.name,
    },
  })
  const login = loginResponseSchema.parse(body)
  return { accessToken: login.access_token, deviceId: login.device_id }
}

/** Invites `userId` as the bot; a user already in the room is fine. */
export async function inviteToRoom(roomId: string, userId: string): Promise<void> {
  const response = await asRequest('POST', `/_matrix/client/v3/rooms/${enc(roomId)}/invite`, {
    body: { user_id: userId },
  })
  if (response.status === 200) return
  // Synapse answers 403 "is already in the room" to a repeated invite of a member.
  if (response.status === 403) return
  logger.error('Matrix request rejected', {
    method: 'POST',
    path: 'invite',
    status: response.status,
  })
  throw upstreamUnavailable('Matrix', response.body)
}

export async function joinRoomAs(roomId: string, userId: string): Promise<void> {
  await expectOk('POST', `/_matrix/client/v3/join/${enc(roomId)}`, { body: {}, asUser: userId })
}

export async function listDevicesOf(userId: string) {
  const body = await expectOk('GET', '/_matrix/client/v3/devices', { asUser: userId })
  return devicesResponseSchema.parse(body).devices
}

/** Deletes a device (and invalidates its access token); appservices skip interactive auth. */
export async function deleteDeviceOf(userId: string, deviceId: string): Promise<void> {
  await expectOk('DELETE', `/_matrix/client/v3/devices/${enc(deviceId)}`, {
    body: {},
    asUser: userId,
  })
}

const delayedEventsResponseSchema = z.object({
  delayed_events: z.array(
    z.looseObject({
      delay_id: z.string(),
      room_id: z.string(),
      type: z.string(),
      state_key: z.string().optional(),
    })
  ),
})

/** The bot's delayed events the homeserver still holds (MSC4140). */
export async function listDelayedEvents() {
  const body = await expectOk('GET', '/_matrix/client/unstable/org.matrix.msc4140/delayed_events')
  return delayedEventsResponseSchema.parse(body).delayed_events
}

/** Withdraws a member's call membership for one device, acting as that member. */
export async function clearCallMembership(
  roomId: string,
  userId: string,
  stateKey: string
): Promise<void> {
  await expectOk(
    'PUT',
    `/_matrix/client/v3/rooms/${enc(roomId)}/state/${enc('org.matrix.msc3401.call.member')}/${enc(stateKey)}`,
    { body: {}, asUser: userId }
  )
}

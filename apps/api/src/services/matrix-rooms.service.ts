import { createLogger } from '@monibot/logger'
import { env } from '../env'
import { HttpError } from '../lib/http-error'
import {
  callMembershipStateKey,
  callRoomCreation,
  isSessionDevice,
  membersToRemove,
  roomCreatedBy,
} from '../lib/matrix-rtc'
import {
  clearCallMembership,
  createRoom,
  deleteDeviceOf,
  getRoomState,
  isMatrixAppserviceConfigured,
  kickFromRoom,
  leaveRoom,
  listDevicesOf,
} from './matrix-client.service'

const logger = createLogger('MatrixRooms')

const CLOSED_REASON = 'Monitoria encerrada'

/** Creates the Matrix room a tutoring session's call happens in, owned by the bot. */
export async function createCallRoom(name: string): Promise<string> {
  if (!isMatrixAppserviceConfigured()) {
    throw new HttpError(
      503,
      'UPSTREAM_UNAVAILABLE',
      'Matrix is not configured (MATRIX_AS_TOKEN); create the session without a Matrix room'
    )
  }
  const roomId = await createRoom(callRoomCreation({ name, botUserId: env.MATRIX_BOT_USER_ID }))
  logger.info('Call room created', { roomId })
  return roomId
}

/**
 * Closes a session's call room once the session ends: removes the students and pending invites,
 * then the bot leaves. Rooms the bot did not create (a researcher linked an existing call) are
 * left untouched. Best effort: ending a session must not fail because Matrix is down.
 */
export async function closeCallRoom(roomId: string, sessionId: string): Promise<void> {
  if (!isMatrixAppserviceConfigured()) return
  try {
    const state = await getRoomState(roomId)
    if (!roomCreatedBy(state, env.MATRIX_BOT_USER_ID)) return
    const members = membersToRemove(state, env.MATRIX_BOT_USER_ID)
    for (const userId of members) {
      if (isStudentAccount(userId)) await revokeSessionDevices(userId, sessionId, roomId)
      await kickFromRoom(roomId, userId, CLOSED_REASON)
    }
    await leaveRoom(roomId)
    logger.info('Call room closed', { roomId, removed: members.length })
  } catch (error) {
    logger.warn('Could not close the call room of an ended session', { roomId, error })
  }
}

/** Accounts the API created for students (the appservice's `@aluno-…` namespace). */
export function isStudentAccount(userId: string): boolean {
  const server = env.MATRIX_BOT_USER_ID.slice(env.MATRIX_BOT_USER_ID.indexOf(':') + 1)
  return userId.startsWith('@aluno-') && userId.endsWith(`:${server}`)
}

/**
 * Deletes the devices issued to a student for a session, invalidating their access tokens, and
 * withdraws their call memberships: Element Call schedules its own leave an hour ahead, so a
 * revoked device would otherwise linger in the call as an empty tile.
 */
export async function revokeSessionDevices(
  userId: string,
  sessionId: string,
  roomId: string
): Promise<void> {
  const devices = await listDevicesOf(userId)
  for (const device of devices) {
    if (!isSessionDevice(device.display_name, sessionId)) continue
    await deleteDeviceOf(userId, device.device_id)
    await clearCallMembership(roomId, userId, callMembershipStateKey(userId, device.device_id))
  }
}

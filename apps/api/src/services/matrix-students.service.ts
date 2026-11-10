import { createLogger } from '@monibot/logger'
import type { MatrixCallCredentials } from '@monibot/types'
import { env } from '../env'
import { HttpError } from '../lib/http-error'
import {
  roomCreatedBy,
  sessionDeviceId,
  sessionDeviceName,
  studentMatrixLocalpart,
} from '../lib/matrix-rtc'
import { ensureAgentDispatched } from './livekit.service'
import { agentIdentityForSession } from './matrix.service'
import {
  ensureDisplayName,
  getRoomState,
  inviteToRoom,
  isMatrixAppserviceConfigured,
  joinRoomAs,
  loginAppserviceUser,
  registerAppserviceUser,
} from './matrix-client.service'
import { getAgentE2eeKey, getSessionRow, hasAdoptedCallRoom } from './sessions.service'

const logger = createLogger('MatrixStudents')

export interface CallParticipant {
  /** Web (Better Auth) user id. */
  id: string
  name: string
}

/**
 * Gives a signed-in user what their page needs to join the session's call in embedded Element
 * Call: their own Matrix account (created on first use, in the appservice namespace), membership
 * of the call room, and a login on the session's fixed device (`sessionDeviceId`), so every page
 * load joins as the same LiveKit identity. Ending the session deletes the device, revoking every
 * token issued on it. Only call rooms the API created qualify: a linked call has its own link.
 */
export async function issueCallCredentials(
  sessionId: string,
  participant: CallParticipant
): Promise<MatrixCallCredentials> {
  const row = await getSessionRow(sessionId)
  if (row.status === 'ended') throw new HttpError(409, 'CONFLICT', 'Tutoring session has ended')
  if (!row.matrixRoomId) {
    throw new HttpError(409, 'CONFLICT', 'Tutoring session has no Matrix call room')
  }
  if (!isMatrixAppserviceConfigured()) {
    throw new HttpError(503, 'UPSTREAM_UNAVAILABLE', 'Matrix is not configured (MATRIX_AS_TOKEN)')
  }
  const roomId = row.matrixRoomId
  if (!roomCreatedBy(await getRoomState(roomId), env.MATRIX_BOT_USER_ID)) {
    throw new HttpError(409, 'CONFLICT', 'The call room was linked, not created by MoniBot')
  }

  const localpart = studentMatrixLocalpart(participant.id)
  const server = env.MATRIX_BOT_USER_ID.slice(env.MATRIX_BOT_USER_ID.indexOf(':') + 1)
  const userId = `@${localpart}:${server}`
  await registerAppserviceUser(localpart)
  await ensureDisplayName(participant.name, userId)
  await inviteToRoom(roomId, userId)
  await joinRoomAs(roomId, userId)
  const login = await loginAppserviceUser(localpart, {
    id: sessionDeviceId(sessionId),
    name: sessionDeviceName(sessionId),
  })
  const { sharedKey } = await getAgentE2eeKey(sessionId)
  // A rejoin from the same device republishes an identical membership, which Synapse drops: no
  // event, no dispatch. The student is about to join, so make sure the agent will be there.
  if (hasAdoptedCallRoom(row)) {
    await ensureAgentDispatched(row.livekitRoomName, {
      sessionId,
      participantIdentity: agentIdentityForSession(row),
    }).catch((error: unknown) =>
      logger.warn('Could not ensure the agent before the student joins', { sessionId, error })
    )
  }

  return {
    homeserverUrl: env.MATRIX_PUBLIC_URL ?? env.MATRIX_HOMESERVER_URL,
    elementCallUrl: env.ELEMENT_CALL_URL,
    userId,
    deviceId: login.deviceId,
    accessToken: login.accessToken,
    roomId,
    callPassword: sharedKey,
  }
}

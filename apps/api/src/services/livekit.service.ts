import { createLogger } from '@monibot/logger'
import type { AgentDispatchMetadata } from '@monibot/types'
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk'
import { env } from '../env'
import { dispatchSessionId } from '../lib/agent-dispatch'
import { upstreamUnavailable } from '../lib/http-error'

const logger = createLogger('LivekitService')

/** `ParticipantInfo_Kind.AGENT` from @livekit/protocol, which livekit-server-sdk does not re-export. */
const AGENT_PARTICIPANT_KIND = 4
const PARTICIPANT_TOKEN_TTL = '2h'
/** Seconds an agent-only room survives without a human participant. */
const ROOM_EMPTY_TIMEOUT_S = 300

/** LiveKit's server API speaks HTTP on the same host as the `ws(s)://` signalling URL. */
const livekitHttpUrl = env.LIVEKIT_URL.replace(/^ws(s?):\/\//, 'http$1://')

const roomClient = new RoomServiceClient(
  livekitHttpUrl,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET
)

const dispatchClient = new AgentDispatchClient(
  livekitHttpUrl,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET
)

export interface ParticipantTokenInput {
  roomName: string
  identity: string
  name: string
}

export async function createParticipantToken(input: ParticipantTokenInput): Promise<string> {
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: input.identity,
    name: input.name,
    ttl: PARTICIPANT_TOKEN_TTL,
  })
  token.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  })
  return token.toJwt()
}

/**
 * Deletes the MoniBot dispatches in `roomName` that `shouldRetire` selects and, when any existed,
 * disconnects the agent participants, so their jobs end and stop logging to that session.
 */
async function retireAgents(
  roomName: string,
  shouldRetire: (sessionId: string | undefined) => boolean
): Promise<void> {
  const dispatches = (await dispatchClient.listDispatch(roomName)).filter(
    (dispatch) =>
      dispatch.agentName === env.LIVEKIT_AGENT_NAME &&
      shouldRetire(dispatchSessionId(dispatch.metadata))
  )
  if (dispatches.length === 0) return
  for (const dispatch of dispatches) await dispatchClient.deleteDispatch(dispatch.id, roomName)
  const agents = (await roomClient.listParticipants(roomName)).filter(
    (participant) => participant.kind === AGENT_PARTICIPANT_KIND
  )
  for (const agent of agents) await roomClient.removeParticipant(roomName, agent.identity)
  logger.info('Agent retired from room', { roomName, dispatches: dispatches.length })
}

/**
 * Dispatches the MoniBot worker into `roomName` for `metadata.sessionId` unless that session's
 * dispatch already exists, so repeated token requests and Matrix webhooks never add a second
 * agent. Element Call reuses one LiveKit room per Matrix room, so an agent left over from an
 * earlier session is retired first: it would otherwise log this session's turns under that one.
 */
export async function ensureAgentDispatched(
  roomName: string,
  metadata: AgentDispatchMetadata
): Promise<void> {
  try {
    // Dispatch RPCs time out on a room that does not exist yet; createRoom is idempotent.
    await roomClient.createRoom({ name: roomName, emptyTimeout: ROOM_EMPTY_TIMEOUT_S })
    const existing = await dispatchClient.listDispatch(roomName)
    const alreadyDispatched = existing.some(
      (dispatch) =>
        dispatch.agentName === env.LIVEKIT_AGENT_NAME &&
        dispatchSessionId(dispatch.metadata) === metadata.sessionId
    )
    if (alreadyDispatched) return
    await retireAgents(roomName, (sessionId) => sessionId !== metadata.sessionId)
    await dispatchClient.createDispatch(roomName, env.LIVEKIT_AGENT_NAME, {
      metadata: JSON.stringify(metadata),
    })
    logger.info('Agent dispatched', { roomName, sessionId: metadata.sessionId })
  } catch (error) {
    logger.error('Agent dispatch failed', { roomName, error })
    throw upstreamUnavailable('LiveKit', error)
  }
}

/**
 * Removes a session's agent from its room when the session ends. Best effort: ending a session
 * must not fail because LiveKit is down, and `ensureAgentDispatched` retires leftovers anyway.
 */
export async function retireSessionAgent(roomName: string, sessionId: string): Promise<void> {
  try {
    // A closed room has no agent left, and dispatch RPCs on a missing room time out.
    const [room] = await roomClient.listRooms([roomName])
    if (!room) return
    await retireAgents(roomName, (dispatchSession) => dispatchSession === sessionId)
  } catch (error) {
    logger.warn('Could not retire the agent of an ended session', { roomName, sessionId, error })
  }
}

/**
 * Name of the LiveKit room where a participant with `identity` is connected, if any. Element Call
 * participants join rooms named by lk-jwt-service, so this is how the agent finds their room.
 */
export async function findRoomWithParticipant(identity: string): Promise<string | undefined> {
  try {
    for (const room of await roomClient.listRooms()) {
      const participants = await roomClient.listParticipants(room.name)
      if (participants.some((participant) => participant.identity === identity)) return room.name
    }
    return undefined
  } catch (error) {
    logger.error('LiveKit room lookup failed', { error })
    throw upstreamUnavailable('LiveKit', error)
  }
}

/** URL handed to browsers with their participant token. */
export const livekitServerUrl = env.LIVEKIT_PUBLIC_URL ?? env.LIVEKIT_URL

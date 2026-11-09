import { createLogger } from '@monibot/logger'
import type { AgentDispatchMetadata } from '@monibot/types'
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk'
import { env } from '../env'
import { upstreamUnavailable } from '../lib/http-error'

const logger = createLogger('LivekitService')

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
 * Dispatches the MoniBot worker into `roomName` unless a dispatch for it already exists, so
 * repeated token requests and Matrix webhooks never add a second agent.
 */
export async function ensureAgentDispatched(
  roomName: string,
  metadata: AgentDispatchMetadata
): Promise<void> {
  try {
    // Dispatch RPCs time out on a room that does not exist yet; createRoom is idempotent.
    await roomClient.createRoom({ name: roomName, emptyTimeout: ROOM_EMPTY_TIMEOUT_S })
    const existing = await dispatchClient.listDispatch(roomName)
    if (existing.some((dispatch) => dispatch.agentName === env.LIVEKIT_AGENT_NAME)) return
    await dispatchClient.createDispatch(roomName, env.LIVEKIT_AGENT_NAME, {
      metadata: JSON.stringify(metadata),
    })
    logger.info('Agent dispatched', { roomName, sessionId: metadata.sessionId })
  } catch (error) {
    logger.error('Agent dispatch failed', { roomName, error })
    throw upstreamUnavailable('LiveKit', error)
  }
}

/** URL handed to browsers with their participant token. */
export const livekitServerUrl = env.LIVEKIT_PUBLIC_URL ?? env.LIVEKIT_URL

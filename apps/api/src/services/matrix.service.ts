import { getDb, type TutoringSessionRow, tutoringSessions } from '@monibot/db'
import { createLogger } from '@monibot/logger'
import {
  AGENT_DISPLAY_NAME,
  AGENT_PRESENCE_HEARTBEAT_MS,
  type AgentPresenceResult,
  type AgentPresenceState,
  livekitFocusSchema,
  type MatrixCallMemberEvent,
  type MatrixWebhookResult,
} from '@monibot/types'
import { eq } from 'drizzle-orm'
import { env } from '../env'
import {
  AGENT_CALL_MEMBER_EVENT_TYPE,
  agentLivekitIdentity,
  agentMembership,
  agentMembershipStateKey,
  callFocusFromRoomState,
  isReplayedMembership,
  livekitIdentityOf,
  pendingMembershipLeaves,
  pollUntil,
} from '../lib/matrix-rtc'
import { ensureAgentDispatched, findRoomWithParticipant } from './livekit.service'
import {
  ensureDisplayName,
  getRoomState,
  isMatrixAppserviceConfigured,
  joinRoom,
  listDelayedEvents,
  putDelayedState,
  putState,
  updateDelayedEvent,
} from './matrix-client.service'
import { findSessionsByMatrixRoom, getSessionRow, markSessionActive } from './sessions.service'

const logger = createLogger('MatrixService')

/**
 * The homeserver withdraws the agent's membership by itself if the worker stops sending
 * heartbeats (crash, lost network) for this long, so the agent never lingers as a ghost.
 */
const DELAYED_LEAVE_MS = 3 * AGENT_PRESENCE_HEARTBEAT_MS

/** Pending delayed leave per session. Lost on restart; the next heartbeat re-publishes. */
const delayedLeaves = new Map<string, string>()

/**
 * Element Call publishes the membership and connects to LiveKit almost at once, so the member may
 * not be in their room yet when the homeserver delivers the event.
 */
const PARTICIPANT_ROOM_TIMEOUT_MS = 5000
const PARTICIPANT_ROOM_POLL_MS = 250

/**
 * MSC4143: a membership whose content advertises a LiveKit focus (MSC4195) means the sender
 * joined the call; empty content means they left.
 */
function readMembership(event: MatrixCallMemberEvent) {
  const { content } = event
  const livekitFocus = (content.foci_preferred ?? [])
    .map((focus) => livekitFocusSchema.safeParse(focus))
    .find((result) => result.success)?.data
  const joined = livekitFocus !== undefined || content.focus_active?.type === 'livekit'
  return { joined, livekitAlias: livekitFocus?.livekit_alias }
}

type CallRoom =
  | { kind: 'found'; roomName: string }
  | { kind: 'unknown' }
  | { kind: 'not_connected' }

/**
 * LiveKit room the member's call runs in: the focus alias when the client sends one (older
 * Element Call), else the room where the member's participant is connected (lk-jwt-service names
 * it itself). A replayed membership gets a single lookup: its member has long since connected, or
 * has left.
 */
async function resolveCallRoom(
  event: MatrixCallMemberEvent,
  livekitAlias: string | undefined
): Promise<CallRoom> {
  if (livekitAlias) return { kind: 'found', roomName: livekitAlias }
  const identity = livekitIdentityOf(event)
  if (!identity) return { kind: 'unknown' }
  const replayed = isReplayedMembership(event.origin_server_ts, Date.now())
  const roomName = await pollUntil(() => findRoomWithParticipant(identity), {
    timeoutMs: replayed ? 0 : PARTICIPANT_ROOM_TIMEOUT_MS,
    intervalMs: PARTICIPANT_ROOM_POLL_MS,
  })
  if (roomName) return { kind: 'found', roomName }
  logger.warn('Call member not connected to any LiveKit room', { roomId: event.room_id, replayed })
  return { kind: 'not_connected' }
}

/**
 * LiveKit identity the agent must join a session with. A Matrix-linked session always gets the
 * identity its MatrixRTC membership announces, whichever path dispatched the agent (Element Call
 * or the web app's token): with any other identity Element Call would hide it. Undefined lets the
 * SDK pick one.
 */
export function agentIdentityForSession(session: TutoringSessionRow): string | undefined {
  if (!session.matrixRoomId || !isMatrixAppserviceConfigured()) return undefined
  return agentLivekitIdentity(env.MATRIX_BOT_USER_ID)
}

/**
 * Reacts to a MatrixRTC call membership by dispatching MoniBot into the LiveKit room of the
 * newest non-ended tutoring session linked to that Matrix room.
 */
export async function handleCallMemberEvent(
  event: MatrixCallMemberEvent
): Promise<MatrixWebhookResult> {
  // The agent's own membership comes back through the appservice; it is not a student joining.
  if (event.sender === env.MATRIX_BOT_USER_ID) {
    return { action: 'ignored', sessionId: null, reason: 'Own MatrixRTC membership' }
  }
  const { joined, livekitAlias } = readMembership(event)
  const sessions = await findSessionsByMatrixRoom(event.room_id)
  const session = sessions.find((row) => row.status !== 'ended')

  if (!session) {
    return { action: 'ignored', sessionId: null, reason: 'No open tutoring session for this room' }
  }
  if (!joined) return { action: 'member_left', sessionId: session.id }

  // The agent must join the participants' room, not the one minted at session creation. A member
  // without a LiveKit identity (older clients) falls back to the session's own room; one with an
  // identity but no connection has left, so dispatching would only open an empty room.
  const callRoom = await resolveCallRoom(event, livekitAlias)
  if (callRoom.kind === 'not_connected') {
    return {
      action: 'ignored',
      sessionId: session.id,
      reason: 'Call member is not connected to LiveKit',
    }
  }
  let target = session
  if (callRoom.kind === 'found' && callRoom.roomName !== session.livekitRoomName) {
    const [updated] = await getDb()
      .update(tutoringSessions)
      .set({ livekitRoomName: callRoom.roomName })
      .where(eq(tutoringSessions.id, session.id))
      .returning()
    target = updated ?? session
  }

  const active = await markSessionActive(target)
  await ensureAgentDispatched(active.livekitRoomName, {
    sessionId: active.id,
    participantIdentity: agentIdentityForSession(active),
  })
  logger.info('Agent dispatched from MatrixRTC membership', {
    sessionId: active.id,
    roomName: active.livekitRoomName,
  })
  return { action: 'dispatched', sessionId: active.id }
}

/**
 * Announces the agent as a MatrixRTC call member. The delayed leave is scheduled first (as
 * Element Call does), so a crash between the two steps can never leave a ghost membership.
 */
async function publishAgentMembership(
  sessionId: string,
  roomId: string
): Promise<AgentPresenceResult> {
  // A session linked to a room the homeserver cannot join (mistyped or foreign room ID) keeps
  // working as a plain LiveKit session; Element Call simply cannot show the agent.
  if (!(await joinRoom(roomId))) return { matrixMembership: 'not_applicable' }
  await ensureDisplayName(AGENT_DISPLAY_NAME)
  const focus = callFocusFromRoomState(await getRoomState(roomId), env.MATRIX_BOT_USER_ID)
  if (!focus) {
    logger.warn('No call member advertises a LiveKit focus; agent membership not published', {
      sessionId,
    })
    return { matrixMembership: 'not_applicable' }
  }
  const { stateKey, content } = agentMembership({
    userId: env.MATRIX_BOT_USER_ID,
    focus,
    createdTs: Date.now(),
  })
  // Cancel every pending leave of this membership, including those scheduled before an API
  // restart (lost from `delayedLeaves`), or one would fire later and hide the agent.
  delayedLeaves.delete(sessionId)
  for (const delayId of pendingMembershipLeaves(await listDelayedEvents(), roomId, stateKey)) {
    await updateDelayedEvent(delayId, 'cancel')
  }
  const delayId = await putDelayedState(
    roomId,
    AGENT_CALL_MEMBER_EVENT_TYPE,
    stateKey,
    {},
    DELAYED_LEAVE_MS
  )
  delayedLeaves.set(sessionId, delayId)
  await putState(roomId, AGENT_CALL_MEMBER_EVENT_TYPE, stateKey, content)
  logger.info('Agent MatrixRTC membership published', { sessionId })
  return { matrixMembership: 'published' }
}

async function withdrawAgentMembership(
  sessionId: string,
  roomId: string
): Promise<AgentPresenceResult> {
  const delayId = delayedLeaves.get(sessionId)
  delayedLeaves.delete(sessionId)
  if (delayId) await updateDelayedEvent(delayId, 'cancel')
  const stateKey = agentMembershipStateKey(env.MATRIX_BOT_USER_ID)
  await putState(roomId, AGENT_CALL_MEMBER_EVENT_TYPE, stateKey, {})
  logger.info('Agent MatrixRTC membership withdrawn', { sessionId })
  return { matrixMembership: 'removed' }
}

/**
 * Mirrors the worker's presence in a Matrix-linked session as the agent's MatrixRTC membership,
 * which is what makes Element Call show the agent. No-op for sessions without a Matrix room or
 * when the appservice token is not configured.
 */
export async function updateAgentPresence(
  sessionId: string,
  state: AgentPresenceState
): Promise<AgentPresenceResult> {
  const session = await getSessionRow(sessionId)
  if (!session.matrixRoomId || !isMatrixAppserviceConfigured()) {
    return { matrixMembership: 'not_applicable' }
  }
  const roomId = session.matrixRoomId
  if (state === 'left') return withdrawAgentMembership(sessionId, roomId)
  if (state === 'heartbeat') {
    const delayId = delayedLeaves.get(sessionId)
    if (delayId && (await updateDelayedEvent(delayId, 'restart'))) {
      return { matrixMembership: 'refreshed' }
    }
    // The delayed leave already fired or was lost (API restart): announce the agent again.
  }
  return publishAgentMembership(sessionId, roomId)
}

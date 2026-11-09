import { getDb, tutoringSessions } from '@monibot/db'
import { createLogger } from '@monibot/logger'
import {
  livekitFocusSchema,
  type MatrixCallMemberEvent,
  type MatrixWebhookResult,
} from '@monibot/types'
import { eq } from 'drizzle-orm'
import { ensureAgentDispatched } from './livekit.service'
import { findSessionsByMatrixRoom, markSessionActive } from './sessions.service'

const logger = createLogger('MatrixService')

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

/**
 * Reacts to a MatrixRTC call membership by dispatching MoniBot into the LiveKit room of the
 * newest non-ended tutoring session linked to that Matrix room.
 */
export async function handleCallMemberEvent(
  event: MatrixCallMemberEvent
): Promise<MatrixWebhookResult> {
  const { joined, livekitAlias } = readMembership(event)
  const sessions = await findSessionsByMatrixRoom(event.room_id)
  const session = sessions.find((row) => row.status !== 'ended')

  if (!session) {
    return { action: 'ignored', sessionId: null, reason: 'No open tutoring session for this room' }
  }
  if (!joined) return { action: 'member_left', sessionId: session.id }

  let target = session
  // lk-jwt-service places Element Call participants in the room named by the focus alias, so
  // the agent must join that room rather than the one minted at session creation.
  if (livekitAlias && livekitAlias !== session.livekitRoomName) {
    const [updated] = await getDb()
      .update(tutoringSessions)
      .set({ livekitRoomName: livekitAlias })
      .where(eq(tutoringSessions.id, session.id))
      .returning()
    target = updated ?? session
  }

  const active = await markSessionActive(target)
  await ensureAgentDispatched(active.livekitRoomName, { sessionId: active.id })
  logger.info('Agent dispatched from MatrixRTC membership', {
    sessionId: active.id,
    roomName: active.livekitRoomName,
  })
  return { action: 'dispatched', sessionId: active.id }
}

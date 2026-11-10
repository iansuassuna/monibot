import { createHash } from 'node:crypto'
import {
  AGENT_MATRIX_DEVICE_ID,
  type LivekitFocus,
  livekitFocusSchema,
  type MatrixCallMemberEvent,
  type MatrixStateEvent,
} from '@monibot/types'

const CALL_MEMBER_EVENT_TYPES = new Set(['m.call.member', 'org.matrix.msc3401.call.member'])
/** Element Call's own membership lifetime; members renew or drop well before it lapses. */
const MEMBERSHIP_EXPIRES_MS = 4 * 60 * 60 * 1000

export const AGENT_CALL_MEMBER_EVENT_TYPE = 'org.matrix.msc3401.call.member'

/** LiveKit identity of the agent in a Matrix call; it is also its MatrixRTC `membershipID`. */
export function agentLivekitIdentity(botUserId: string): string {
  return `${botUserId}:${AGENT_MATRIX_DEVICE_ID}`
}

/** State key of the agent's membership, in the format Element Call uses for its own members. */
export function agentMembershipStateKey(botUserId: string): string {
  return callMembershipStateKey(botUserId, AGENT_MATRIX_DEVICE_ID)
}

/** State key of a device's MatrixRTC membership, as Element Call writes it (`_@user_DEVICE_m.call`). */
export function callMembershipStateKey(userId: string, deviceId: string): string {
  return `_${userId}_${deviceId}_m.call`
}

export interface AgentMembershipInput {
  userId: string
  focus: LivekitFocus
  createdTs: number
}

/**
 * MatrixRTC membership (MSC4143) announcing the agent in the call, shaped like the ones Element
 * Call publishes for its users so it renders the agent's LiveKit participant as a member.
 */
export function agentMembership({ userId, focus, createdTs }: AgentMembershipInput) {
  return {
    stateKey: agentMembershipStateKey(userId),
    content: {
      application: 'm.call',
      call_id: '',
      scope: 'm.room',
      device_id: AGENT_MATRIX_DEVICE_ID,
      membershipID: agentLivekitIdentity(userId),
      expires: MEMBERSHIP_EXPIRES_MS,
      created_ts: createdTs,
      foci_preferred: [focus],
      focus_active: { type: 'livekit', focus_selection: 'multi_sfu' },
      'm.call.intent': 'audio',
    },
  }
}

/**
 * LiveKit focus advertised by a current call member other than the bot, so the agent's membership
 * points at the same SFU transport the members use.
 */
export function callFocusFromRoomState(
  state: MatrixStateEvent[],
  botUserId: string
): LivekitFocus | undefined {
  for (const event of state) {
    if (!CALL_MEMBER_EVENT_TYPES.has(event.type) || event.sender === botUserId) continue
    const foci = event.content.foci_preferred
    if (!Array.isArray(foci)) continue
    for (const focus of foci) {
      const parsed = livekitFocusSchema.safeParse(focus)
      if (parsed.success) return parsed.data
    }
  }
  return undefined
}

/**
 * LiveKit participant identity a MatrixRTC member connects with: Element Call publishes it as
 * `membershipID`; older memberships imply `<user id>:<device id>`. Null when neither is present.
 */
export function livekitIdentityOf(event: MatrixCallMemberEvent): string | null {
  const { membershipID, device_id: deviceId } = event.content
  if (membershipID) return membershipID
  if (deviceId) return `${event.sender}:${deviceId}`
  return null
}

/**
 * Oldest a membership may be on arrival and still describe a join happening now. Synapse delivers
 * within a second; older events are retries of a transaction it could not deliver earlier.
 */
export const LIVE_MEMBERSHIP_MAX_AGE_MS = 30_000

/** Whether a membership sent at `originServerTs` reaches the API as a delayed retry. */
export function isReplayedMembership(originServerTs: number, now: number): boolean {
  return now - originServerTs > LIVE_MEMBERSHIP_MAX_AGE_MS
}

export interface PollOptions {
  timeoutMs: number
  intervalMs: number
}

/**
 * Calls `probe` until it returns a value or `timeoutMs` elapses (then `undefined`). Errors from
 * `probe` propagate, so an unreachable upstream is never reported as "not found".
 */
export async function pollUntil<T>(
  probe: () => Promise<T | undefined>,
  { timeoutMs, intervalMs }: PollOptions
): Promise<T | undefined> {
  const deadline = performance.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    const remaining = deadline - performance.now()
    if (remaining <= 0) return undefined
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)))
  }
}

const CALL_MEMBER_EVENT_TYPE_LEGACY = 'm.call.member'

export interface CallRoomCreationInput {
  name: string
  botUserId: string
}

/**
 * `POST /createRoom` body for a tutoring session's call room: invite-only, members may publish
 * their MatrixRTC membership (state events default to power 50 otherwise), and students see
 * nothing from before they joined.
 */
export function callRoomCreation({ name, botUserId }: CallRoomCreationInput) {
  return {
    name,
    preset: 'private_chat',
    // Room v12 rejects the creator in power_levels.users (see docker/synapse/homeserver.yaml).
    room_version: '11',
    power_level_content_override: {
      users: { [botUserId]: 100 },
      events: { [AGENT_CALL_MEMBER_EVENT_TYPE]: 0, [CALL_MEMBER_EVENT_TYPE_LEGACY]: 0 },
    },
    initial_state: [
      { type: 'm.room.join_rules', state_key: '', content: { join_rule: 'invite' } },
      { type: 'm.room.guest_access', state_key: '', content: { guest_access: 'forbidden' } },
      {
        type: 'm.room.history_visibility',
        state_key: '',
        content: { history_visibility: 'joined' },
      },
    ],
  }
}

/** Whether `userId` created the room, i.e. the room is one the API owns and may close. */
export function roomCreatedBy(state: MatrixStateEvent[], userId: string): boolean {
  return state.some((event) => event.type === 'm.room.create' && event.sender === userId)
}

/** Users to remove when a session's room closes: members and pending invites, never the bot. */
export function membersToRemove(state: MatrixStateEvent[], botUserId: string): string[] {
  return state
    .filter(
      (event) =>
        event.type === 'm.room.member' &&
        event.state_key !== botUserId &&
        (event.content.membership === 'join' || event.content.membership === 'invite')
    )
    .map((event) => event.state_key)
}

/**
 * Matrix localpart of a web user's account (`@aluno-…`, the appservice's exclusive namespace).
 * A hash, not the id itself: stable across sessions, lowercase-safe, and it does not expose the
 * web user id to other room members.
 */
export function studentMatrixLocalpart(webUserId: string): string {
  return `aluno-${createHash('sha256').update(webUserId).digest('hex').slice(0, 20)}`
}

const SESSION_DEVICE_PREFIX = 'MoniBot · '

/** Display name of the device a student's call credentials are issued on, one per session. */
export function sessionDeviceName(sessionId: string): string {
  return `${SESSION_DEVICE_PREFIX}${sessionId}`
}

/**
 * Device a student joins a session's call from. Fixed per session: the LiveKit identity is
 * `<user>:<device>`, and the agent's voice session stays linked to the identity it first heard,
 * so a new device on every page load would leave MoniBot in the call but deaf to the student.
 */
export function sessionDeviceId(sessionId: string): string {
  return `MB${createHash('sha256').update(sessionId).digest('hex').slice(0, 10).toUpperCase()}`
}

/** Whether a device was issued for this session, so ending it may revoke the device. */
export function isSessionDevice(displayName: string | undefined, sessionId: string): boolean {
  return displayName === sessionDeviceName(sessionId)
}

export interface DelayedEventSummary {
  delay_id: string
  room_id: string
  type: string
  state_key?: string
}

/**
 * Scheduled leaves for one call membership. The API forgets its delay ids when it restarts, but
 * the homeserver still holds them; an old one firing after a re-publish would remove the agent.
 */
export function pendingMembershipLeaves(
  delayed: DelayedEventSummary[],
  roomId: string,
  stateKey: string
): string[] {
  return delayed
    .filter(
      (event) =>
        event.room_id === roomId &&
        event.type === AGENT_CALL_MEMBER_EVENT_TYPE &&
        event.state_key === stateKey
    )
    .map((event) => event.delay_id)
}

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
  return `_${botUserId}_${AGENT_MATRIX_DEVICE_ID}_m.call`
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

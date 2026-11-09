import { describe, expect, test } from 'bun:test'
import type { LivekitFocus, MatrixCallMemberEvent } from '@monibot/types'
import {
  agentLivekitIdentity,
  agentMembership,
  callFocusFromRoomState,
  isReplayedMembership,
  LIVE_MEMBERSHIP_MAX_AGE_MS,
  livekitIdentityOf,
  pollUntil,
} from './matrix-rtc'

const event = (
  content: MatrixCallMemberEvent['content'],
  sender = '@aluno:localhost'
): MatrixCallMemberEvent => ({
  type: 'org.matrix.msc3401.call.member',
  room_id: '!room:localhost',
  sender,
  state_key: `_${sender}_DEVICE_m.call`,
  origin_server_ts: 0,
  content,
})

describe('livekitIdentityOf', () => {
  test('uses the membershipID Element Call publishes (multi_sfu), even if it differs from sender:device', () => {
    const identity = livekitIdentityOf(
      event({ device_id: 'DEVICE', membershipID: '@aluno:localhost:OTHER' })
    )
    expect(identity).toBe('@aluno:localhost:OTHER')
  })

  test('falls back to sender:device_id for memberships without membershipID', () => {
    expect(livekitIdentityOf(event({ device_id: 'ABCDEF' }))).toBe('@aluno:localhost:ABCDEF')
  })

  test('treats an empty membershipID as absent', () => {
    expect(livekitIdentityOf(event({ device_id: 'ABCDEF', membershipID: '' }))).toBe(
      '@aluno:localhost:ABCDEF'
    )
  })

  test('returns null when no identity can be derived, instead of guessing', () => {
    expect(livekitIdentityOf(event({ application: 'm.call' }))).toBeNull()
  })

  test('returns null for a leave (empty content)', () => {
    expect(livekitIdentityOf(event({}))).toBeNull()
  })
})

describe('pollUntil', () => {
  test('returns immediately when the first probe finds a value', async () => {
    const start = performance.now()
    const value = await pollUntil(async () => 'room-a', { timeoutMs: 1000, intervalMs: 200 })
    expect(value).toBe('room-a')
    expect(performance.now() - start).toBeLessThan(100)
  })

  test('keeps probing until a later attempt finds the value', async () => {
    let attempts = 0
    const value = await pollUntil(
      async () => {
        attempts++
        return attempts >= 3 ? 'room-b' : undefined
      },
      { timeoutMs: 1000, intervalMs: 10 }
    )
    expect(value).toBe('room-b')
    expect(attempts).toBe(3)
  })

  test('gives up after the timeout and returns undefined without overshooting much', async () => {
    const start = performance.now()
    const value = await pollUntil(async () => undefined, { timeoutMs: 120, intervalMs: 25 })
    const elapsed = performance.now() - start
    expect(value).toBeUndefined()
    expect(elapsed).toBeGreaterThanOrEqual(100)
    expect(elapsed).toBeLessThan(300)
  })

  test('propagates probe failures so an unreachable upstream is not mistaken for "not found"', async () => {
    await expect(
      pollUntil(
        async () => {
          throw new Error('LiveKit down')
        },
        { timeoutMs: 1000, intervalMs: 10 }
      )
    ).rejects.toThrow('LiveKit down')
  })
})

const BOT = '@monibot:localhost'
const FOCUS: LivekitFocus = { type: 'livekit', livekit_service_url: 'http://127.0.0.1:8080' }

describe('agentMembership', () => {
  test('membershipID is exactly the LiveKit identity, or Element Call hides the agent tile', () => {
    const { content } = agentMembership({ userId: BOT, focus: FOCUS, createdTs: 1 })
    expect(content.membershipID).toBe(agentLivekitIdentity(BOT))
    expect(agentLivekitIdentity(BOT)).toBe('@monibot:localhost:MONIBOT')
  })

  test('uses the state key format Element Call uses for its own members', () => {
    expect(agentMembership({ userId: BOT, focus: FOCUS, createdTs: 1 }).stateKey).toBe(
      '_@monibot:localhost_MONIBOT_m.call'
    )
  })

  test('advertises the members’ focus verbatim and joins the multi-SFU call as audio', () => {
    const { content } = agentMembership({ userId: BOT, focus: FOCUS, createdTs: 42 })
    expect(content.foci_preferred).toEqual([FOCUS])
    expect(content.focus_active).toEqual({ type: 'livekit', focus_selection: 'multi_sfu' })
    expect(content['m.call.intent']).toBe('audio')
    expect(content.created_ts).toBe(42)
  })
})

describe('callFocusFromRoomState', () => {
  const member = (sender: string, content: Record<string, unknown>) => ({
    type: 'org.matrix.msc3401.call.member',
    sender,
    state_key: `_${sender}_D_m.call`,
    content,
  })

  test('copies the LiveKit focus a current call member advertises', () => {
    const state = [
      { type: 'm.room.name', sender: '@aluno:localhost', state_key: '', content: { name: 'x' } },
      member('@aluno:localhost', { foci_preferred: [FOCUS] }),
    ]
    expect(callFocusFromRoomState(state, BOT)).toEqual(FOCUS)
  })

  test('ignores the bot’s own membership and members who left (empty content)', () => {
    const state = [
      member(BOT, { foci_preferred: [{ ...FOCUS, livekit_service_url: 'http://bot' }] }),
      member('@saiu:localhost', {}),
    ]
    expect(callFocusFromRoomState(state, BOT)).toBeUndefined()
  })

  test('skips non-LiveKit foci', () => {
    const state = [member('@aluno:localhost', { foci_preferred: [{ type: 'full_mesh' }, FOCUS] })]
    expect(callFocusFromRoomState(state, BOT)).toEqual(FOCUS)
  })
})

describe('isReplayedMembership', () => {
  const sentAt = 1_700_000_000_000

  test('a membership delivered right away is live', () => {
    expect(isReplayedMembership(sentAt, sentAt + 800)).toBe(false)
  })

  test('a membership the homeserver retried after an API outage is a replay', () => {
    expect(isReplayedMembership(sentAt, sentAt + 8 * 60 * 1000)).toBe(true)
  })

  test('the boundary age still counts as live', () => {
    expect(isReplayedMembership(sentAt, sentAt + LIVE_MEMBERSHIP_MAX_AGE_MS)).toBe(false)
  })

  test('a homeserver clock slightly ahead of the API is not a replay', () => {
    expect(isReplayedMembership(sentAt, sentAt - 2000)).toBe(false)
  })
})

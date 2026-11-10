import { describe, expect, test } from 'bun:test'
import type { LivekitFocus, MatrixCallMemberEvent } from '@monibot/types'
import {
  agentLivekitIdentity,
  agentMembership,
  agentMembershipStateKey,
  callFocusFromRoomState,
  callMembershipStateKey,
  callRoomCreation,
  isReplayedMembership,
  isSessionDevice,
  LIVE_MEMBERSHIP_MAX_AGE_MS,
  livekitIdentityOf,
  membersToRemove,
  pendingMembershipLeaves,
  pollUntil,
  roomCreatedBy,
  sessionDeviceId,
  sessionDeviceName,
  studentMatrixLocalpart,
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

describe('callRoomCreation', () => {
  const request = callRoomCreation({ name: 'Monitoria — Laços', botUserId: BOT })
  const initialState = (type: string) =>
    request.initial_state.find((event) => event.type === type)?.content

  test('lets every member publish a call membership (Element Call needs it to join)', () => {
    const events = request.power_level_content_override.events
    expect(events['org.matrix.msc3401.call.member']).toBe(0)
    expect(events['m.call.member']).toBe(0)
  })

  test('keeps the room closed to anyone the API did not invite', () => {
    expect(request.preset).toBe('private_chat')
    expect(initialState('m.room.join_rules')).toEqual({ join_rule: 'invite' })
    expect(initialState('m.room.guest_access')).toEqual({ guest_access: 'forbidden' })
  })

  test('shows a student nothing from before they joined', () => {
    expect(initialState('m.room.history_visibility')).toEqual({ history_visibility: 'joined' })
  })

  test('pins room version 11, whose power levels Element Call accepts', () => {
    expect(request.room_version).toBe('11')
  })

  test('keeps the bot as the only administrator', () => {
    expect(request.power_level_content_override.users).toEqual({ [BOT]: 100 })
  })
})

describe('roomCreatedBy', () => {
  const create = (sender: string) => ({
    type: 'm.room.create',
    sender,
    state_key: '',
    content: { room_version: '11' },
  })

  test('recognizes a room the bot created', () => {
    expect(roomCreatedBy([create(BOT)], BOT)).toBe(true)
  })

  test('never claims a call room a researcher linked from elsewhere', () => {
    expect(roomCreatedBy([create('@pesquisadora:localhost')], BOT)).toBe(false)
  })

  test('is false when the create event is missing from the state', () => {
    expect(roomCreatedBy([], BOT)).toBe(false)
  })
})

describe('membersToRemove', () => {
  const membership = (userId: string, value: string) => ({
    type: 'm.room.member',
    sender: userId,
    state_key: userId,
    content: { membership: value },
  })

  test('removes joined members and rescinds pending invites, never the bot itself', () => {
    const state = [
      membership(BOT, 'join'),
      membership('@aluno-a:localhost', 'join'),
      membership('@aluno-b:localhost', 'invite'),
      membership('@aluno-c:localhost', 'leave'),
      membership('@aluno-d:localhost', 'ban'),
    ]
    expect(membersToRemove(state, BOT)).toEqual(['@aluno-a:localhost', '@aluno-b:localhost'])
  })
})

describe('studentMatrixLocalpart', () => {
  const NAMESPACE = /^aluno-[a-z0-9-]+$/

  test('stays inside the appservice namespace whatever the web user id looks like', () => {
    for (const id of ['AbC123xyz', 'u_9f8E-7d6C', 'ÇÃO dados']) {
      expect(studentMatrixLocalpart(id)).toMatch(NAMESPACE)
    }
  })

  test('is stable, so a student keeps the same Matrix account across sessions', () => {
    expect(studentMatrixLocalpart('AbC123xyz')).toBe(studentMatrixLocalpart('AbC123xyz'))
  })

  test('tells apart ids that differ only in letter case', () => {
    expect(studentMatrixLocalpart('abc')).not.toBe(studentMatrixLocalpart('ABC'))
  })

  test('does not reveal the web user id', () => {
    expect(studentMatrixLocalpart('AbC123xyz').toLowerCase()).not.toContain('abc123xyz')
  })
})

describe('session devices', () => {
  const SESSION = 'c87563d8-0f38-461c-bc66-25335a0dc781'
  const OTHER = '0ebf6030-9571-492d-95de-74482e78087c'

  test('a device issued for a session is recognized for that session only', () => {
    const name = sessionDeviceName(SESSION)
    expect(isSessionDevice(name, SESSION)).toBe(true)
    expect(isSessionDevice(name, OTHER)).toBe(false)
  })

  test('devices without a name or from other clients are never revoked', () => {
    expect(isSessionDevice(undefined, SESSION)).toBe(false)
    expect(isSessionDevice('Element Web (Firefox)', SESSION)).toBe(false)
  })
})

describe('pendingMembershipLeaves', () => {
  const ROOM = '!room:localhost'
  const KEY = agentMembershipStateKey(BOT)
  const delayed = (id: string, roomId: string, type: string, stateKey: string) => ({
    delay_id: id,
    room_id: roomId,
    type,
    state_key: stateKey,
  })

  test('finds the agent leaves scheduled before an API restart (lost from memory, still pending)', () => {
    const pending = [
      delayed('a', ROOM, 'org.matrix.msc3401.call.member', KEY),
      delayed('b', ROOM, 'org.matrix.msc3401.call.member', KEY),
    ]
    expect(pendingMembershipLeaves(pending, ROOM, KEY)).toEqual(['a', 'b'])
  })

  test('leaves other rooms, other members and other event types alone', () => {
    const pending = [
      delayed('other-room', '!outra:localhost', 'org.matrix.msc3401.call.member', KEY),
      delayed('other-key', ROOM, 'org.matrix.msc3401.call.member', '_@aluno:localhost_X_m.call'),
      delayed('other-type', ROOM, 'm.room.message', ''),
    ]
    expect(pendingMembershipLeaves(pending, ROOM, KEY)).toEqual([])
  })
})

describe('callMembershipStateKey', () => {
  test('matches the key Element Call writes, so clearing it removes that device from the call', () => {
    expect(callMembershipStateKey('@aluno-abc:localhost', 'DEVICEID')).toBe(
      '_@aluno-abc:localhost_DEVICEID_m.call'
    )
  })
})

describe('sessionDeviceId', () => {
  const SESSION = 'c87563d8-0f38-461c-bc66-25335a0dc781'

  test('is the same for every page load, so the student keeps one LiveKit identity the agent stays linked to', () => {
    expect(sessionDeviceId(SESSION)).toBe(sessionDeviceId(SESSION))
  })

  test('differs between sessions', () => {
    expect(sessionDeviceId(SESSION)).not.toBe(
      sessionDeviceId('0ebf6030-9571-492d-95de-74482e78087c')
    )
  })

  test('looks like a Matrix device id (uppercase letters and digits)', () => {
    expect(sessionDeviceId(SESSION)).toMatch(/^[A-Z0-9]{12}$/)
  })
})

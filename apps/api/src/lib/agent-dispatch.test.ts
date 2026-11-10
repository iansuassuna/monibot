import { describe, expect, test } from 'bun:test'
import {
  DISPATCH_JOIN_GRACE_MS,
  dispatchSessionId,
  isOrphanedDispatch,
  MAX_DISPATCH_ATTEMPTS,
  nextArrivalCheck,
} from './agent-dispatch'

const SESSION_ID = 'c87563d8-0f38-461c-bc66-25335a0dc781'

describe('dispatchSessionId', () => {
  test('reads the session id the API attached to the dispatch', () => {
    expect(dispatchSessionId(JSON.stringify({ sessionId: SESSION_ID }))).toBe(SESSION_ID)
  })

  test('returns undefined for dispatches without metadata (created by other tools)', () => {
    expect(dispatchSessionId('')).toBeUndefined()
  })

  test('returns undefined for malformed JSON instead of throwing', () => {
    expect(dispatchSessionId('{"sessionId":')).toBeUndefined()
  })

  test('returns undefined when the metadata does not carry a valid session id', () => {
    expect(dispatchSessionId(JSON.stringify({ sessionId: 'not-a-uuid' }))).toBeUndefined()
    expect(dispatchSessionId(JSON.stringify({ other: SESSION_ID }))).toBeUndefined()
  })
})

describe('isOrphanedDispatch', () => {
  const nowMs = 1_794_264_339_632
  const createdNsAgo = (ms: number) => BigInt(nowMs - ms) * 1_000_000n

  test('a dispatch whose agent is in the room is alive', () => {
    expect(
      isOrphanedDispatch({ createdAtNs: createdNsAgo(60_000), agentInRoom: true, nowMs })
    ).toBe(false)
  })

  test('a fresh dispatch is alive while its agent is still connecting', () => {
    expect(
      isOrphanedDispatch({ createdAtNs: createdNsAgo(2_000), agentInRoom: false, nowMs })
    ).toBe(false)
  })

  test('a dispatch left behind by a restarted worker is orphaned (LiveKit still says RUNNING)', () => {
    expect(
      isOrphanedDispatch({ createdAtNs: createdNsAgo(9 * 60_000), agentInRoom: false, nowMs })
    ).toBe(true)
  })

  test('the grace period boundary still counts as connecting', () => {
    expect(
      isOrphanedDispatch({
        createdAtNs: createdNsAgo(DISPATCH_JOIN_GRACE_MS),
        agentInRoom: false,
        nowMs,
      })
    ).toBe(false)
  })

  test('a dispatch without a creation time and no agent is orphaned', () => {
    expect(isOrphanedDispatch({ createdAtNs: undefined, agentInRoom: false, nowMs })).toBe(true)
  })
})

describe('nextArrivalCheck', () => {
  test('nothing more to do once the agent is in the room', () => {
    expect(nextArrivalCheck({ agentInRoom: true, studentInRoom: true, attempt: 1 })).toBe('arrived')
  })

  test('re-dispatches while a student waits and no agent came (LiveKit dropped the job)', () => {
    expect(nextArrivalCheck({ agentInRoom: false, studentInRoom: true, attempt: 1 })).toBe('retry')
  })

  test('stops when the student has left: nobody needs the agent any more', () => {
    expect(nextArrivalCheck({ agentInRoom: false, studentInRoom: false, attempt: 1 })).toBe(
      'give_up'
    )
  })

  test('gives up after the last attempt instead of retrying forever', () => {
    expect(
      nextArrivalCheck({ agentInRoom: false, studentInRoom: true, attempt: MAX_DISPATCH_ATTEMPTS })
    ).toBe('give_up')
  })
})

import { describe, expect, test } from 'bun:test'
import { dispatchSessionId } from './agent-dispatch'

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

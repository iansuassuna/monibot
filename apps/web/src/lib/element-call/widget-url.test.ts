import { describe, expect, test } from 'bun:test'
import { elementCallWidgetUrl } from './widget-url'

const base = {
  elementCallUrl: 'http://127.0.0.1:8090',
  widgetId: 'monibot-call-DEVICE',
  parentUrl: 'http://localhost:3000/room/abc',
  roomId: '!room:localhost',
  userId: '@aluno-0123456789abcdef0123:localhost',
  deviceId: 'DEVICE',
  homeserverUrl: 'http://127.0.0.1:8008',
  callPassword: 'segredo-da-chamada',
}

const params = (url: string) => {
  const hash = new URL(url).hash
  return new URLSearchParams(hash.slice(hash.indexOf('?')))
}

describe('elementCallWidgetUrl', () => {
  test('opens the full package in widget mode at /room', () => {
    const url = new URL(elementCallWidgetUrl(base))
    expect(url.origin + url.pathname).toBe('http://127.0.0.1:8090/room')
    expect(params(url.href).get('widgetId')).toBe('monibot-call-DEVICE')
  })

  test('keeps every parameter, the call password included, in the fragment (never sent to a server)', () => {
    const url = new URL(elementCallWidgetUrl(base))
    expect(url.search).toBe('')
    expect(params(url.href).get('password')).toBe('segredo-da-chamada')
  })

  test('accepts a base URL with or without a trailing slash', () => {
    expect(elementCallWidgetUrl({ ...base, elementCallUrl: 'http://127.0.0.1:8090/' })).toBe(
      elementCallWidgetUrl(base)
    )
  })

  test('starts audio-only, confined to the session room, without Element Call chrome', () => {
    const p = params(elementCallWidgetUrl(base))
    expect(p.get('intent')).toBe('join_existing_voice')
    expect(p.get('confineToRoom')).toBe('true')
    expect(p.get('header')).toBe('none')
  })

  test('tells Element Call who and where it is, for the widget API handshake', () => {
    const p = params(elementCallWidgetUrl(base))
    expect(p.get('parentUrl')).toBe('http://localhost:3000/room/abc')
    expect(p.get('roomId')).toBe('!room:localhost')
    expect(p.get('userId')).toBe('@aluno-0123456789abcdef0123:localhost')
    expect(p.get('deviceId')).toBe('DEVICE')
    expect(p.get('baseUrl')).toBe('http://127.0.0.1:8008')
  })

  test('omits the password for a call without shared-key encryption', () => {
    expect(params(elementCallWidgetUrl({ ...base, callPassword: null })).has('password')).toBe(
      false
    )
  })
})

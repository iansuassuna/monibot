import { describe, expect, test } from 'bun:test'
import { parseElementCallLink } from './element-call-link'

describe('parseElementCallLink', () => {
  test('reads room and key from the hash, where Element Call puts them', () => {
    expect(
      parseElementCallLink(
        'http://localhost:8090/room/#/monitoria-fp?roomId=%21xmDGVWzLhuJcBflBEB%3Alocalhost&password=af42e6d2'
      )
    ).toEqual({ matrixRoomId: '!xmDGVWzLhuJcBflBEB:localhost', e2eeSharedKey: 'af42e6d2' })
  })

  test('also accepts the parameters in the query string', () => {
    expect(
      parseElementCallLink('https://call.example.org/room?roomId=!abc:example.org&password=k3y')
    ).toEqual({ matrixRoomId: '!abc:example.org', e2eeSharedKey: 'k3y' })
  })

  test('a link without password is an unencrypted call', () => {
    expect(parseElementCallLink('http://localhost:8090/room/#/x?roomId=%21abc')).toEqual({
      matrixRoomId: '!abc',
      e2eeSharedKey: null,
    })
  })

  test('keeps the key byte-exact (percent-encoded characters decoded once)', () => {
    expect(
      parseElementCallLink('http://h/room/#/x?roomId=%21a%3Ab&password=a%2Bb%2Fc_-')?.e2eeSharedKey
    ).toBe('a+b/c_-')
  })

  test('returns null when there is no room id or the text is not a URL', () => {
    expect(parseElementCallLink('http://localhost:8090/room/#/x?password=k')).toBeNull()
    expect(parseElementCallLink('!abc:localhost')).toBeNull()
    expect(parseElementCallLink('')).toBeNull()
  })
})

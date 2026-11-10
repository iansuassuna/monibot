import { describe, expect, test } from 'bun:test'
import { openSecret, sealSecret } from './secret-box'

const MASTER = 'a-server-only-secret-of-32-chars!'

describe('sealSecret / openSecret', () => {
  test('round-trips the call key', async () => {
    const sealed = await sealSecret('af42e6d2dc0214e4', MASTER)
    expect(await openSecret(sealed, MASTER)).toBe('af42e6d2dc0214e4')
  })

  test('never stores the key in clear text', async () => {
    const sealed = await sealSecret('af42e6d2dc0214e4', MASTER)
    expect(sealed).not.toContain('af42e6d2dc0214e4')
  })

  test('uses a fresh IV, so equal keys do not produce equal ciphertexts', async () => {
    expect(await sealSecret('same', MASTER)).not.toBe(await sealSecret('same', MASTER))
  })

  test('rejects a different master secret instead of returning garbage', async () => {
    const sealed = await sealSecret('af42e6d2dc0214e4', MASTER)
    await expect(openSecret(sealed, 'another-secret-of-32-characters!!')).rejects.toThrow()
  })

  test('rejects a tampered ciphertext', async () => {
    const sealed = await sealSecret('af42e6d2dc0214e4', MASTER)
    const [version, iv, ciphertext = ''] = sealed.split('.')
    const flipped = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`
    await expect(openSecret(`${version}.${iv}.${flipped}`, MASTER)).rejects.toThrow()
  })

  test('rejects an unknown format', async () => {
    await expect(openSecret('plaintext-key', MASTER)).rejects.toThrow()
  })
})

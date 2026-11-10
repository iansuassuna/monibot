/**
 * Authenticated encryption for short secrets stored in the database (AES-256-GCM, key derived
 * from a server secret with HKDF-SHA-256). Format: `v1.<iv base64url>.<ciphertext base64url>`.
 */
const VERSION = 'v1'
const HKDF_INFO = 'monibot/stored-secret/v1'
const IV_BYTES = 12

const encoder = new TextEncoder()

async function deriveKey(masterSecret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterSecret),
    'HKDF',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encoder.encode(HKDF_INFO) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
const fromBase64Url = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'))

export async function sealSecret(plaintext: string, masterSecret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await deriveKey(masterSecret),
    encoder.encode(plaintext)
  )
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
}

/** Throws when the value is malformed, tampered with, or sealed under another secret. */
export async function openSecret(sealed: string, masterSecret: string): Promise<string> {
  const [version, iv, ciphertext] = sealed.split('.')
  if (version !== VERSION || !iv || !ciphertext) throw new Error('Unrecognized sealed secret')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    await deriveKey(masterSecret),
    fromBase64Url(ciphertext)
  )
  return new TextDecoder().decode(plaintext)
}

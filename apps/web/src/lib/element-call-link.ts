export interface ElementCallLink {
  matrixRoomId: string
  /** The call's shared E2EE key; null for an unencrypted call. */
  e2eeSharedKey: string | null
}

/**
 * Reads the Matrix room and the shared E2EE key from an Element Call link. Element Call keeps
 * them in the URL fragment (`#/<name>?roomId=…&password=…`), which browsers never send to a
 * server, so parsing happens client-side. Returns null for anything without a room id.
 */
export function parseElementCallLink(link: string): ElementCallLink | null {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return null
  }
  const fragmentQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?')) : ''
  const params = new URLSearchParams(fragmentQuery || url.search)
  const matrixRoomId = params.get('roomId')
  if (!matrixRoomId) return null
  return { matrixRoomId, e2eeSharedKey: params.get('password') || null }
}

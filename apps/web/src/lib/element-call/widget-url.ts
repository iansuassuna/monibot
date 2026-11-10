export interface ElementCallWidgetUrlInput {
  elementCallUrl: string
  widgetId: string
  /** The hosting page; Element Call posts its widget API messages to this origin. */
  parentUrl: string
  roomId: string
  userId: string
  deviceId: string
  homeserverUrl: string
  /** Shared-key E2EE password; null for a call without it. */
  callPassword: string | null
}

/**
 * URL of Element Call (full package) in widget mode for one student and call. Everything goes in
 * the fragment, which browsers never send to a server, because it carries the call password.
 * The call starts audio-only and confined to the session's room, without Element Call's header.
 */
export function elementCallWidgetUrl(input: ElementCallWidgetUrlInput): string {
  const params = new URLSearchParams({
    widgetId: input.widgetId,
    parentUrl: input.parentUrl,
    roomId: input.roomId,
    userId: input.userId,
    deviceId: input.deviceId,
    baseUrl: input.homeserverUrl,
    intent: 'join_existing_voice',
    confineToRoom: 'true',
    header: 'none',
    lang: 'pt-BR',
  })
  if (input.callPassword !== null) params.set('password', input.callPassword)
  const room = new URL(
    'room',
    input.elementCallUrl.endsWith('/') ? input.elementCallUrl : `${input.elementCallUrl}/`
  )
  return `${room.href}#?${params}`
}

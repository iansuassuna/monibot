import type { MatrixCallCredentials } from '@monibot/types'
import type { ClientWidgetApi, IRoomEvent } from 'matrix-widget-api'
import { elementCallWidgetUrl } from './widget-url'

export interface ElementCallHostHandlers {
  /** The student hung up or Element Call closed itself. */
  onHangup: () => void
}

/**
 * Element Call actions the host answers (Element Web's names). Unanswered, Element Call logs an
 * error for each and keeps waiting.
 */
const HANGUP_ACTIONS = ['im.vector.hangup', 'io.element.close'] as const
const JOIN_ACTION = 'io.element.join'
const DEVICE_MUTE_ACTION = 'io.element.device_mute'

type ToDeviceMessage = Parameters<ClientWidgetApi['feedToDevice']>[0]

/**
 * Hosts Element Call in `iframe` as a widget (the way Element Web embeds it): a Matrix client
 * logged in with the student's session credentials carries out the widget's requests, and the
 * room's events flow back into it. The heavy Matrix SDK is loaded here, on demand.
 *
 * `signal` cancels a start still in progress before the widget API is attached: an attached
 * `ClientWidgetApi` keeps listening to the iframe after `stop()` (it would then report a missing
 * `contentLoaded` for every reload of the iframe).
 *
 * @returns stop function: detaches the widget and stops the Matrix client.
 */
export async function startElementCallHost(
  iframe: HTMLIFrameElement,
  credentials: MatrixCallCredentials,
  handlers: ElementCallHostHandlers,
  signal: AbortSignal
): Promise<() => void> {
  const noop = () => undefined
  const [{ ClientEvent, createClient, RoomStateEvent }, { ClientWidgetApi, Widget }, driver] =
    await Promise.all([
      import('matrix-js-sdk'),
      import('matrix-widget-api'),
      import('./widget-driver'),
    ])

  const client = createClient({
    baseUrl: credentials.homeserverUrl,
    accessToken: credentials.accessToken,
    userId: credentials.userId,
    deviceId: credentials.deviceId,
  })
  const prepared = new Promise<void>((resolve) => {
    client.on(ClientEvent.Sync, (state) => {
      if (state === 'PREPARED') resolve()
    })
  })
  if (signal.aborted) return noop
  await client.startClient({ initialSyncLimit: 20 })
  await prepared
  if (signal.aborted) {
    client.stopClient()
    return noop
  }

  const widgetId = `monibot-call-${credentials.deviceId}`
  const url = elementCallWidgetUrl({
    elementCallUrl: credentials.elementCallUrl,
    widgetId,
    parentUrl: window.location.href,
    roomId: credentials.roomId,
    userId: credentials.userId,
    deviceId: credentials.deviceId,
    homeserverUrl: credentials.homeserverUrl,
    callPassword: credentials.callPassword,
  })
  const widget = new Widget({
    id: widgetId,
    creatorUserId: credentials.userId,
    type: 'm.custom',
    url,
    // Element Call announces itself with content_loaded once its theme is applied.
    waitForIframeLoad: false,
  })
  const api = new ClientWidgetApi(
    widget,
    iframe,
    new driver.ElementCallWidgetDriver(client, credentials.roomId)
  )
  api.setViewedRoomId(credentials.roomId)

  for (const action of HANGUP_ACTIONS) {
    api.on(`action:${action}`, (event: CustomEvent) => {
      event.preventDefault()
      api.transport.reply(event.detail, {})
      handlers.onHangup()
    })
  }
  api.on(`action:${JOIN_ACTION}`, (event: CustomEvent) => {
    event.preventDefault()
    api.transport.reply(event.detail, {})
  })
  // Element Call reports its mute state; echoing it back acknowledges it unchanged.
  api.on(`action:${DEVICE_MUTE_ACTION}`, (event: CustomEvent) => {
    event.preventDefault()
    api.transport.reply(event.detail, event.detail.data)
  })

  const inRoom = (roomId: string | undefined) => roomId === credentials.roomId
  client.on(ClientEvent.Event, (event) => {
    if (inRoom(event.getRoomId())) {
      void api.feedEvent(event.getEffectiveEvent() as IRoomEvent).catch(() => undefined)
    }
  })
  client.on(RoomStateEvent.Events, (event) => {
    if (inRoom(event.getRoomId())) {
      void api.feedStateUpdate(event.getEffectiveEvent() as IRoomEvent).catch(() => undefined)
    }
  })
  client.on(ClientEvent.ToDeviceEvent, (event) => {
    void api
      .feedToDevice(event.getEffectiveEvent() as ToDeviceMessage, event.isEncrypted())
      .catch(() => undefined)
  })

  iframe.src = url
  return () => {
    api.stop()
    api.removeAllListeners()
    client.stopClient()
    client.removeAllListeners()
  }
}

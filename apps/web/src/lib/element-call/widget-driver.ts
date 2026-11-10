import {
  EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  type StateEvents,
  type TimelineEvents,
} from 'matrix-js-sdk'
import {
  type Capability,
  type IOpenIDUpdate,
  type IRoomEvent,
  type IRtcTransportsResult,
  type ISendDelayedEventDetails,
  type ISendEventDetails,
  OpenIDRequestState,
  type SimpleObservable,
  WidgetDriver,
} from 'matrix-widget-api'

// The widget API speaks arbitrary event types; the SDK types them by its known event maps.
type StateEventType = keyof StateEvents
type StateEventContent = StateEvents[StateEventType]
type RoomEventType = keyof TimelineEvents
type RoomEventContent = TimelineEvents[RoomEventType]

const rawEvent = (event: MatrixEvent) => event.getEffectiveEvent() as IRoomEvent

/**
 * Carries out Element Call's widget API requests with the student's Matrix client, for the one
 * room of the session (the iframe is confined to it). Capabilities are approved without a prompt:
 * the page embeds only Element Call, from the configured origin, for this call.
 */
export class ElementCallWidgetDriver extends WidgetDriver {
  constructor(
    private readonly client: MatrixClient,
    private readonly roomId: string
  ) {
    super()
  }

  override async validateCapabilities(requested: Set<Capability>): Promise<Set<Capability>> {
    return requested
  }

  override async sendEvent(
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
    roomId: string | null = null
  ): Promise<ISendEventDetails> {
    const room = roomId ?? this.roomId
    const response =
      stateKey === null
        ? await this.client.sendEvent(
            room,
            null,
            eventType as RoomEventType,
            content as RoomEventContent
          )
        : await this.client.sendStateEvent(
            room,
            eventType as StateEventType,
            content as StateEventContent,
            stateKey
          )
    return { roomId: room, eventId: response.event_id }
  }

  override async sendDelayedEvent(
    delay: number,
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
    roomId: string | null = null
  ): Promise<ISendDelayedEventDetails> {
    const room = roomId ?? this.roomId
    const response =
      stateKey === null
        ? await this.client._unstable_sendDelayedEvent(
            room,
            { delay },
            null,
            eventType as RoomEventType,
            content as RoomEventContent
          )
        : await this.client._unstable_sendDelayedStateEvent(
            room,
            { delay },
            eventType as StateEventType,
            content as StateEventContent,
            stateKey
          )
    return { roomId: room, delayId: response.delay_id }
  }

  override async cancelScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.client._unstable_cancelScheduledDelayedEvent(delayId)
  }

  override async restartScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.client._unstable_restartScheduledDelayedEvent(delayId)
  }

  override async sendScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.client._unstable_sendScheduledDelayedEvent(delayId)
  }

  /** Only unencrypted to-device: the call uses a shared key, not per-participant keys over Olm. */
  override async sendToDevice(
    eventType: string,
    encrypted: boolean,
    contentMap: { [userId: string]: { [deviceId: string]: object } }
  ): Promise<void> {
    if (encrypted) throw new Error('Encrypted to-device messages are not supported')
    const batch = Object.entries(contentMap).flatMap(([userId, devices]) =>
      Object.entries(devices).map(([deviceId, payload]) => ({
        userId,
        deviceId,
        payload: payload as Record<string, unknown>,
      }))
    )
    await this.client.queueToDevice({ eventType, batch })
  }

  private liveState(roomId: string) {
    if (roomId !== this.roomId) return undefined
    return this.client.getRoom(roomId)?.getLiveTimeline().getState(EventTimeline.FORWARDS)
  }

  override async readRoomState(
    roomId: string,
    eventType: string,
    stateKey: string | undefined
  ): Promise<IRoomEvent[]> {
    const state = this.liveState(roomId)
    if (!state) return []
    if (stateKey === undefined) return state.getStateEvents(eventType).map(rawEvent)
    const event = state.getStateEvents(eventType, stateKey)
    return event ? [rawEvent(event)] : []
  }

  override async readStateEvents(
    eventType: string,
    stateKey: string | undefined,
    limit: number,
    roomIds: string[] | null = null
  ): Promise<IRoomEvent[]> {
    if (roomIds && !roomIds.includes(this.roomId)) return []
    return (await this.readRoomState(this.roomId, eventType, stateKey)).slice(0, limit)
  }

  override async readRoomTimeline(
    roomId: string,
    eventType: string,
    msgtype: string | undefined,
    stateKey: string | undefined,
    limit: number
  ): Promise<IRoomEvent[]> {
    if (roomId !== this.roomId) return []
    const events = this.client.getRoom(roomId)?.getLiveTimeline().getEvents() ?? []
    return events
      .filter(
        (event) =>
          event.getType() === eventType &&
          (msgtype === undefined || event.getContent().msgtype === msgtype) &&
          (stateKey === undefined || event.getStateKey() === stateKey)
      )
      .slice(-limit)
      .reverse()
      .map(rawEvent)
  }

  /**
   * Synapse 1.163 has no MSC4143 transports endpoint. An empty list (not an error, which Element
   * Call retries forever) makes it fall back to the LiveKit focus in its own config.json.
   */
  override async getRtcTransports(): Promise<IRtcTransportsResult> {
    return { rtc_transports: [] }
  }

  /** Sticky events (MSC4354) are unused in Element Call's compatibility mode. */
  override async readStickyEvents(): Promise<IRoomEvent[]> {
    return []
  }

  // Synapse 1.163 has no sticky events. The base class throws synchronously, so Element Call
  // would get no answer at all; a rejected promise becomes an error reply it can handle.
  override async sendStickyEvent(): Promise<ISendEventDetails> {
    throw new Error('Sticky events (MSC4354) are not supported by this homeserver')
  }

  override async sendDelayedStickyEvent(): Promise<ISendDelayedEventDetails> {
    throw new Error('Sticky events (MSC4354) are not supported by this homeserver')
  }

  /** The OpenID token lets lk-jwt-service issue Element Call's LiveKit token. */
  override askOpenID(observer: SimpleObservable<IOpenIDUpdate>): void {
    this.client.getOpenIdToken().then(
      (token) => observer.update({ state: OpenIDRequestState.Allowed, token }),
      () => observer.update({ state: OpenIDRequestState.Blocked })
    )
  }
}

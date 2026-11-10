import type { Room } from '@livekit/rtc-node'
import { createLogger } from '@monibot/logger'
import { AGENT_STATE_TOPIC, type AgentState, type AgentStateEvent } from '@monibot/types'

const logger = createLogger('AgentStatePublisher')
const encoder = new TextEncoder()

/** Sends an event elsewhere (the API's live relay); awaited in order, never blocking the caller. */
export type AgentEventRelay = (event: AgentStateEvent) => Promise<unknown>

/**
 * Publishes `AgentStateEvent`s on the DataChannel topic the web room listens to and, when a relay
 * is given, to the API for pages that are not in the LiveKit room (Element Call embedded).
 */
export class AgentStatePublisher {
  private current: AgentState = 'idle'
  private relayQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly room: Room,
    private readonly relay?: AgentEventRelay
  ) {}

  get state(): AgentState {
    return this.current
  }

  publish(event: Omit<AgentStateEvent, 'at'>): void {
    this.current = event.state
    const payload: AgentStateEvent = { ...event, at: Date.now() }
    if (this.relay) {
      const relay = this.relay
      this.relayQueue = this.relayQueue
        .then(() => relay(payload))
        .then(
          () => undefined,
          (error: unknown) =>
            logger.warn('Failed to relay agent state', { state: event.state, error })
        )
    }
    const participant = this.room.localParticipant
    if (!participant) return
    participant
      .publishData(encoder.encode(JSON.stringify(payload)), {
        reliable: true,
        topic: AGENT_STATE_TOPIC,
      })
      .catch((error: unknown) =>
        logger.warn('Failed to publish agent state', { state: event.state, error })
      )
  }
}

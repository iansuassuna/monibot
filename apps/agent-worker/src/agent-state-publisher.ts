import type { Room } from '@livekit/rtc-node'
import { createLogger } from '@monibot/logger'
import { AGENT_STATE_TOPIC, type AgentState, type AgentStateEvent } from '@monibot/types'

const logger = createLogger('AgentStatePublisher')
const encoder = new TextEncoder()

/** Publishes `AgentStateEvent`s on the DataChannel topic the web room listens to. */
export class AgentStatePublisher {
  private current: AgentState = 'idle'

  constructor(private readonly room: Room) {}

  get state(): AgentState {
    return this.current
  }

  publish(event: Omit<AgentStateEvent, 'at'>): void {
    this.current = event.state
    const payload: AgentStateEvent = { ...event, at: Date.now() }
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

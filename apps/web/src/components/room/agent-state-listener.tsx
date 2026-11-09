'use client'

import { useDataChannel } from '@livekit/components-react'
import { createLogger } from '@monibot/logger'
import { AGENT_STATE_TOPIC, agentStateEventSchema } from '@monibot/types'
import { useAgentStateStore } from '@/stores/agent-state-store'

const logger = createLogger('AgentStateListener')
const decoder = new TextDecoder()

/** Feeds `AgentStateEvent`s published by the worker into the agent-state store. */
export function AgentStateListener() {
  const applyEvent = useAgentStateStore((state) => state.applyEvent)

  useDataChannel(AGENT_STATE_TOPIC, (message) => {
    let payload: unknown
    try {
      payload = JSON.parse(decoder.decode(message.payload))
    } catch {
      logger.warn('Discarded non-JSON agent state message')
      return
    }
    const parsed = agentStateEventSchema.safeParse(payload)
    if (parsed.success) applyEvent(parsed.data)
    else logger.warn('Discarded malformed agent state message', { issues: parsed.error.issues })
  })

  return null
}

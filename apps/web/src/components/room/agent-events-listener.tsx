'use client'

import { createLogger } from '@monibot/logger'
import { agentStateEventSchema } from '@monibot/types'
import { useEffect } from 'react'
import { rpc } from '@/lib/rpc'
import { useAgentStateStore } from '@/stores/agent-state-store'

const logger = createLogger('AgentEventsListener')

/**
 * Feeds the agent's live states into the agent-state store from the API's SSE stream: a page
 * that embeds Element Call is not in the LiveKit room, so it cannot read the DataChannel.
 * `EventSource` reconnects by itself (e.g. when the API restarts).
 */
export function AgentEventsListener({ sessionId }: { sessionId: string }) {
  const applyEvent = useAgentStateStore((state) => state.applyEvent)
  const reset = useAgentStateStore((state) => state.reset)

  // Subscribing to a server stream is a sync with an external system.
  useEffect(() => {
    reset()
    const url = rpc.api.sessions[':id']['agent-events'].$url({ param: { id: sessionId } })
    const source = new EventSource(url, { withCredentials: true })
    source.addEventListener('agent-state', (message) => {
      let payload: unknown
      try {
        payload = JSON.parse(message.data)
      } catch {
        logger.warn('Discarded non-JSON agent event')
        return
      }
      const parsed = agentStateEventSchema.safeParse(payload)
      if (parsed.success) applyEvent(parsed.data)
      else logger.warn('Discarded malformed agent event', { issues: parsed.error.issues })
    })
    return () => source.close()
  }, [sessionId, applyEvent, reset])

  return null
}

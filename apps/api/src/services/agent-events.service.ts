import type { AgentEventDelivery, AgentStateEvent } from '@monibot/types'

type AgentEventListener = (event: AgentStateEvent) => void

/**
 * Live agent events per session, relayed from the worker to the pages watching the session. Kept
 * in memory: the API runs as a single process and the events are only of interest while live (the
 * research record is `interaction_logs`).
 */
const listenersBySession = new Map<string, Set<AgentEventListener>>()

export function publishAgentEvent(sessionId: string, event: AgentStateEvent): AgentEventDelivery {
  const listeners = listenersBySession.get(sessionId)
  for (const listener of listeners ?? []) listener(event)
  return { listeners: listeners?.size ?? 0 }
}

/** Registers `listener` for the session's events; returns the unsubscribe function. */
export function subscribeAgentEvents(sessionId: string, listener: AgentEventListener): () => void {
  const listeners = listenersBySession.get(sessionId) ?? new Set<AgentEventListener>()
  listeners.add(listener)
  listenersBySession.set(sessionId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersBySession.delete(sessionId)
  }
}

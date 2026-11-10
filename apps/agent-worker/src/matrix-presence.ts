import { createLogger } from '@monibot/logger'
import { AGENT_PRESENCE_HEARTBEAT_MS, type AgentPresenceState } from '@monibot/types'
import { reportAgentPresence } from './api-client'

const logger = createLogger('MatrixPresence')

/**
 * Keeps the agent's MatrixRTC membership (published by the API) in step with its presence in the
 * room: `joined` now, a heartbeat while connected, `left` on stop. Failures are logged and never
 * thrown — the call must keep working even when Matrix is unreachable.
 *
 * @returns stop function, to run at job shutdown.
 */
export function startMatrixPresence(sessionId: string): () => Promise<void> {
  const report = async (state: AgentPresenceState) => {
    try {
      const { matrixMembership } = await reportAgentPresence(sessionId, state)
      if (state !== 'heartbeat')
        logger.info('Matrix presence reported', { sessionId, state, matrixMembership })
    } catch (error) {
      logger.warn('Matrix presence report failed', { sessionId, state, error })
    }
  }
  void report('joined')
  const heartbeat = setInterval(() => void report('heartbeat'), AGENT_PRESENCE_HEARTBEAT_MS)
  return async () => {
    clearInterval(heartbeat)
    await report('left')
  }
}

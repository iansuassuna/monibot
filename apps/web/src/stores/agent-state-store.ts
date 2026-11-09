import type { AgentSource, AgentState, AgentStateEvent } from '@monibot/types'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface TranscriptEntry {
  id: string
  role: 'student' | 'agent'
  text: string
  at: number
}

interface AgentStateStore {
  state: AgentState
  transcript: TranscriptEntry[]
  sources: AgentSource[]
  lastEventAt: number
  applyEvent: (event: AgentStateEvent) => void
  reset: () => void
}

const initialState = {
  state: 'idle' as AgentState,
  transcript: [] as TranscriptEntry[],
  sources: [] as AgentSource[],
  lastEventAt: 0,
}

/** Real-time agent state received on the LiveKit DataChannel (`AGENT_STATE_TOPIC`). */
export const useAgentStateStore = create<AgentStateStore>()(
  devtools(
    (set) => ({
      ...initialState,
      applyEvent: (event) =>
        set((current) => {
          // DataChannel delivery is reliable but not ordered across reconnects.
          if (event.at < current.lastEventAt) return current
          const transcript = [...current.transcript]
          const turnId = event.turnId ?? String(event.at)
          if (event.studentTranscript) {
            transcript.push({
              id: `${turnId}-student`,
              role: 'student',
              text: event.studentTranscript,
              at: event.at,
            })
          }
          if (event.agentResponse) {
            transcript.push({
              id: `${turnId}-agent`,
              role: 'agent',
              text: event.agentResponse,
              at: event.at,
            })
          }
          return {
            state: event.state,
            lastEventAt: event.at,
            transcript,
            sources: event.sources ?? current.sources,
          }
        }),
      reset: () => set(initialState),
    }),
    { name: 'agent-state-store' }
  )
)

import type { ExperimentalCondition } from '@monibot/types'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface RoomStore {
  /** Condition of the joined session, as returned by the API — never toggled locally. */
  condition: ExperimentalCondition | null
  participantName: string
  sidePanelOpen: boolean
  setCondition: (condition: ExperimentalCondition) => void
  setParticipantName: (name: string) => void
  toggleSidePanel: () => void
  reset: () => void
}

const initialState = {
  condition: null as ExperimentalCondition | null,
  participantName: '',
  sidePanelOpen: true,
}

export const useRoomStore = create<RoomStore>()(
  devtools(
    (set) => ({
      ...initialState,
      setCondition: (condition) => set({ condition }),
      setParticipantName: (participantName) => set({ participantName }),
      toggleSidePanel: () => set((state) => ({ sidePanelOpen: !state.sidePanelOpen })),
      reset: () => set(initialState),
    }),
    { name: 'room-store' }
  )
)

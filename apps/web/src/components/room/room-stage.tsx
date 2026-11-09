'use client'

import {
  DisconnectButton,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useVoiceAssistant,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { PanelRight, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AGENT_STATE_LABELS } from '@/lib/labels'
import { useAgentStateStore } from '@/stores/agent-state-store'
import { useRoomStore } from '@/stores/room-store'
import { AgentStateListener } from './agent-state-listener'
import { AudioIndicator } from './audio-indicator'
import { MoniBotAvatar } from './moni-bot-avatar'
import { SidePanel } from './side-panel'

interface RoomStageProps {
  sessionTitle: string
  avatarEnabled: boolean
}

export function RoomStage({ sessionTitle, avatarEnabled }: RoomStageProps) {
  const { agent, audioTrack } = useVoiceAssistant()
  const agentState = useAgentStateStore((state) => state.state)
  const sidePanelOpen = useRoomStore((state) => state.sidePanelOpen)
  const toggleSidePanel = useRoomStore((state) => state.toggleSidePanel)

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-4 p-4">
      <AgentStateListener />
      <RoomAudioRenderer />
      <header className="flex items-center justify-between gap-4">
        <h1 className="truncate font-semibold text-lg">{sessionTitle}</h1>
        <Button variant="ghost" size="sm" onClick={toggleSidePanel} aria-pressed={sidePanelOpen}>
          <PanelRight aria-hidden />
          Painel
        </Button>
      </header>

      <div
        className={
          sidePanelOpen
            ? 'grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_24rem]'
            : 'flex min-h-0 flex-1'
        }
      >
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border bg-card p-6">
          {agent ? (
            <>
              {avatarEnabled ? (
                <MoniBotAvatar state={agentState} audioTrack={audioTrack} />
              ) : (
                <AudioIndicator state={agentState} audioTrack={audioTrack} />
              )}
              <p className="font-medium text-muted-foreground text-sm" aria-live="polite">
                {AGENT_STATE_LABELS[agentState]}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Aguardando o MoniBot entrar na sala…</p>
          )}
          <StartAudio
            label="Clique para ativar o áudio"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm"
          />
        </section>
        {sidePanelOpen && <SidePanel />}
      </div>

      <footer className="flex items-center justify-center gap-3" data-lk-theme="default">
        <TrackToggle source={Track.Source.Microphone} showIcon className="lk-button">
          Microfone
        </TrackToggle>
        <DisconnectButton className="lk-disconnect-button">
          <PhoneOff className="size-4" aria-hidden />
          Sair da monitoria
        </DisconnectButton>
      </footer>
    </div>
  )
}

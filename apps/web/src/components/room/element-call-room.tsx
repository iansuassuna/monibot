'use client'

import { Mic, PanelRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useMatrixCallCredentials } from '@/hooks/queries/sessions'
import { describeError } from '@/lib/errors'
import { AGENT_STATE_LABELS } from '@/lib/labels'
import { useAgentStateStore } from '@/stores/agent-state-store'
import { useRoomStore } from '@/stores/room-store'
import { AgentEventsListener } from './agent-events-listener'
import { ElementCallFrame } from './element-call-frame'
import { SidePanel } from './side-panel'

interface ElementCallRoomProps {
  sessionId: string
  sessionTitle: string
}

/**
 * The tutoring room as a MatrixRTC call: Element Call embedded with the student's own Matrix
 * account, MoniBot as a call member (its avatar, when on, is its video tile), and the transcript
 * and sources beside it from the agent's live events.
 */
export function ElementCallRoom({ sessionId, sessionTitle }: ElementCallRoomProps) {
  const router = useRouter()
  const credentials = useMatrixCallCredentials(sessionId)
  const agentState = useAgentStateStore((state) => state.state)
  const sidePanelOpen = useRoomStore((state) => state.sidePanelOpen)
  const toggleSidePanel = useRoomStore((state) => state.toggleSidePanel)

  if (!credentials.data) {
    return (
      <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{sessionTitle}</CardTitle>
            <CardDescription>
              Você vai conversar por voz com o MoniBot numa chamada do Element Call. Permita o
              acesso ao microfone quando o navegador pedir.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {credentials.error && (
              <Alert variant="destructive">{describeError(credentials.error)}</Alert>
            )}
            <Button onClick={() => credentials.mutate()} disabled={credentials.isPending}>
              <Mic aria-hidden />
              {credentials.isPending ? 'Preparando a chamada…' : 'Entrar na monitoria'}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-4 p-4">
      <AgentEventsListener sessionId={sessionId} />
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-lg">{sessionTitle}</h1>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            MoniBot: {AGENT_STATE_LABELS[agentState]}
          </p>
        </div>
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
        <section className="flex min-h-0 flex-1">
          <ElementCallFrame
            // New credentials get a new iframe: a previous widget API never hears its loads.
            key={credentials.data.accessToken}
            credentials={credentials.data}
            onHangup={() => router.push(`/evaluation/${sessionId}`)}
          />
        </section>
        {sidePanelOpen && <SidePanel />}
      </div>
    </div>
  )
}

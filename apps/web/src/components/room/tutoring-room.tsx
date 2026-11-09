'use client'

import '@livekit/components-styles'
import { LiveKitRoom } from '@livekit/components-react'
import { Mic } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useLivekitToken, useSession } from '@/hooks/queries/sessions'
import { describeError } from '@/lib/errors'
import { useAgentStateStore } from '@/stores/agent-state-store'
import { RoomStage } from './room-stage'

interface TutoringRoomProps {
  sessionId: string
  defaultParticipantName: string
}

export function TutoringRoom({ sessionId, defaultParticipantName }: TutoringRoomProps) {
  const router = useRouter()
  const session = useSession(sessionId)
  const token = useLivekitToken(sessionId)
  const resetAgentState = useAgentStateStore((state) => state.reset)
  const [participantName, setParticipantName] = useState(defaultParticipantName)

  if (session.isPending) return <Skeleton className="mx-auto mt-16 h-64 w-full max-w-md" />
  if (session.error) {
    return (
      <Alert variant="destructive" className="mx-auto mt-16 max-w-md">
        {describeError(session.error)}
      </Alert>
    )
  }
  if (session.data.status === 'ended') {
    return (
      <Alert className="mx-auto mt-16 max-w-md">
        Esta monitoria já foi encerrada.{' '}
        <a className="text-primary underline" href={`/evaluation/${sessionId}`}>
          Responder a avaliação
        </a>
      </Alert>
    )
  }

  if (token.data) {
    return (
      <LiveKitRoom
        serverUrl={token.data.serverUrl}
        token={token.data.token}
        connect
        audio
        video={false}
        onConnected={resetAgentState}
        onDisconnected={() => router.push(`/evaluation/${sessionId}`)}
      >
        <RoomStage sessionTitle={session.data.title} avatarEnabled={session.data.avatarEnabled} />
      </LiveKitRoom>
    )
  }

  function onJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    token.mutate(participantName.trim())
  }

  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{session.data.title}</CardTitle>
          <CardDescription>
            Você vai conversar por voz com o MoniBot. Permita o acesso ao microfone quando o
            navegador pedir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onJoin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="participantName">Como quer ser chamado?</Label>
              <Input
                id="participantName"
                value={participantName}
                onChange={(event) => setParticipantName(event.target.value)}
                required
                maxLength={100}
              />
            </div>
            {token.error && <Alert variant="destructive">{describeError(token.error)}</Alert>}
            <Button type="submit" disabled={token.isPending || participantName.trim() === ''}>
              <Mic aria-hidden />
              {token.isPending ? 'Conectando…' : 'Entrar na monitoria'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

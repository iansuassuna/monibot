'use client'

import { Video } from 'lucide-react'
import Link from 'next/link'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSessions } from '@/hooks/queries/sessions'
import { describeError } from '@/lib/errors'
import { SessionStatusBadge } from './session-badges'

/** Open sessions a student can join; the experimental condition is deliberately not shown. */
export function StudentSessionList() {
  const sessions = useSessions()

  if (sessions.isPending) return <Skeleton className="h-40 w-full" />
  if (sessions.error) return <Alert variant="destructive">{describeError(sessions.error)}</Alert>

  const open = sessions.data.filter((session) => session.status !== 'ended')
  if (open.length === 0) {
    return (
      <p className="rounded-xl border border-dashed py-12 text-center text-muted-foreground text-sm">
        Nenhuma monitoria disponível agora. Volte no horário combinado com a turma.
      </p>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {open.map((session) => (
        <Card key={session.id}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle>{session.title}</CardTitle>
              <SessionStatusBadge status={session.status} />
            </div>
            <CardDescription>Fundamentos de Programação</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href={`/room/${session.id}`}>
                <Video aria-hidden />
                Entrar na monitoria
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

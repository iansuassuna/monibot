'use client'

import { ClipboardList, Video } from 'lucide-react'
import Link from 'next/link'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useEndSession, useSessions } from '@/hooks/queries/sessions'
import { describeError } from '@/lib/errors'
import { ConditionBadges, SessionStatusBadge } from './session-badges'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function SessionsTable() {
  const sessions = useSessions()
  const endSession = useEndSession()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessões</CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : sessions.error ? (
          <Alert variant="destructive">{describeError(sessions.error)}</Alert>
        ) : sessions.data.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground text-sm">
            Nenhuma sessão criada ainda.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Condição</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">
                    {session.title}
                    {session.matrixRoomId && (
                      <span className="block font-mono text-muted-foreground text-xs">
                        {session.matrixRoomId}
                        {session.e2eeEnabled && (
                          <span className="font-sans"> · chamada criptografada</span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ConditionBadges
                      ragEnabled={session.ragEnabled}
                      avatarEnabled={session.avatarEnabled}
                    />
                  </TableCell>
                  <TableCell>
                    <SessionStatusBadge status={session.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dateFormatter.format(new Date(session.createdAt))}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {session.status !== 'ended' && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/room/${session.id}`}>
                            <Video aria-hidden />
                            Sala
                          </Link>
                        </Button>
                      )}
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/evaluation/${session.id}`}>
                          <ClipboardList aria-hidden />
                          Avaliação
                        </Link>
                      </Button>
                      {session.status !== 'ended' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={endSession.isPending}
                          onClick={() => endSession.mutate(session.id)}
                        >
                          Encerrar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {endSession.error && (
          <Alert variant="destructive" className="mt-4">
            {describeError(endSession.error)}
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

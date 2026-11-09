import type { Metadata } from 'next'
import { TutoringRoom } from '@/components/room/tutoring-room'
import { requireServerSession } from '@/lib/server-session'

export const metadata: Metadata = { title: 'Sala de monitoria' }

export default async function RoomPage({ params }: PageProps<'/room/[sessionId]'>) {
  const { sessionId } = await params
  const session = await requireServerSession(`/room/${sessionId}`)
  return <TutoringRoom sessionId={sessionId} defaultParticipantName={session.user.name} />
}

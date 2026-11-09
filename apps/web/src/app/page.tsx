import { redirect } from 'next/navigation'
import { StudentSessionList } from '@/components/sessions/student-session-list'
import { requireServerSession } from '@/lib/server-session'

export default async function HomePage() {
  const session = await requireServerSession('/')
  if (session.user.role === 'researcher') redirect('/dashboard/sessions')

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="font-semibold text-2xl">Olá, {session.user.name.split(' ')[0]}!</h1>
        <p className="text-muted-foreground">
          Entre em uma monitoria para tirar dúvidas de Fundamentos de Programação por voz com o
          MoniBot.
        </p>
      </div>
      <StudentSessionList />
    </main>
  )
}

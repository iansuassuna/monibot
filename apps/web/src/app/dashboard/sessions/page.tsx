import type { Metadata } from 'next'
import { CreateSessionForm } from '@/components/sessions/create-session-form'
import { SessionsTable } from '@/components/sessions/sessions-table'

export const metadata: Metadata = { title: 'Sessões' }

export default function SessionsPage() {
  return (
    <>
      <div>
        <h1 className="font-semibold text-2xl">Sessões de monitoria</h1>
        <p className="text-muted-foreground">
          Crie sessões e defina as condições experimentais (RAG × Avatar).
        </p>
      </div>
      <CreateSessionForm />
      <SessionsTable />
    </>
  )
}

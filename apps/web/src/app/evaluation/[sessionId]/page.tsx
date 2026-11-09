import type { Metadata } from 'next'
import { EvaluationForm } from '@/components/evaluation/evaluation-form'
import { requireServerSession } from '@/lib/server-session'

export const metadata: Metadata = { title: 'Avaliação da monitoria' }

export default async function EvaluationPage({ params }: PageProps<'/evaluation/[sessionId]'>) {
  const { sessionId } = await params
  await requireServerSession(`/evaluation/${sessionId}`)
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="font-semibold text-2xl">Como foi a monitoria?</h1>
        <p className="text-muted-foreground">
          Leva cerca de 3 minutos. Não há respostas certas ou erradas.
        </p>
      </div>
      <EvaluationForm sessionId={sessionId} />
    </main>
  )
}

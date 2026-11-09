import type { Metadata } from 'next'
import { DocumentForm } from '@/components/knowledge/document-form'
import { DocumentsTable } from '@/components/knowledge/documents-table'
import { RagPlayground } from '@/components/knowledge/rag-playground'

export const metadata: Metadata = { title: 'Base de conhecimento' }

export default function KnowledgePage() {
  return (
    <>
      <div>
        <h1 className="font-semibold text-2xl">Estúdio da base de conhecimento</h1>
        <p className="text-muted-foreground">
          Notas de aula, listas de exercícios, provas anteriores e códigos de Fundamentos de
          Programação.
        </p>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <DocumentForm />
        <DocumentsTable />
      </div>
      <RagPlayground />
    </>
  )
}

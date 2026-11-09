'use client'

import type { KnowledgeDocumentStatus } from '@monibot/types'
import { Trash2 } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import { useDeleteDocument, useKnowledgeDocuments } from '@/hooks/queries/knowledge'
import { describeError } from '@/lib/errors'
import { CATEGORY_LABELS, DOCUMENT_STATUS_LABELS } from '@/lib/labels'

const STATUS_VARIANT = {
  processing: 'warning',
  indexed: 'success',
  failed: 'destructive',
} as const satisfies Record<KnowledgeDocumentStatus, 'warning' | 'success' | 'destructive'>

export function DocumentsTable() {
  const documents = useKnowledgeDocuments()
  const deleteDocument = useDeleteDocument()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Material indexado</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : documents.error ? (
          <Alert variant="destructive">{describeError(documents.error)}</Alert>
        ) : documents.data.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground text-sm">
            Nenhum material cadastrado.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Chunks</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.data.map((document) => (
                <TableRow key={document.id}>
                  <TableCell className="font-medium">{document.title}</TableCell>
                  <TableCell>{CATEGORY_LABELS[document.category]}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[document.status]}>
                      {DOCUMENT_STATUS_LABELS[document.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{document.chunkCount}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remover ${document.title}`}
                      disabled={deleteDocument.isPending}
                      onClick={() => {
                        if (
                          window.confirm(`Remover "${document.title}" e todos os seus vetores?`)
                        ) {
                          deleteDocument.mutate(document.id)
                        }
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {deleteDocument.error && (
          <Alert variant="destructive" className="mt-4">
            {describeError(deleteDocument.error)}
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

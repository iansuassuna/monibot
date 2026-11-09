'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { createKnowledgeDocumentSchema, DEFAULT_COURSE, KNOWLEDGE_CATEGORIES } from '@monibot/types'
import { Upload } from 'lucide-react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateDocument } from '@/hooks/queries/knowledge'
import { describeError } from '@/lib/errors'
import { CATEGORY_LABELS } from '@/lib/labels'

type FormInput = z.input<typeof createKnowledgeDocumentSchema>
type FormOutput = z.output<typeof createKnowledgeDocumentSchema>

const ACCEPTED_FILES = '.txt,.md,.markdown,.py,.c,.h,.cpp,.java,.js,.ts'

export function DocumentForm() {
  const createDocument = useCreateDocument()
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createKnowledgeDocumentSchema),
    defaultValues: { title: '', category: 'lecture_slides', course: DEFAULT_COURSE, rawText: '' },
  })
  const { errors } = form.formState

  async function loadFile(file: File | undefined) {
    if (!file) return
    form.setValue('rawText', await file.text(), { shouldValidate: true })
    if (!form.getValues('title')) form.setValue('title', file.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adicionar material</CardTitle>
        <CardDescription>
          Texto, markdown ou código. Blocos de código entre ``` nunca são divididos na indexação.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={form.handleSubmit(async (values) => {
            await createDocument.mutateAsync(values)
            form.reset()
          })}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-title">Título</Label>
            <Input
              id="doc-title"
              aria-invalid={Boolean(errors.title)}
              {...form.register('title')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-category">Categoria</Label>
            <NativeSelect id="doc-category" {...form.register('category')}>
              {KNOWLEDGE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="doc-text">Conteúdo</Label>
              <Label className="cursor-pointer text-primary text-xs hover:underline">
                <Upload className="size-3.5" aria-hidden />
                Carregar arquivo
                <input
                  type="file"
                  accept={ACCEPTED_FILES}
                  className="sr-only"
                  onChange={(event) => loadFile(event.target.files?.[0])}
                />
              </Label>
            </div>
            <Textarea
              id="doc-text"
              rows={10}
              className="font-mono text-xs"
              aria-invalid={Boolean(errors.rawText)}
              {...form.register('rawText')}
            />
            {errors.rawText && (
              <p className="text-destructive text-xs">O conteúdo não pode ficar vazio.</p>
            )}
          </div>
          {createDocument.error && (
            <Alert variant="destructive" className="md:col-span-2">
              {describeError(createDocument.error)}
            </Alert>
          )}
          <div className="md:col-span-2">
            <Button type="submit" disabled={createDocument.isPending}>
              {createDocument.isPending ? 'Indexando (gerando embeddings)…' : 'Indexar material'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

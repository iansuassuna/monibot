'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { createTutoringSessionSchema } from '@monibot/types'
import { useRef } from 'react'
import { Controller, useForm } from 'react-hook-form'
import type { z } from 'zod'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCreateSession } from '@/hooks/queries/sessions'
import { parseElementCallLink } from '@/lib/element-call-link'
import { describeError } from '@/lib/errors'

type FormInput = z.input<typeof createTutoringSessionSchema>
type FormOutput = z.output<typeof createTutoringSessionSchema>

export function CreateSessionForm() {
  const createSession = useCreateSession()
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createTutoringSessionSchema),
    defaultValues: {
      title: '',
      matrixRoomId: null,
      ragEnabled: true,
      avatarEnabled: true,
      llmModel: undefined,
      e2eeSharedKey: null,
    },
  })
  const { errors } = form.formState
  // Not a form field: the link only feeds `matrixRoomId` and `e2eeSharedKey`.
  const callLinkRef = useRef<HTMLInputElement>(null)
  const callKeyCaptured = form.watch('e2eeSharedKey') !== null

  const applyCallLink = (link: string) => {
    const parsed = parseElementCallLink(link)
    if (!parsed) return
    form.setValue('matrixRoomId', parsed.matrixRoomId, { shouldValidate: true })
    form.setValue('e2eeSharedKey', parsed.e2eeSharedKey, { shouldValidate: true })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova sessão de monitoria</CardTitle>
        <CardDescription>
          As condições experimentais ficam fixas durante toda a sessão.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={form.handleSubmit(async (values) => {
            await createSession.mutateAsync(values)
            form.reset()
            if (callLinkRef.current) callLinkRef.current.value = ''
          })}
        >
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Monitoria — Laços de repetição"
              aria-invalid={Boolean(errors.title)}
              {...form.register('title')}
            />
            {errors.title && <p className="text-destructive text-xs">Informe um título.</p>}
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="elementCallLink">Link da chamada Element Call (opcional)</Label>
            <Input
              id="elementCallLink"
              ref={callLinkRef}
              placeholder="https://…/room/#/sala?roomId=…&password=…"
              autoComplete="off"
              onChange={(event) => applyCallLink(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {callKeyCaptured
                ? 'Sala e chave de criptografia capturadas: o MoniBot entrará na chamada criptografada.'
                : 'Preenche a sala Matrix e, se a chamada for criptografada, a chave para o MoniBot.'}
            </p>
            {errors.e2eeSharedKey && (
              <p className="text-destructive text-xs">{errors.e2eeSharedKey.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="matrixRoomId">Sala Matrix (opcional)</Label>
            <Input
              id="matrixRoomId"
              placeholder="!abc123:matrix.exemplo.org ou !abc123"
              aria-invalid={Boolean(errors.matrixRoomId)}
              {...form.register('matrixRoomId', {
                setValueAs: (value: unknown) =>
                  typeof value === 'string' && value.trim() !== '' ? value.trim() : null,
              })}
            />
            {errors.matrixRoomId && (
              <p className="text-destructive text-xs">{errors.matrixRoomId.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="llmModel">Modelo LLM (Ollama)</Label>
            <Input
              id="llmModel"
              placeholder="Padrão do servidor"
              {...form.register('llmModel', {
                setValueAs: (value: unknown) =>
                  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined,
              })}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="ragEnabled">RAG ativado</Label>
              <p className="text-muted-foreground text-xs">
                LLM + material da disciplina vs. LLM isolado
              </p>
            </div>
            <Controller
              control={form.control}
              name="ragEnabled"
              render={({ field }) => (
                <Switch
                  id="ragEnabled"
                  checked={field.value ?? true}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="avatarEnabled">Avatar ativado</Label>
              <p className="text-muted-foreground text-xs">Presença visual vs. apenas áudio</p>
            </div>
            <Controller
              control={form.control}
              name="avatarEnabled"
              render={({ field }) => (
                <Switch
                  id="avatarEnabled"
                  checked={field.value ?? true}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>
          {createSession.error && (
            <Alert variant="destructive" className="md:col-span-2">
              {describeError(createSession.error)}
            </Alert>
          )}
          <div className="md:col-span-2">
            <Button type="submit" disabled={createSession.isPending}>
              {createSession.isPending ? 'Criando…' : 'Criar sessão'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

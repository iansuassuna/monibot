'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { createUserEvaluationSchema } from '@monibot/types'
import { CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Controller, type FieldPath, useForm } from 'react-hook-form'
import type { z } from 'zod'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useCreateEvaluation } from '@/hooks/queries/evaluations'
import { useSession } from '@/hooks/queries/sessions'
import { describeError } from '@/lib/errors'
import {
  AVATAR_NATURALNESS_ITEM,
  SUS_ITEMS,
  TAM_EASE_OF_USE_ITEMS,
  TAM_USEFULNESS_ITEMS,
} from '@/lib/questionnaires'
import { LikertScale } from './likert-scale'

type FormInput = z.input<typeof createUserEvaluationSchema>
type FormOutput = z.output<typeof createUserEvaluationSchema>

interface Step {
  id: 'sus' | 'usefulness' | 'ease' | 'avatar' | 'comments'
  title: string
  description: string
  fields: FieldPath<FormInput>[]
}

const BASE_STEPS: Step[] = [
  {
    id: 'sus',
    title: 'Usabilidade do sistema',
    description: 'Escala SUS — 10 afirmações.',
    fields: ['susAnswers'],
  },
  {
    id: 'usefulness',
    title: 'Utilidade percebida',
    description: 'O quanto o MoniBot ajuda nos seus estudos.',
    fields: ['tamPerceivedUsefulnessAnswers'],
  },
  {
    id: 'ease',
    title: 'Facilidade de uso',
    description: 'O quanto foi fácil interagir com o MoniBot.',
    fields: ['tamPerceivedEaseOfUseAnswers'],
  },
  {
    id: 'avatar',
    title: 'Avatar',
    description: 'Sobre a presença visual do MoniBot.',
    fields: ['avatarNaturalnessScore'],
  },
  {
    id: 'comments',
    title: 'Comentários',
    description: 'Opcional: conte como foi a experiência.',
    fields: ['comments'],
  },
]

interface LikertGroupProps {
  form: ReturnType<typeof useForm<FormInput, unknown, FormOutput>>
  field: 'susAnswers' | 'tamPerceivedUsefulnessAnswers' | 'tamPerceivedEaseOfUseAnswers'
  items: readonly string[]
  numbered?: boolean
}

function LikertGroup({ form, field, items, numbered }: LikertGroupProps) {
  const invalid = Boolean(form.formState.errors[field])
  return (
    <div className="flex flex-col gap-3">
      {items.map((statement, index) => (
        <Controller
          key={statement}
          control={form.control}
          name={`${field}.${index}`}
          render={({ field: item }) => (
            <LikertScale
              name={`${field}-${index}`}
              number={numbered ? index + 1 : undefined}
              statement={statement}
              value={item.value}
              onChange={(value) => {
                item.onChange(value)
                // Clear the step's "answer everything" error as soon as the last gap is filled.
                if (invalid) void form.trigger(field)
              }}
              invalid={invalid && item.value === undefined}
            />
          )}
        />
      ))}
    </div>
  )
}

export function EvaluationForm({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId)
  const createEvaluation = useCreateEvaluation()
  const [stepIndex, setStepIndex] = useState(0)
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createUserEvaluationSchema),
    defaultValues: {
      sessionId,
      susAnswers: [],
      tamPerceivedUsefulnessAnswers: [],
      tamPerceivedEaseOfUseAnswers: [],
      avatarNaturalnessScore: null,
      comments: '',
    },
  })

  if (session.isPending) return <Skeleton className="h-96 w-full" />
  if (session.error) return <Alert variant="destructive">{describeError(session.error)}</Alert>

  if (createEvaluation.isSuccess) {
    return (
      <Card className="items-center text-center">
        <CardHeader className="items-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <CardTitle className="text-xl">Obrigado pela avaliação!</CardTitle>
          <CardDescription>
            Suas respostas ajudam a pesquisa sobre monitoria inteligente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/">Voltar ao início</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const steps = session.data.avatarEnabled
    ? BASE_STEPS
    : BASE_STEPS.filter((step) => step.id !== 'avatar')
  const step = steps[stepIndex] ?? steps[0]
  if (!step) return null
  const isLast = stepIndex === steps.length - 1

  async function next() {
    if (step && (await form.trigger(step.fields))) setStepIndex((index) => index + 1)
  }

  return (
    <Card>
      <CardHeader>
        <p className="text-muted-foreground text-xs">
          Etapa {stepIndex + 1} de {steps.length}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
        <CardTitle className="pt-2 text-xl">{step.title}</CardTitle>
        <CardDescription>{step.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={form.handleSubmit((values) => createEvaluation.mutate(values))}
        >
          {step.id === 'sus' && (
            <LikertGroup form={form} field="susAnswers" items={SUS_ITEMS} numbered />
          )}
          {step.id === 'usefulness' && (
            <LikertGroup
              form={form}
              field="tamPerceivedUsefulnessAnswers"
              items={TAM_USEFULNESS_ITEMS}
            />
          )}
          {step.id === 'ease' && (
            <LikertGroup
              form={form}
              field="tamPerceivedEaseOfUseAnswers"
              items={TAM_EASE_OF_USE_ITEMS}
            />
          )}
          {step.id === 'avatar' && (
            <Controller
              control={form.control}
              name="avatarNaturalnessScore"
              render={({ field }) => (
                <LikertScale
                  name="avatarNaturalnessScore"
                  statement={AVATAR_NATURALNESS_ITEM}
                  value={field.value ?? undefined}
                  onChange={field.onChange}
                />
              )}
            />
          )}
          {step.id === 'comments' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="comments">Comentários</Label>
              <Textarea id="comments" rows={5} maxLength={5000} {...form.register('comments')} />
            </div>
          )}

          {Object.keys(form.formState.errors).length > 0 && (
            <Alert variant="destructive">
              Responda todas as afirmações desta etapa para continuar.
            </Alert>
          )}
          {createEvaluation.error && (
            <Alert variant="destructive">{describeError(createEvaluation.error)}</Alert>
          )}

          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((index) => index - 1)}
            >
              Voltar
            </Button>
            {isLast ? (
              <Button type="submit" disabled={createEvaluation.isPending}>
                {createEvaluation.isPending ? 'Enviando…' : 'Enviar avaliação'}
              </Button>
            ) : (
              <Button type="button" onClick={next}>
                Continuar
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

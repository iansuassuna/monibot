'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import {
  playgroundRequestSchema,
  RETRIEVAL_DEFAULT_MIN_SCORE,
  RETRIEVAL_DEFAULT_TOP_K,
  RETRIEVAL_MAX_TOP_K,
  type RetrievedChunk,
} from '@monibot/types'
import { FlaskConical } from 'lucide-react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { usePlayground } from '@/hooks/queries/knowledge'
import { describeError } from '@/lib/errors'

type FormInput = z.input<typeof playgroundRequestSchema>
type FormOutput = z.output<typeof playgroundRequestSchema>

function ChunkList({ chunks }: { chunks: RetrievedChunk[] }) {
  if (chunks.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        Nenhum trecho acima do limiar de similaridade.
      </p>
    )
  }
  return (
    <ol className="flex flex-col gap-2">
      {chunks.map((chunk) => (
        <li key={chunk.chunkId} className="rounded-md border bg-muted/40 p-3">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">
              {chunk.documentTitle}
              {chunk.metadata.section && (
                <span className="text-muted-foreground"> · {chunk.metadata.section}</span>
              )}
            </span>
            <Badge variant="outline" className="tabular-nums">
              cos {chunk.score.toFixed(3)}
            </Badge>
          </div>
          {chunk.metadata.isCode ? (
            <pre className="overflow-x-auto font-mono text-xs">{chunk.content}</pre>
          ) : (
            <p className="line-clamp-4 text-xs">{chunk.content}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

export function RagPlayground() {
  const playground = usePlayground()
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(playgroundRequestSchema),
    defaultValues: {
      question: '',
      topK: RETRIEVAL_DEFAULT_TOP_K,
      minScore: RETRIEVAL_DEFAULT_MIN_SCORE,
    },
  })
  const result = playground.data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" aria-hidden />
          Playground RAG comparativo
        </CardTitle>
        <CardDescription>
          A mesma dúvida respondida pelo LLM isolado e pelo LLM + RAG, com os mesmos prompts
          pedagógicos da sala.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          className="grid gap-4 md:grid-cols-[1fr_8rem_8rem_auto] md:items-end"
          onSubmit={form.handleSubmit((values) => playground.mutate(values))}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="pg-question">Dúvida do estudante</Label>
            <Textarea
              id="pg-question"
              rows={2}
              placeholder="Por que meu laço while nunca termina?"
              {...form.register('question')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pg-topk">Top-K</Label>
            <Input
              id="pg-topk"
              type="number"
              min={1}
              max={RETRIEVAL_MAX_TOP_K}
              {...form.register('topK', { valueAsNumber: true })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pg-minscore">Score mín.</Label>
            <Input
              id="pg-minscore"
              type="number"
              step={0.05}
              min={0}
              max={1}
              {...form.register('minScore', { valueAsNumber: true })}
            />
          </div>
          <Button type="submit" disabled={playground.isPending}>
            {playground.isPending ? 'Gerando…' : 'Comparar'}
          </Button>
        </form>

        {playground.error && <Alert variant="destructive">{describeError(playground.error)}</Alert>}

        {result && (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <header className="flex items-center justify-between">
                <h4 className="font-medium">LLM puro</h4>
                <Badge variant="secondary" className="tabular-nums">
                  LLM {result.withoutRag.llmLatencyMs} ms
                </Badge>
              </header>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {result.withoutRag.answer}
              </p>
            </section>
            <section className="flex flex-col gap-3 rounded-lg border border-primary/40 p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium">LLM + RAG</h4>
                <div className="flex gap-1">
                  <Badge variant="secondary" className="tabular-nums">
                    RAG {result.withRag.ragLatencyMs} ms
                  </Badge>
                  <Badge variant="secondary" className="tabular-nums">
                    LLM {result.withRag.llmLatencyMs} ms
                  </Badge>
                </div>
              </header>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.withRag.answer}</p>
              <div className="flex flex-col gap-2">
                <h5 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  Trechos recuperados
                </h5>
                <ChunkList chunks={result.withRag.chunks} />
              </div>
            </section>
            <p className="text-muted-foreground text-xs lg:col-span-2">Modelo: {result.model}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

'use client'

import { BookOpen, MessagesSquare } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAgentStateStore } from '@/stores/agent-state-store'

/** Live transcript plus the course material the agent used for its latest answer. */
export function SidePanel() {
  const transcript = useAgentStateStore((state) => state.transcript)
  const sources = useAgentStateStore((state) => state.sources)
  const endRef = useRef<HTMLDivElement>(null)

  // Scrolling the DOM is a sync with an external system, not derived state.
  useEffect(() => {
    if (transcript.length > 0) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [transcript.length])

  return (
    <aside className="flex min-h-0 flex-col gap-4 rounded-xl border bg-card p-4">
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <h2 className="flex items-center gap-2 font-medium text-sm">
          <MessagesSquare className="size-4" aria-hidden />
          Transcrição
        </h2>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" aria-live="polite">
          {transcript.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Faça sua pergunta em voz alta. A conversa aparece aqui.
            </p>
          ) : (
            transcript.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  'max-w-[90%] rounded-lg px-3 py-2 text-sm',
                  entry.role === 'student'
                    ? 'self-end bg-primary text-primary-foreground'
                    : 'self-start bg-muted'
                )}
              >
                <span className="mb-0.5 block font-medium text-xs opacity-75">
                  {entry.role === 'student' ? 'Você' : 'MoniBot'}
                </span>
                {entry.text}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      </section>
      {sources.length > 0 && (
        <section className="flex max-h-[45%] flex-col gap-2">
          <h2 className="flex items-center gap-2 font-medium text-sm">
            <BookOpen className="size-4" aria-hidden />
            Fontes do material
          </h2>
          <ul className="flex flex-col gap-2 overflow-y-auto pr-1">
            {sources.map((source) => (
              <li
                key={`${source.documentTitle}:${source.excerpt.slice(0, 64)}`}
                className="rounded-md border bg-muted/40 p-2"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">{source.documentTitle}</span>
                  <Badge variant="outline" className="tabular-nums">
                    {source.score.toFixed(2)}
                  </Badge>
                </div>
                {source.isCode ? (
                  <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-xs">
                    {source.excerpt}
                  </pre>
                ) : (
                  <p className="line-clamp-3 text-xs">{source.excerpt}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}

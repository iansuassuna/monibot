'use client'

import { LATENCY_METRICS, type MetricSummary } from '@monibot/types'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { evaluationExportHref } from '@/hooks/queries/evaluations'
import { useAnalytics } from '@/hooks/queries/telemetry'
import { describeError } from '@/lib/errors'
import { METRIC_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { CONDITION_SERIES, findCondition, msFormatter, scoreFormatter } from './conditions'
import { GroupedBarChart } from './grouped-bar-chart'

const STATISTICS = [
  { key: 'mean', label: 'Média' },
  { key: 'p50', label: 'Mediana (p50)' },
  { key: 'p95', label: 'p95' },
] as const satisfies readonly { key: keyof MetricSummary; label: string }[]

type Statistic = (typeof STATISTICS)[number]['key']

const formatMs = (value: number) => `${msFormatter.format(value)} ms`
const formatScore = (value: number) => scoreFormatter.format(value)
const formatMsAxis = (value: number) => msFormatter.format(value)
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const EXPORTS = [
  {
    label: 'Avaliações (CSV)',
    href: evaluationExportHref({ dataset: 'evaluations', format: 'csv' }),
  },
  {
    label: 'Interações (CSV)',
    href: evaluationExportHref({ dataset: 'interactions', format: 'csv' }),
  },
  {
    label: 'Interações (JSON)',
    href: evaluationExportHref({ dataset: 'interactions', format: 'json' }),
  },
] as const

export function AnalyticsDashboard() {
  const analytics = useAnalytics()
  const [statistic, setStatistic] = useState<Statistic>('mean')

  if (analytics.isPending) return <Skeleton className="h-[36rem] w-full" />
  if (analytics.error) return <Alert variant="destructive">{describeError(analytics.error)}</Alert>

  const { conditions } = analytics.data
  const cells = CONDITION_SERIES.map((series) => ({
    series,
    data: findCondition(conditions, series),
  }))

  const latencyData = LATENCY_METRICS.map((metric) => {
    const row: Record<string, string | number | null> = { stage: METRIC_LABELS[metric] }
    for (const { series, data } of cells)
      row[series.key] = data?.latency?.[metric][statistic] ?? null
    return row
  })

  const susData = [
    Object.fromEntries([
      ['construct', 'SUS'],
      ...cells.map(({ series, data }) => [series.key, data?.susScore?.mean ?? null]),
    ]),
  ]
  const tamData = [
    Object.fromEntries([
      ['construct', 'Utilidade percebida'],
      ...cells.map(({ series, data }) => [series.key, data?.tamPerceivedUsefulness?.mean ?? null]),
    ]),
    Object.fromEntries([
      ['construct', 'Facilidade de uso'],
      ...cells.map(({ series, data }) => [series.key, data?.tamPerceivedEaseOfUse?.mean ?? null]),
    ]),
  ]

  const hasTurns = cells.some(({ data }) => (data?.turnCount ?? 0) > 0)
  const hasEvaluations = cells.some(({ data }) => data?.susScore)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="inline-flex rounded-md border p-0.5">
          <legend className="sr-only">Estatística de latência</legend>
          {STATISTICS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={statistic === option.key}
              onClick={() => setStatistic(option.key)}
              className={cn(
                'rounded px-3 py-1 text-sm transition-colors',
                statistic === option.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        <div className="ml-auto flex flex-wrap gap-2">
          {EXPORTS.map((item) => (
            <Button key={item.href} asChild variant="outline" size="sm">
              <a href={item.href} download>
                <Download aria-hidden />
                {item.label}
              </a>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cells.map(({ series, data }) => (
          <Card key={series.key} className="gap-2">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: series.color }}
                  aria-hidden
                />
                {series.label}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <p className="font-semibold text-2xl">
                {data?.latency ? formatMs(data.latency.totalE2eLatencyMs[statistic]) : '—'}
              </p>
              <p className="text-muted-foreground text-xs">
                latência E2E · {STATISTICS.find((s) => s.key === statistic)?.label}
              </p>
              <p className="pt-2 text-muted-foreground text-xs">
                {plural(data?.sessionCount ?? 0, 'sessão', 'sessões')} ·{' '}
                {plural(data?.turnCount ?? 0, 'turno', 'turnos')} · SUS{' '}
                {data?.susScore ? formatScore(data.susScore.mean) : '—'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latência por etapa do pipeline</CardTitle>
          <CardDescription>
            STT → RAG → LLM → TTS e total fim a fim, por condição experimental.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasTurns ? (
            <GroupedBarChart
              data={latencyData}
              categoryKey="stage"
              series={CONDITION_SERIES}
              format={formatMs}
              axisFormat={formatMsAxis}
              yLabel="ms"
              height={340}
            />
          ) : (
            <p className="py-16 text-center text-muted-foreground text-sm">
              Nenhum turno de voz registrado ainda.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>SUS</CardTitle>
            <CardDescription>Média do escore (0–100).</CardDescription>
          </CardHeader>
          <CardContent>
            {hasEvaluations ? (
              <GroupedBarChart
                data={susData}
                categoryKey="construct"
                series={CONDITION_SERIES}
                format={formatScore}
                yDomain={[0, 100]}
                yLabel="escore"
              />
            ) : (
              <p className="py-16 text-center text-muted-foreground text-sm">
                Sem avaliações ainda.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>TAM</CardTitle>
            <CardDescription>Média por construto (escala Likert 1–5).</CardDescription>
          </CardHeader>
          <CardContent>
            {hasEvaluations ? (
              <GroupedBarChart
                data={tamData}
                categoryKey="construct"
                series={CONDITION_SERIES}
                format={formatScore}
                yDomain={[1, 5]}
                yLabel="Likert"
              />
            ) : (
              <p className="py-16 text-center text-muted-foreground text-sm">
                Sem avaliações ainda.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tabela completa</CardTitle>
          <CardDescription>
            Média, p50, p95 e desvio padrão amostral de cada métrica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Condição</TableHead>
                <TableHead>Métrica</TableHead>
                <TableHead className="text-right">Média</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">DP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cells.flatMap(({ series, data }) => {
                const rows: {
                  metric: string
                  summary: MetricSummary | null | undefined
                  format: (v: number) => string
                }[] = [
                  ...LATENCY_METRICS.map((metric) => ({
                    metric: METRIC_LABELS[metric],
                    summary: data?.latency?.[metric],
                    format: formatMs,
                  })),
                  { metric: 'SUS', summary: data?.susScore, format: formatScore },
                  {
                    metric: 'TAM — Utilidade',
                    summary: data?.tamPerceivedUsefulness,
                    format: formatScore,
                  },
                  {
                    metric: 'TAM — Facilidade',
                    summary: data?.tamPerceivedEaseOfUse,
                    format: formatScore,
                  },
                ]
                return rows.map((row, index) => (
                  <TableRow key={`${series.key}-${row.metric}`}>
                    <TableCell className="font-medium">{index === 0 ? series.label : ''}</TableCell>
                    <TableCell>{row.metric}</TableCell>
                    {(['mean', 'p50', 'p95', 'stdDev'] as const).map((stat) => (
                      <TableCell key={stat} className="text-right tabular-nums">
                        {row.summary ? row.format(row.summary[stat]) : '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

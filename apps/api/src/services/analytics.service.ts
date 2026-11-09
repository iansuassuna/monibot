import { getDb, interactionLogs, tutoringSessions, userEvaluations } from '@monibot/db'
import type { AnalyticsResponse, ConditionAnalytics, MetricSummary } from '@monibot/types'
import { count, countDistinct, eq, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

const summarize = (column: AnyPgColumn) => ({
  mean: sql<number>`coalesce(avg(${column}), 0)`.mapWith(Number),
  p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${column}), 0)`.mapWith(
    Number
  ),
  p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${column}), 0)`.mapWith(
    Number
  ),
  stdDev: sql<number>`coalesce(stddev_samp(${column}), 0)`.mapWith(Number),
})

const conditionKey = (ragEnabled: boolean, avatarEnabled: boolean) =>
  `${ragEnabled}:${avatarEnabled}`

const DESIGN_CELLS = [
  { ragEnabled: true, avatarEnabled: true },
  { ragEnabled: true, avatarEnabled: false },
  { ragEnabled: false, avatarEnabled: true },
  { ragEnabled: false, avatarEnabled: false },
] as const

/**
 * Mean, p50, p95, and sample standard deviation of every latency metric and questionnaire
 * score, for each cell of the ragEnabled × avatarEnabled design. Always returns all four cells.
 */
export async function getAnalytics(): Promise<AnalyticsResponse> {
  const db = getDb()

  const [sessionCounts, latencyRows, evaluationRows] = await Promise.all([
    db
      .select({
        ragEnabled: tutoringSessions.ragEnabled,
        avatarEnabled: tutoringSessions.avatarEnabled,
        sessionCount: count(),
      })
      .from(tutoringSessions)
      .groupBy(tutoringSessions.ragEnabled, tutoringSessions.avatarEnabled),
    db
      .select({
        ragEnabled: tutoringSessions.ragEnabled,
        avatarEnabled: tutoringSessions.avatarEnabled,
        turnCount: count(),
        sttLatencyMs: summarize(interactionLogs.sttLatencyMs),
        ragLatencyMs: summarize(interactionLogs.ragLatencyMs),
        llmTtftMs: summarize(interactionLogs.llmTtftMs),
        llmTotalLatencyMs: summarize(interactionLogs.llmTotalLatencyMs),
        ttsLatencyMs: summarize(interactionLogs.ttsLatencyMs),
        totalE2eLatencyMs: summarize(interactionLogs.totalE2eLatencyMs),
      })
      .from(interactionLogs)
      .innerJoin(tutoringSessions, eq(interactionLogs.sessionId, tutoringSessions.id))
      .groupBy(tutoringSessions.ragEnabled, tutoringSessions.avatarEnabled),
    db
      .select({
        ragEnabled: tutoringSessions.ragEnabled,
        avatarEnabled: tutoringSessions.avatarEnabled,
        evaluationCount: countDistinct(userEvaluations.id),
        susScore: summarize(userEvaluations.susCalculatedScore),
        tamPerceivedUsefulness: summarize(userEvaluations.tamPerceivedUsefulness),
        tamPerceivedEaseOfUse: summarize(userEvaluations.tamPerceivedEaseOfUse),
      })
      .from(userEvaluations)
      .innerJoin(tutoringSessions, eq(userEvaluations.sessionId, tutoringSessions.id))
      .groupBy(tutoringSessions.ragEnabled, tutoringSessions.avatarEnabled),
  ])

  const index = <T extends { ragEnabled: boolean; avatarEnabled: boolean }>(rows: T[]) =>
    new Map(rows.map((row) => [conditionKey(row.ragEnabled, row.avatarEnabled), row]))
  const sessionsByCell = index(sessionCounts)
  const latencyByCell = index(latencyRows)
  const evaluationsByCell = index(evaluationRows)

  const conditions = DESIGN_CELLS.map(({ ragEnabled, avatarEnabled }): ConditionAnalytics => {
    const key = conditionKey(ragEnabled, avatarEnabled)
    const latency = latencyByCell.get(key)
    const evaluations = evaluationsByCell.get(key)
    const scored = (summary: MetricSummary | undefined) =>
      evaluations && evaluations.evaluationCount > 0 && summary ? summary : null

    return {
      ragEnabled,
      avatarEnabled,
      sessionCount: sessionsByCell.get(key)?.sessionCount ?? 0,
      turnCount: latency?.turnCount ?? 0,
      latency: latency
        ? {
            sttLatencyMs: latency.sttLatencyMs,
            ragLatencyMs: latency.ragLatencyMs,
            llmTtftMs: latency.llmTtftMs,
            llmTotalLatencyMs: latency.llmTotalLatencyMs,
            ttsLatencyMs: latency.ttsLatencyMs,
            totalE2eLatencyMs: latency.totalE2eLatencyMs,
          }
        : null,
      susScore: scored(evaluations?.susScore),
      tamPerceivedUsefulness: scored(evaluations?.tamPerceivedUsefulness),
      tamPerceivedEaseOfUse: scored(evaluations?.tamPerceivedEaseOfUse),
    }
  })

  return { conditions, generatedAt: new Date().toISOString() }
}

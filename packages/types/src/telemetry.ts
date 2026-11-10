import { z } from 'zod'
import { isoDateTimeSchema, latencyMsSchema, uuidSchema } from './common'
import { AGENT_STATES } from './constants'
import { retrievedChunkRefSchema } from './knowledge'

export const agentStateSchema = z.enum(AGENT_STATES)
export type AgentState = z.infer<typeof agentStateSchema>

/** Payload published by the worker on the `AGENT_STATE_TOPIC` DataChannel topic. */
export const agentSourceSchema = z.object({
  documentTitle: z.string(),
  score: z.number(),
  excerpt: z.string(),
  isCode: z.boolean().default(false),
})
export type AgentSource = z.infer<typeof agentSourceSchema>

/**
 * `studentTranscript` accompanies the first event after Whisper finishes (`searching_rag` or
 * `thinking`); `agentResponse` and `sources` accompany `speaking`.
 */
export const agentStateEventSchema = z.object({
  state: agentStateSchema,
  /** Worker wall-clock time (ms since epoch) for ordering events. */
  at: z.number().int().nonnegative(),
  turnId: z.string().optional(),
  studentTranscript: z.string().optional(),
  agentResponse: z.string().optional(),
  sources: z.array(agentSourceSchema).optional(),
})
export type AgentStateEvent = z.infer<typeof agentStateEventSchema>

/** Result of relaying an agent event to the session's live viewers (SSE). */
export const agentEventDeliverySchema = z.object({
  /** Open viewer streams that received the event. */
  listeners: z.number().int().nonnegative(),
})
export type AgentEventDelivery = z.infer<typeof agentEventDeliverySchema>

/** Millisecond durations measured for one voice turn. */
export const turnLatencySchema = z.object({
  sttLatencyMs: latencyMsSchema,
  /** `0` when the session has `ragEnabled = false`. */
  ragLatencyMs: latencyMsSchema,
  llmTtftMs: latencyMsSchema,
  llmTotalLatencyMs: latencyMsSchema,
  ttsLatencyMs: latencyMsSchema,
  /** End-of-speech VAD event → first audio frame published to LiveKit. */
  totalE2eLatencyMs: latencyMsSchema,
})
export type TurnLatency = z.infer<typeof turnLatencySchema>

export const interactionLogCreateSchema = turnLatencySchema.extend({
  sessionId: uuidSchema,
  studentTranscript: z.string(),
  retrievedChunks: z.array(retrievedChunkRefSchema).default([]),
  agentResponse: z.string(),
})
export type InteractionLogCreate = z.infer<typeof interactionLogCreateSchema>

export const interactionLogSchema = interactionLogCreateSchema.extend({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
})
export type InteractionLog = z.infer<typeof interactionLogSchema>

export const LATENCY_METRICS = [
  'sttLatencyMs',
  'ragLatencyMs',
  'llmTtftMs',
  'llmTotalLatencyMs',
  'ttsLatencyMs',
  'totalE2eLatencyMs',
] as const satisfies readonly (keyof TurnLatency)[]

export const latencyMetricSchema = z.enum(LATENCY_METRICS)
export type LatencyMetric = z.infer<typeof latencyMetricSchema>

export const metricSummarySchema = z.object({
  mean: z.number(),
  p50: z.number(),
  p95: z.number(),
  stdDev: z.number(),
})
export type MetricSummary = z.infer<typeof metricSummarySchema>

/** Aggregates for one cell of the ragEnabled × avatarEnabled design. */
export const conditionAnalyticsSchema = z.object({
  ragEnabled: z.boolean(),
  avatarEnabled: z.boolean(),
  sessionCount: z.number().int().nonnegative(),
  turnCount: z.number().int().nonnegative(),
  /** `null` when the cell has no recorded turns yet. */
  latency: z.record(latencyMetricSchema, metricSummarySchema).nullable(),
  susScore: metricSummarySchema.nullable(),
  tamPerceivedUsefulness: metricSummarySchema.nullable(),
  tamPerceivedEaseOfUse: metricSummarySchema.nullable(),
})
export type ConditionAnalytics = z.infer<typeof conditionAnalyticsSchema>

export const analyticsResponseSchema = z.object({
  conditions: z.array(conditionAnalyticsSchema),
  generatedAt: isoDateTimeSchema,
})
export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>

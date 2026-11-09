import { z } from 'zod'
import { isoDateTimeSchema, uuidSchema } from './common'
import { TUTORING_SESSION_STATUSES } from './constants'

export const tutoringSessionStatusSchema = z.enum(TUTORING_SESSION_STATUSES)
export type TutoringSessionStatus = z.infer<typeof tutoringSessionStatusSchema>

/** Independent variables of the experiment; fixed for the lifetime of a session. */
export const experimentalConditionSchema = z.object({
  ragEnabled: z.boolean().default(true),
  avatarEnabled: z.boolean().default(true),
})
export type ExperimentalCondition = z.infer<typeof experimentalConditionSchema>

export const createTutoringSessionSchema = experimentalConditionSchema.extend({
  title: z.string().trim().min(1).max(200),
  // Room versions ≤ 11 use `!opaque:server`; v12+ (MSC4291) drops the server part.
  matrixRoomId: z
    .string()
    .regex(/^![A-Za-z0-9._~+/=-]+(:[^\s]+)?$/, 'Expected a Matrix room ID like !abc:server or !abc')
    .nullable()
    .default(null),
  /** Omitted → the API uses its configured `OLLAMA_LLM_MODEL`, so the default follows the hardware. */
  llmModel: z.string().trim().min(1).optional(),
})
export type CreateTutoringSession = z.infer<typeof createTutoringSessionSchema>

export const tutoringSessionSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  matrixRoomId: z.string().nullable(),
  livekitRoomName: z.string(),
  ragEnabled: z.boolean(),
  avatarEnabled: z.boolean(),
  llmModel: z.string(),
  status: tutoringSessionStatusSchema,
  startedAt: isoDateTimeSchema.nullable(),
  endedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
})
export type TutoringSession = z.infer<typeof tutoringSessionSchema>

export const listTutoringSessionsQuerySchema = z.object({
  status: tutoringSessionStatusSchema.optional(),
})
export type ListTutoringSessionsQuery = z.infer<typeof listTutoringSessionsQuerySchema>

export const createLivekitTokenSchema = z.object({
  participantName: z.string().trim().min(1).max(100),
})
export type CreateLivekitToken = z.infer<typeof createLivekitTokenSchema>

export const livekitTokenSchema = z.object({
  token: z.string(),
  serverUrl: z.string(),
  roomName: z.string(),
  agentDispatched: z.boolean(),
})
export type LivekitToken = z.infer<typeof livekitTokenSchema>

/** MSC4195 LiveKit focus advertised in a MatrixRTC membership. */
export const livekitFocusSchema = z.looseObject({
  type: z.literal('livekit'),
  livekit_service_url: z.string(),
  livekit_alias: z.string().optional(),
})

/**
 * MSC4143 `m.call.member` state event as forwarded by the homeserver webhook.
 * Empty `content` means the member left the call.
 */
export const matrixCallMemberEventSchema = z.object({
  type: z.enum(['m.call.member', 'org.matrix.msc3401.call.member']),
  room_id: z.string(),
  sender: z.string(),
  state_key: z.string(),
  origin_server_ts: z.number().int(),
  content: z.looseObject({
    application: z.string().optional(),
    call_id: z.string().optional(),
    device_id: z.string().optional(),
    focus_active: z.looseObject({ type: z.string() }).optional(),
    foci_preferred: z
      .array(z.union([livekitFocusSchema, z.looseObject({ type: z.string() })]))
      .optional(),
  }),
})
export type MatrixCallMemberEvent = z.infer<typeof matrixCallMemberEventSchema>

export const MATRIX_WEBHOOK_ACTIONS = ['dispatched', 'member_left', 'ignored'] as const

export const matrixWebhookResultSchema = z.object({
  action: z.enum(MATRIX_WEBHOOK_ACTIONS),
  sessionId: uuidSchema.nullable(),
  reason: z.string().optional(),
})
export type MatrixWebhookResult = z.infer<typeof matrixWebhookResultSchema>

/** Metadata the API attaches to a LiveKit agent dispatch; the worker parses it on job start. */
export const agentDispatchMetadataSchema = z.object({ sessionId: uuidSchema })
export type AgentDispatchMetadata = z.infer<typeof agentDispatchMetadataSchema>

/** Matrix Application Service transaction pushed by the homeserver (Matrix AS API v1). */
export const matrixTransactionSchema = z.object({
  events: z.array(z.looseObject({ type: z.string() })),
})
export type MatrixTransaction = z.infer<typeof matrixTransactionSchema>

export const matrixTransactionParamsSchema = z.object({ txnId: z.string().min(1) })

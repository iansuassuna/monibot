import { z } from 'zod'
import { isoDateTimeSchema, uuidSchema } from './common'
import {
  AGENT_MATRIX_MEMBERSHIP_OUTCOMES,
  AGENT_PRESENCE_STATES,
  TUTORING_SESSION_STATUSES,
} from './constants'

export const tutoringSessionStatusSchema = z.enum(TUTORING_SESSION_STATUSES)
export type TutoringSessionStatus = z.infer<typeof tutoringSessionStatusSchema>

/** Independent variables of the experiment; fixed for the lifetime of a session. */
export const experimentalConditionSchema = z.object({
  ragEnabled: z.boolean().default(true),
  avatarEnabled: z.boolean().default(true),
})
export type ExperimentalCondition = z.infer<typeof experimentalConditionSchema>

export const createTutoringSessionSchema = experimentalConditionSchema
  .extend({
    title: z.string().trim().min(1).max(200),
    // Room versions ≤ 11 use `!opaque:server`; v12+ (MSC4291) drops the server part.
    matrixRoomId: z
      .string()
      .regex(
        /^![A-Za-z0-9._~+/=-]+(:[^\s]+)?$/,
        'Expected a Matrix room ID like !abc:server or !abc'
      )
      .nullable()
      .default(null),
    /** Omitted → the API uses its configured `OLLAMA_LLM_MODEL`, so the default follows the hardware. */
    llmModel: z.string().trim().min(1).optional(),
    /**
     * Element Call's shared E2EE key (the call link's `password`), so the agent can decrypt the
     * students and encrypt its own audio. Write-only: stored encrypted, never returned.
     */
    e2eeSharedKey: z.string().min(1).max(512).nullable().default(null),
  })
  .refine((input) => input.e2eeSharedKey === null || input.matrixRoomId !== null, {
    message: 'An E2EE key only applies to a session linked to a Matrix room',
    path: ['e2eeSharedKey'],
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
  /** Whether the session holds an Element Call E2EE key (the key itself is never exposed). */
  e2eeEnabled: z.boolean(),
})
export type TutoringSession = z.infer<typeof tutoringSessionSchema>

/** Agent-only: the session's Element Call E2EE key, or null for an unencrypted call. */
export const agentE2eeKeySchema = z.object({ sharedKey: z.string().min(1).nullable() })
export type AgentE2eeKey = z.infer<typeof agentE2eeKeySchema>

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
export type LivekitFocus = z.infer<typeof livekitFocusSchema>

/** One entry of `GET /_matrix/client/v3/rooms/{roomId}/state` (Matrix client-server API). */
export const matrixStateEventSchema = z.looseObject({
  type: z.string(),
  sender: z.string(),
  state_key: z.string(),
  content: z.record(z.string(), z.unknown()),
})
export type MatrixStateEvent = z.infer<typeof matrixStateEventSchema>

/**
 * MSC4143 `m.call.member` state event as forwarded by the homeserver webhook.
 * Empty `content` means the member left the call.
 */
export const matrixCallMemberEventSchema = z.object({
  type: z.enum(['m.call.member', 'org.matrix.msc3401.call.member']),
  /** Always set by the homeserver in appservice transactions; absent in hand-made webhook calls. */
  event_id: z.string().optional(),
  room_id: z.string(),
  sender: z.string(),
  state_key: z.string(),
  origin_server_ts: z.number().int(),
  content: z.looseObject({
    application: z.string().optional(),
    call_id: z.string().optional(),
    device_id: z.string().optional(),
    /** LiveKit participant identity the member connects with (Element Call, `multi_sfu`). */
    membershipID: z.string().optional(),
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
export const agentDispatchMetadataSchema = z.object({
  sessionId: uuidSchema,
  /**
   * LiveKit identity the agent must join with. Set for Matrix sessions, where Element Call shows
   * a participant only if its identity matches a MatrixRTC membership; absent → SDK default.
   */
  participantIdentity: z.string().min(1).optional(),
})
export type AgentDispatchMetadata = z.infer<typeof agentDispatchMetadataSchema>

export const agentPresenceStateSchema = z.enum(AGENT_PRESENCE_STATES)
export type AgentPresenceState = z.infer<typeof agentPresenceStateSchema>

/** Worker → API: the agent joined, is still in, or left the session's LiveKit room. */
export const agentPresenceSchema = z.object({ state: agentPresenceStateSchema })
export type AgentPresence = z.infer<typeof agentPresenceSchema>

/** What the API did with the agent's MatrixRTC membership for a presence report. */
export const agentPresenceResultSchema = z.object({
  matrixMembership: z.enum(AGENT_MATRIX_MEMBERSHIP_OUTCOMES),
})
export type AgentPresenceResult = z.infer<typeof agentPresenceResultSchema>

/** Matrix Application Service transaction pushed by the homeserver (Matrix AS API v1). */
export const matrixTransactionSchema = z.object({
  events: z.array(z.looseObject({ type: z.string() })),
})
export type MatrixTransaction = z.infer<typeof matrixTransactionSchema>

export const matrixTransactionParamsSchema = z.object({ txnId: z.string().min(1) })

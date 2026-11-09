import {
  DEFAULT_LLM_MODEL,
  type RetrievedChunkRef,
  TUTORING_SESSION_STATUSES,
} from '@monibot/types'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const tutoringSessionStatusEnum = pgEnum(
  'tutoring_session_status',
  TUTORING_SESSION_STATUSES
)

export const tutoringSessions = pgTable(
  'tutoring_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    matrixRoomId: text('matrix_room_id'),
    // Not unique: lk-jwt-service derives the LiveKit room from the Matrix room alone, so successive
    // sessions in one Matrix room share it. Dispatch metadata carries the session id instead.
    livekitRoomName: text('livekit_room_name').notNull(),
    ragEnabled: boolean('rag_enabled').notNull().default(true),
    avatarEnabled: boolean('avatar_enabled').notNull().default(true),
    llmModel: text('llm_model').notNull().default(DEFAULT_LLM_MODEL),
    /**
     * Element Call shared E2EE key, sealed by the API (never plaintext); cleared when the session
     * ends. Null for unencrypted or non-Matrix sessions.
     */
    e2eeKeyCiphertext: text('e2ee_key_ciphertext'),
    status: tutoringSessionStatusEnum('status').notNull().default('scheduled'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tutoring_sessions_matrix_room_id_idx').on(table.matrixRoomId),
    index('tutoring_sessions_condition_idx').on(table.ragEnabled, table.avatarEnabled),
  ]
)

export const interactionLogs = pgTable(
  'interaction_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => tutoringSessions.id, { onDelete: 'cascade' }),
    studentTranscript: text('student_transcript').notNull(),
    retrievedChunks: jsonb('retrieved_chunks').$type<RetrievedChunkRef[]>().notNull().default([]),
    agentResponse: text('agent_response').notNull(),
    sttLatencyMs: integer('stt_latency_ms').notNull(),
    ragLatencyMs: integer('rag_latency_ms').notNull(),
    llmTtftMs: integer('llm_ttft_ms').notNull(),
    llmTotalLatencyMs: integer('llm_total_latency_ms').notNull(),
    ttsLatencyMs: integer('tts_latency_ms').notNull(),
    totalE2eLatencyMs: integer('total_e2e_latency_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('interaction_logs_session_id_idx').on(table.sessionId, table.createdAt)]
)

export type TutoringSessionRow = typeof tutoringSessions.$inferSelect
export type NewTutoringSessionRow = typeof tutoringSessions.$inferInsert
export type InteractionLogRow = typeof interactionLogs.$inferSelect
export type NewInteractionLogRow = typeof interactionLogs.$inferInsert

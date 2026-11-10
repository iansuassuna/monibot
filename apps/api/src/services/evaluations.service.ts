import { getDb, interactionLogs, tutoringSessions, userEvaluations } from '@monibot/db'
import type { CreateUserEvaluation, UserEvaluation } from '@monibot/types'
import { and, asc, eq } from 'drizzle-orm'
import { HttpError } from '../lib/http-error'
import { getSessionRow } from './sessions.service'
import { calculateSusScore, meanLikert } from './sus-scoring.service'

export async function createEvaluation(
  input: CreateUserEvaluation,
  userId: string
): Promise<UserEvaluation> {
  const db = getDb()
  const session = await getSessionRow(input.sessionId)
  if (!session.avatarEnabled && input.avatarNaturalnessScore !== null) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'avatarNaturalnessScore must be null for an audio-only session'
    )
  }

  const [existing] = await db
    .select({ id: userEvaluations.id })
    .from(userEvaluations)
    .where(and(eq(userEvaluations.sessionId, session.id), eq(userEvaluations.userId, userId)))
  if (existing) {
    throw new HttpError(409, 'CONFLICT', 'You have already evaluated this session')
  }

  const [row] = await db
    .insert(userEvaluations)
    .values({
      sessionId: session.id,
      userId,
      susAnswers: input.susAnswers,
      susCalculatedScore: calculateSusScore(input.susAnswers),
      tamPerceivedUsefulness: meanLikert(input.tamPerceivedUsefulnessAnswers),
      tamPerceivedEaseOfUse: meanLikert(input.tamPerceivedEaseOfUseAnswers),
      avatarNaturalnessScore: input.avatarNaturalnessScore,
      comments: input.comments,
    })
    .returning()
  if (!row) throw new Error('Insert into user_evaluations returned no row')
  return { ...row, createdAt: row.createdAt.toISOString() }
}

/** One row per evaluation, with the session's experimental condition and each SUS item. */
export async function exportEvaluationRows() {
  const rows = await getDb()
    .select({
      evaluationId: userEvaluations.id,
      sessionId: tutoringSessions.id,
      sessionTitle: tutoringSessions.title,
      ragEnabled: tutoringSessions.ragEnabled,
      avatarEnabled: tutoringSessions.avatarEnabled,
      llmModel: tutoringSessions.llmModel,
      callClient: tutoringSessions.callClient,
      userId: userEvaluations.userId,
      susAnswers: userEvaluations.susAnswers,
      susScore: userEvaluations.susCalculatedScore,
      tamPerceivedUsefulness: userEvaluations.tamPerceivedUsefulness,
      tamPerceivedEaseOfUse: userEvaluations.tamPerceivedEaseOfUse,
      avatarNaturalnessScore: userEvaluations.avatarNaturalnessScore,
      comments: userEvaluations.comments,
      createdAt: userEvaluations.createdAt,
    })
    .from(userEvaluations)
    .innerJoin(tutoringSessions, eq(userEvaluations.sessionId, tutoringSessions.id))
    .orderBy(asc(userEvaluations.createdAt))

  return rows.map(({ susAnswers, createdAt, ...row }) => ({
    ...row,
    sus1: susAnswers[0] ?? null,
    sus2: susAnswers[1] ?? null,
    sus3: susAnswers[2] ?? null,
    sus4: susAnswers[3] ?? null,
    sus5: susAnswers[4] ?? null,
    sus6: susAnswers[5] ?? null,
    sus7: susAnswers[6] ?? null,
    sus8: susAnswers[7] ?? null,
    sus9: susAnswers[8] ?? null,
    sus10: susAnswers[9] ?? null,
    createdAt: createdAt.toISOString(),
  }))
}

export const EVALUATION_EXPORT_COLUMNS = [
  'evaluationId',
  'sessionId',
  'sessionTitle',
  'ragEnabled',
  'avatarEnabled',
  'llmModel',
  'callClient',
  'userId',
  'sus1',
  'sus2',
  'sus3',
  'sus4',
  'sus5',
  'sus6',
  'sus7',
  'sus8',
  'sus9',
  'sus10',
  'susScore',
  'tamPerceivedUsefulness',
  'tamPerceivedEaseOfUse',
  'avatarNaturalnessScore',
  'comments',
  'createdAt',
] as const

/** One row per voice turn, with the session's experimental condition and all latencies. */
export async function exportInteractionRows() {
  const rows = await getDb()
    .select({
      interactionId: interactionLogs.id,
      sessionId: tutoringSessions.id,
      ragEnabled: tutoringSessions.ragEnabled,
      avatarEnabled: tutoringSessions.avatarEnabled,
      llmModel: tutoringSessions.llmModel,
      callClient: tutoringSessions.callClient,
      studentTranscript: interactionLogs.studentTranscript,
      agentResponse: interactionLogs.agentResponse,
      retrievedChunks: interactionLogs.retrievedChunks,
      sttLatencyMs: interactionLogs.sttLatencyMs,
      ragLatencyMs: interactionLogs.ragLatencyMs,
      llmTtftMs: interactionLogs.llmTtftMs,
      llmTotalLatencyMs: interactionLogs.llmTotalLatencyMs,
      ttsLatencyMs: interactionLogs.ttsLatencyMs,
      totalE2eLatencyMs: interactionLogs.totalE2eLatencyMs,
      createdAt: interactionLogs.createdAt,
    })
    .from(interactionLogs)
    .innerJoin(tutoringSessions, eq(interactionLogs.sessionId, tutoringSessions.id))
    .orderBy(asc(interactionLogs.createdAt))

  return rows.map(({ retrievedChunks, createdAt, ...row }) => ({
    ...row,
    retrievedChunkCount: retrievedChunks.length,
    topChunkScore: retrievedChunks[0]?.score ?? null,
    createdAt: createdAt.toISOString(),
  }))
}

export const INTERACTION_EXPORT_COLUMNS = [
  'interactionId',
  'sessionId',
  'ragEnabled',
  'avatarEnabled',
  'llmModel',
  'callClient',
  'studentTranscript',
  'agentResponse',
  'retrievedChunkCount',
  'topChunkScore',
  'sttLatencyMs',
  'ragLatencyMs',
  'llmTtftMs',
  'llmTotalLatencyMs',
  'ttsLatencyMs',
  'totalE2eLatencyMs',
  'createdAt',
] as const

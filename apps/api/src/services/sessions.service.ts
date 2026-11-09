import { getDb, type TutoringSessionRow, tutoringSessions } from '@monibot/db'
import type {
  AgentE2eeKey,
  CreateTutoringSession,
  ListTutoringSessionsQuery,
  TutoringSession,
} from '@monibot/types'
import { desc, eq } from 'drizzle-orm'
import { env } from '../env'
import { HttpError, notFound } from '../lib/http-error'
import { openSecret, sealSecret } from '../lib/secret-box'
import { retireSessionAgent } from './livekit.service'

export const toTutoringSession = (row: TutoringSessionRow): TutoringSession => ({
  id: row.id,
  title: row.title,
  matrixRoomId: row.matrixRoomId,
  livekitRoomName: row.livekitRoomName,
  ragEnabled: row.ragEnabled,
  avatarEnabled: row.avatarEnabled,
  llmModel: row.llmModel,
  status: row.status,
  startedAt: row.startedAt?.toISOString() ?? null,
  endedAt: row.endedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  e2eeEnabled: row.e2eeKeyCiphertext !== null,
})

export async function createSession(input: CreateTutoringSession): Promise<TutoringSession> {
  const { e2eeSharedKey, ...fields } = input
  const [row] = await getDb()
    .insert(tutoringSessions)
    .values({
      ...fields,
      llmModel: input.llmModel ?? env.OLLAMA_LLM_MODEL,
      livekitRoomName: `monibot-${crypto.randomUUID()}`,
      e2eeKeyCiphertext: e2eeSharedKey ? await sealSecret(e2eeSharedKey, env.AGENT_SECRET) : null,
    })
    .returning()
  if (!row) throw new Error('Insert into tutoring_sessions returned no row')
  return toTutoringSession(row)
}

export async function listSessions(query: ListTutoringSessionsQuery): Promise<TutoringSession[]> {
  const rows = await getDb()
    .select()
    .from(tutoringSessions)
    .where(query.status ? eq(tutoringSessions.status, query.status) : undefined)
    .orderBy(desc(tutoringSessions.createdAt))
  return rows.map(toTutoringSession)
}

export async function getSessionRow(id: string): Promise<TutoringSessionRow> {
  const [row] = await getDb().select().from(tutoringSessions).where(eq(tutoringSessions.id, id))
  if (!row) throw notFound('Tutoring session')
  return row
}

export async function getSession(id: string): Promise<TutoringSession> {
  return toTutoringSession(await getSessionRow(id))
}

/**
 * The session's Element Call E2EE key for the agent. The key is sealed with `AGENT_SECRET`, so
 * rotating that secret makes keys of open sessions unreadable (they are cleared at session end).
 */
export async function getAgentE2eeKey(id: string): Promise<AgentE2eeKey> {
  const row = await getSessionRow(id)
  if (row.e2eeKeyCiphertext === null) return { sharedKey: null }
  try {
    return { sharedKey: await openSecret(row.e2eeKeyCiphertext, env.AGENT_SECRET) }
  } catch (error) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Stored E2EE key cannot be decrypted', undefined, {
      cause: error,
    })
  }
}

export async function findSessionsByMatrixRoom(matrixRoomId: string) {
  return getDb()
    .select()
    .from(tutoringSessions)
    .where(eq(tutoringSessions.matrixRoomId, matrixRoomId))
    .orderBy(desc(tutoringSessions.createdAt))
}

/** Moves a `scheduled` session to `active`; an already active session is left unchanged. */
export async function markSessionActive(row: TutoringSessionRow): Promise<TutoringSessionRow> {
  if (row.status === 'ended') throw new HttpError(409, 'CONFLICT', 'Tutoring session has ended')
  if (row.status === 'active') return row
  const [updated] = await getDb()
    .update(tutoringSessions)
    .set({ status: 'active', startedAt: new Date() })
    .where(eq(tutoringSessions.id, row.id))
    .returning()
  return updated ?? row
}

export async function endSession(id: string): Promise<TutoringSession> {
  const row = await getSessionRow(id)
  if (row.status === 'ended') return toTutoringSession(row)
  const [updated] = await getDb()
    .update(tutoringSessions)
    // The call key is only needed while the agent is in the call.
    .set({ status: 'ended', endedAt: new Date(), e2eeKeyCiphertext: null })
    .where(eq(tutoringSessions.id, id))
    .returning()
  await retireSessionAgent(row.livekitRoomName, id)
  return toTutoringSession(updated ?? row)
}

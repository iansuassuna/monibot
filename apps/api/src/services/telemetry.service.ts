import { getDb, interactionLogs } from '@monibot/db'
import type { InteractionLog, InteractionLogCreate } from '@monibot/types'
import { HttpError } from '../lib/http-error'
import { getSessionRow } from './sessions.service'

/** Persists one voice turn reported by the agent worker. */
export async function recordInteraction(input: InteractionLogCreate): Promise<InteractionLog> {
  const session = await getSessionRow(input.sessionId)
  if (!session.ragEnabled && (input.ragLatencyMs !== 0 || input.retrievedChunks.length > 0)) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'Session has ragEnabled = false: ragLatencyMs must be 0 and retrievedChunks empty'
    )
  }

  const [row] = await getDb().insert(interactionLogs).values(input).returning()
  if (!row) throw new Error('Insert into interaction_logs returned no row')
  return { ...row, createdAt: row.createdAt.toISOString() }
}

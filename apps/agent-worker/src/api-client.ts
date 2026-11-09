import {
  type InteractionLogCreate,
  interactionLogSchema,
  type RetrieveRequest,
  type RetrieveResponse,
  retrieveResponseSchema,
  type TutoringSession,
  tutoringSessionSchema,
} from '@monibot/types'
import { z } from 'zod'
import { env } from './env'
import { TelemetryRejectedError } from './telemetry-reporter'

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

const REQUEST_TIMEOUT_MS = 10_000
const successEnvelopeSchema = z.object({ success: z.literal(true), data: z.unknown() })

async function request<Schema extends z.ZodType>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  schema: Schema
): Promise<z.output<Schema>> {
  const response = await fetch(new URL(path, env.API_INTERNAL_URL), {
    method: init.method,
    headers: { 'content-type': 'application/json', 'x-agent-secret': env.AGENT_SECRET },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      `API ${init.method} ${path} failed with ${response.status}: ${JSON.stringify(body)}`
    )
  }
  const envelope = successEnvelopeSchema.parse(body)
  return schema.parse(envelope.data)
}

export function fetchSession(sessionId: string): Promise<TutoringSession> {
  return request(`/api/sessions/${sessionId}`, { method: 'GET' }, tutoringSessionSchema)
}

export function retrieveChunks(input: RetrieveRequest): Promise<RetrieveResponse> {
  return request('/api/knowledge/retrieve', { method: 'POST', body: input }, retrieveResponseSchema)
}

/** Uploads one turn; a 4xx response means the payload itself is invalid and is not retryable. */
export async function sendInteractionLog(log: InteractionLogCreate): Promise<void> {
  try {
    await request('/api/telemetry/logs', { method: 'POST', body: log }, interactionLogSchema)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
      throw new TelemetryRejectedError(error.status, error.message)
    }
    throw error
  }
}

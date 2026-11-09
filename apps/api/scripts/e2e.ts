/**
 * End-to-end check of the running API against a real Postgres.
 *
 * Usage: bun --env-file=../../.env scripts/e2e.ts
 * Env: API_BASE_URL (default http://localhost:$API_PORT), AGENT_SECRET, MATRIX_WEBHOOK_SECRET,
 * DATABASE_URL, WEB_ORIGIN, E2E_REPORT_PATH (optional JSON report path), MATRIX_BOT_USER_ID
 * (default @monibot:localhost).
 *
 * Ollama and LiveKit may be offline: the endpoints that need them must then fail with
 * 503 UPSTREAM_UNAVAILABLE, which is asserted instead of the happy path.
 */
import { createDb, tutoringSessions, users } from '@monibot/db'
import { createLogger } from '@monibot/logger'
import { eq } from 'drizzle-orm'

const logger = createLogger('ApiE2E')

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const baseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`
const agentSecret = required('AGENT_SECRET')
const matrixSecret = required('MATRIX_WEBHOOK_SECRET')
const botUserId = process.env.MATRIX_BOT_USER_ID ?? '@monibot:localhost'
const webOrigin = required('WEB_ORIGIN')
const db = createDb(required('DATABASE_URL'), { max: 1 })

interface CheckResult {
  name: string
  ok: boolean
  status?: number
  durationMs: number
  error?: string
}

const results: CheckResult[] = []

async function check(name: string, run: () => Promise<number | undefined>) {
  const start = performance.now()
  try {
    const status = await run()
    results.push({ name, ok: true, status, durationMs: Math.round(performance.now() - start) })
    logger.info(`PASS ${name}`, { status })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    results.push({
      name,
      ok: false,
      durationMs: Math.round(performance.now() - start),
      error: message,
    })
    logger.error(`FAIL ${name}`, { error: message })
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

interface CallOptions {
  method?: string
  body?: unknown
  cookie?: string
  headers?: Record<string, string>
}

async function call(path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { origin: webOrigin, ...options.headers }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.cookie) headers.cookie = options.cookie
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { response, status: response.status, json, text }
}

function expectEnvelopeError(json: unknown, code: string) {
  const body = json as { success?: unknown; error?: { code?: unknown; message?: unknown } }
  assert(body?.success === false, `expected success=false, got ${JSON.stringify(json)}`)
  assert(body.error?.code === code, `expected code ${code}, got ${String(body.error?.code)}`)
  assert(typeof body.error.message === 'string', 'error.message must be a string')
}

function dataOf<T>(json: unknown): T {
  const body = json as { success?: unknown; data?: T }
  assert(body?.success === true, `expected success=true, got ${JSON.stringify(json)}`)
  return body.data as T
}

async function signUp(role: 'student' | 'researcher') {
  const email = `e2e-${role}-${crypto.randomUUID()}@monibot.test`
  const { response, status, text } = await call('/api/auth/sign-up/email', {
    body: { email, password: 'e2e-password-123', name: `E2E ${role}` },
  })
  assert(status === 200, `sign-up returned ${status}: ${text}`)
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  assert(cookie, 'sign-up did not set a session cookie')
  if (role === 'researcher') {
    await db.update(users).set({ role: 'researcher' }).where(eq(users.email, email))
  }
  return cookie
}

let researcher = ''
let student = ''
let ragSessionId = ''
let audioOnlySessionId = ''
const matrixRoomId = `!e2e${crypto.randomUUID().slice(0, 8)}:monibot.test`

await check('health responds with the success envelope', async () => {
  const { status, json } = await call('/api/health')
  assert(status === 200, `status ${status}`)
  assert(dataOf<{ status: string }>(json).status === 'ok', 'status field')
  return status
})

await check('unknown route returns 404 NOT_FOUND envelope', async () => {
  const { status, json } = await call('/api/does-not-exist')
  assert(status === 404, `status ${status}`)
  expectEnvelopeError(json, 'NOT_FOUND')
  return status
})

await check('protected route without a session returns 401 UNAUTHORIZED', async () => {
  const { status, json } = await call('/api/sessions')
  assert(status === 401, `status ${status}`)
  expectEnvelopeError(json, 'UNAUTHORIZED')
  return status
})

await check('Better Auth sign-up issues sessions for a student and a researcher', async () => {
  student = await signUp('student')
  researcher = await signUp('researcher')
  return 200
})

await check('student cannot create a session (403 FORBIDDEN)', async () => {
  const { status, json } = await call('/api/sessions', { cookie: student, body: { title: 'x' } })
  assert(status === 403, `status ${status}`)
  expectEnvelopeError(json, 'FORBIDDEN')
  return status
})

await check('invalid session payload returns 400 VALIDATION_ERROR with details', async () => {
  const { status, json } = await call('/api/sessions', {
    cookie: researcher,
    body: { title: '', ragEnabled: 'yes' },
  })
  assert(status === 400, `status ${status}`)
  expectEnvelopeError(json, 'VALIDATION_ERROR')
  assert(Array.isArray((json as { error: { details?: unknown } }).error.details), 'details array')
  return status
})

await check('researcher creates sessions with explicit experimental flags', async () => {
  const rag = await call('/api/sessions', {
    cookie: researcher,
    body: { title: 'E2E RAG + avatar', matrixRoomId },
  })
  assert(rag.status === 201, `status ${rag.status}: ${rag.text}`)
  const ragSession = dataOf<{
    id: string
    ragEnabled: boolean
    avatarEnabled: boolean
    status: string
  }>(rag.json)
  assert(ragSession.ragEnabled && ragSession.avatarEnabled, 'defaults must be true/true')
  assert(ragSession.status === 'scheduled', 'new session must be scheduled')
  ragSessionId = ragSession.id

  const audio = await call('/api/sessions', {
    cookie: researcher,
    body: { title: 'E2E LLM only, audio only', ragEnabled: false, avatarEnabled: false },
  })
  assert(audio.status === 201, `status ${audio.status}`)
  const audioSession = dataOf<{ id: string; ragEnabled: boolean; avatarEnabled: boolean }>(
    audio.json
  )
  assert(!audioSession.ragEnabled && !audioSession.avatarEnabled, 'flags must persist as false')
  audioOnlySessionId = audioSession.id
  return audio.status
})

await check('student lists sessions', async () => {
  const { status, json } = await call('/api/sessions', { cookie: student })
  assert(status === 200, `status ${status}`)
  const ids = dataOf<{ id: string }[]>(json).map((s) => s.id)
  assert(ids.includes(ragSessionId) && ids.includes(audioOnlySessionId), 'created sessions listed')
  return status
})

await check('agent reads session flags with x-agent-secret', async () => {
  const { status, json } = await call(`/api/sessions/${audioOnlySessionId}`, {
    headers: { 'x-agent-secret': agentSecret },
  })
  assert(status === 200, `status ${status}`)
  assert(dataOf<{ ragEnabled: boolean }>(json).ragEnabled === false, 'ragEnabled false')
  return status
})

await check('malformed session id returns 400 VALIDATION_ERROR', async () => {
  const { status, json } = await call('/api/sessions/not-a-uuid', {
    headers: { 'x-agent-secret': agentSecret },
  })
  assert(status === 400, `status ${status}`)
  expectEnvelopeError(json, 'VALIDATION_ERROR')
  return status
})

await check('missing session returns 404 NOT_FOUND', async () => {
  const { status, json } = await call(`/api/sessions/${crypto.randomUUID()}`, {
    headers: { 'x-agent-secret': agentSecret },
  })
  assert(status === 404, `status ${status}`)
  expectEnvelopeError(json, 'NOT_FOUND')
  return status
})

const turn = (sessionId: string, ragLatencyMs: number) => ({
  sessionId,
  studentTranscript: 'Como funciona um laço for?',
  agentResponse: 'O que você acha que acontece a cada repetição?',
  retrievedChunks: [],
  sttLatencyMs: 310,
  ragLatencyMs,
  llmTtftMs: 420,
  llmTotalLatencyMs: 1800,
  ttsLatencyMs: 150,
  totalE2eLatencyMs: 980,
})

await check('telemetry rejects a wrong agent secret (401)', async () => {
  const { status, json } = await call('/api/telemetry/logs', {
    headers: { 'x-agent-secret': 'wrong-secret' },
    body: turn(ragSessionId, 40),
  })
  assert(status === 401, `status ${status}`)
  expectEnvelopeError(json, 'UNAUTHORIZED')
  return status
})

await check('telemetry persists turns for both RAG conditions', async () => {
  for (const [sessionId, ragLatencyMs] of [
    [ragSessionId, 40],
    [ragSessionId, 60],
    [audioOnlySessionId, 0],
  ] as const) {
    const { status, text } = await call('/api/telemetry/logs', {
      headers: { 'x-agent-secret': agentSecret },
      body: turn(sessionId, ragLatencyMs),
    })
    assert(status === 201, `status ${status}: ${text}`)
  }
  return 201
})

await check('telemetry enforces ragLatencyMs = 0 when RAG is disabled (422)', async () => {
  const { status, json } = await call('/api/telemetry/logs', {
    headers: { 'x-agent-secret': agentSecret },
    body: turn(audioOnlySessionId, 55),
  })
  assert(status === 422, `status ${status}`)
  expectEnvelopeError(json, 'VALIDATION_ERROR')
  return status
})

await check('student submits SUS/TAM evaluation and gets the official SUS score', async () => {
  const { status, json, text } = await call('/api/evaluations', {
    cookie: student,
    body: {
      sessionId: ragSessionId,
      susAnswers: [4, 2, 4, 2, 4, 2, 4, 2, 4, 2],
      tamPerceivedUsefulnessAnswers: [5, 4],
      tamPerceivedEaseOfUseAnswers: [3, 4, 5],
      avatarNaturalnessScore: 4,
    },
  })
  assert(status === 201, `status ${status}: ${text}`)
  const evaluation = dataOf<{ susCalculatedScore: number; tamPerceivedUsefulness: number }>(json)
  assert(evaluation.susCalculatedScore === 75, `SUS ${evaluation.susCalculatedScore}`)
  assert(evaluation.tamPerceivedUsefulness === 4.5, `TAM PU ${evaluation.tamPerceivedUsefulness}`)
  return status
})

await check('duplicate evaluation by the same student returns 409 CONFLICT', async () => {
  const { status, json } = await call('/api/evaluations', {
    cookie: student,
    body: {
      sessionId: ragSessionId,
      susAnswers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      tamPerceivedUsefulnessAnswers: [3],
      tamPerceivedEaseOfUseAnswers: [3],
    },
  })
  assert(status === 409, `status ${status}`)
  expectEnvelopeError(json, 'CONFLICT')
  return status
})

await check('avatar score on an audio-only session returns 422', async () => {
  const { status, json } = await call('/api/evaluations', {
    cookie: student,
    body: {
      sessionId: audioOnlySessionId,
      susAnswers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      tamPerceivedUsefulnessAnswers: [3],
      tamPerceivedEaseOfUseAnswers: [3],
      avatarNaturalnessScore: 5,
    },
  })
  assert(status === 422, `status ${status}`)
  expectEnvelopeError(json, 'VALIDATION_ERROR')
  return status
})

await check('analytics returns all four design cells with aggregates', async () => {
  const { status, json } = await call('/api/telemetry/analytics', { cookie: researcher })
  assert(status === 200, `status ${status}`)
  const { conditions } = dataOf<{
    conditions: {
      ragEnabled: boolean
      avatarEnabled: boolean
      turnCount: number
      latency: Record<string, { mean: number; p50: number; p95: number; stdDev: number }> | null
      susScore: { mean: number } | null
    }[]
  }>(json)
  assert(conditions.length === 4, `cells ${conditions.length}`)
  const ragCell = conditions.find((c) => c.ragEnabled && c.avatarEnabled)
  const audioCell = conditions.find((c) => !c.ragEnabled && !c.avatarEnabled)
  assert(ragCell?.latency && ragCell.turnCount >= 2, 'RAG cell has turns')
  assert(typeof ragCell.latency.ragLatencyMs?.p95 === 'number', 'p95 is numeric')
  assert(ragCell.susScore !== null, 'RAG cell has SUS aggregate')
  assert(audioCell?.latency?.ragLatencyMs?.mean === 0, 'audio-only cell has 0 RAG latency')
  return status
})

await check('student cannot read analytics (403)', async () => {
  const { status, json } = await call('/api/telemetry/analytics', { cookie: student })
  assert(status === 403, `status ${status}`)
  expectEnvelopeError(json, 'FORBIDDEN')
  return status
})

await check('export returns CSV evaluations and JSON interactions', async () => {
  const csv = await call('/api/evaluations/export?dataset=evaluations&format=csv', {
    cookie: researcher,
  })
  assert(csv.status === 200, `status ${csv.status}`)
  assert(csv.response.headers.get('content-type')?.startsWith('text/csv'), 'csv content-type')
  assert(csv.text.startsWith('evaluationId,sessionId,'), 'csv header')
  const json = await call('/api/evaluations/export?dataset=interactions&format=json', {
    cookie: researcher,
  })
  assert(json.status === 200, `status ${json.status}`)
  assert(dataOf<unknown[]>(json.json).length >= 3, 'interaction rows')
  return json.status
})

await check('matrix webhook rejects a wrong token (401)', async () => {
  const { status, json } = await call('/api/sessions/matrix-webhook', {
    headers: { authorization: 'Bearer wrong' },
    body: {},
  })
  assert(status === 401, `status ${status}`)
  expectEnvelopeError(json, 'UNAUTHORIZED')
  return status
})

const memberEvent = (roomId: string) => ({
  type: 'm.call.member',
  room_id: roomId,
  sender: '@aluno:monibot.test',
  state_key: '_@aluno:monibot.test_DEVICE',
  origin_server_ts: Date.now(),
  content: {
    application: 'm.call',
    call_id: '',
    device_id: 'DEVICE',
    focus_active: { type: 'livekit', focus_selection: 'oldest_membership' },
    foci_preferred: [{ type: 'livekit', livekit_service_url: 'https://lk-jwt.monibot.test' }],
  },
})

await check('matrix webhook ignores rooms without an open session', async () => {
  const { status, json } = await call('/api/sessions/matrix-webhook', {
    headers: { authorization: `Bearer ${matrixSecret}` },
    body: memberEvent('!unlinked:monibot.test'),
  })
  assert(status === 200, `status ${status}`)
  assert(dataOf<{ action: string }>(json).action === 'ignored', 'action ignored')
  return status
})

await check('matrix appservice transaction rejects a wrong homeserver token (401)', async () => {
  const { status } = await call('/api/matrix/_matrix/app/v1/transactions/txn-bad', {
    method: 'PUT',
    headers: { authorization: 'Bearer wrong' },
    body: { events: [] },
  })
  assert(status === 401, `status ${status}`)
  return status
})

await check(
  'matrix appservice accepts a transaction batch and answers {} per the Matrix spec',
  async () => {
    const { status, json } = await call(
      `/api/matrix/_matrix/app/v1/transactions/txn-${Date.now()}`,
      {
        method: 'PUT',
        headers: { authorization: `Bearer ${matrixSecret}` },
        body: {
          events: [
            { type: 'm.room.message', room_id: '!x:monibot.test', content: { body: 'oi' } },
            memberEvent('!unlinked:monibot.test'),
          ],
        },
      }
    )
    assert(status === 200, `status ${status}`)
    assert(JSON.stringify(json) === '{}', `body ${JSON.stringify(json)}`)
    return status
  }
)

await check('matrix webhook ignores the agent’s own membership (no dispatch loop)', async () => {
  const { status, json } = await call('/api/sessions/matrix-webhook', {
    headers: { authorization: `Bearer ${matrixSecret}` },
    body: { ...memberEvent(matrixRoomId), sender: botUserId },
  })
  assert(status === 200, `status ${status}`)
  const result = dataOf<{ action: string; reason?: string }>(json)
  assert(result.action === 'ignored', `action ${result.action}`)
  assert(result.reason === 'Own MatrixRTC membership', `reason ${result.reason}`)
  return status
})

await check('agent presence rejects a missing agent secret (401)', async () => {
  const { status, json } = await call(`/api/sessions/${ragSessionId}/agent-presence`, {
    body: { state: 'joined' },
  })
  assert(status === 401, `status ${status}`)
  expectEnvelopeError(json, 'UNAUTHORIZED')
  return status
})

await check('agent presence is a no-op for a session without a Matrix room', async () => {
  const { status, json } = await call(`/api/sessions/${audioOnlySessionId}/agent-presence`, {
    headers: { 'x-agent-secret': agentSecret },
    body: { state: 'joined' },
  })
  assert(status === 200, `status ${status}`)
  const result = dataOf<{ matrixMembership: string }>(json)
  assert(result.matrixMembership === 'not_applicable', `outcome ${result.matrixMembership}`)
  return status
})

await check(
  'agent presence for a room the homeserver cannot join is not_applicable, not 503 (or 503 if Synapse is down)',
  async () => {
    const { status, json } = await call(`/api/sessions/${ragSessionId}/agent-presence`, {
      headers: { 'x-agent-secret': agentSecret },
      body: { state: 'heartbeat' },
    })
    if (status === 503) expectEnvelopeError(json, 'UPSTREAM_UNAVAILABLE')
    else {
      const result = dataOf<{ matrixMembership: string }>(json)
      assert(result.matrixMembership === 'not_applicable', `outcome ${result.matrixMembership}`)
    }
    return status
  }
)

await check(
  'matrix webhook does not dispatch for a member not connected to LiveKit (or 503 if LiveKit is down)',
  async () => {
    const { status, json } = await call('/api/sessions/matrix-webhook', {
      headers: { authorization: `Bearer ${matrixSecret}` },
      body: memberEvent(matrixRoomId),
    })
    if (status === 503) expectEnvelopeError(json, 'UPSTREAM_UNAVAILABLE')
    else {
      const result = dataOf<{ action: string; reason?: string }>(json)
      assert(result.action === 'ignored', `action ${result.action}`)
      assert(result.reason === 'Call member is not connected to LiveKit', `reason ${result.reason}`)
    }
    return status
  }
)

await check(
  'matrix webhook dispatches the agent into the call’s LiveKit room (or 503 if LiveKit is down)',
  async () => {
    const event = memberEvent(matrixRoomId)
    const { status, json } = await call('/api/sessions/matrix-webhook', {
      headers: { authorization: `Bearer ${matrixSecret}` },
      body: {
        ...event,
        content: {
          ...event.content,
          foci_preferred: [
            {
              type: 'livekit',
              livekit_service_url: 'https://lk-jwt.monibot.test',
              livekit_alias: `e2e-call-${crypto.randomUUID().slice(0, 8)}`,
            },
          ],
        },
      },
    })
    if (status === 503) expectEnvelopeError(json, 'UPSTREAM_UNAVAILABLE')
    else assert(dataOf<{ action: string }>(json).action === 'dispatched', 'action dispatched')
    return status
  }
)

await check('LiveKit token endpoint issues a token (or 503 if LiveKit is down)', async () => {
  const { status, json } = await call(`/api/sessions/${ragSessionId}/token`, {
    cookie: student,
    body: { participantName: 'Aluno E2E' },
  })
  if (status === 503) expectEnvelopeError(json, 'UPSTREAM_UNAVAILABLE')
  else assert(typeof dataOf<{ token: string }>(json).token === 'string', 'token string')
  return status
})

await check(
  'document ingestion indexes (or fails visibly with 503 if Ollama is down)',
  async () => {
    const { status, json } = await call('/api/knowledge/documents', {
      cookie: researcher,
      body: {
        title: 'E2E Laços',
        category: 'lecture_slides',
        rawText:
          '# Laços\n\nO for repete um bloco.\n\n```python\nfor i in range(3):\n    print(i)\n```',
      },
    })
    const list = await call('/api/knowledge/documents', { cookie: student })
    const document = dataOf<{ title: string; status: string }[]>(list.json).find(
      (d) => d.title === 'E2E Laços'
    )
    if (status === 503) {
      expectEnvelopeError(json, 'UPSTREAM_UNAVAILABLE')
      assert(document?.status === 'failed', `document status ${document?.status}`)
    } else {
      assert(status === 201, `status ${status}`)
      assert(document?.status === 'indexed', `document status ${document?.status}`)
    }
    return status
  }
)

const callKey = `e2e-${crypto.randomUUID()}`
let encryptedSessionId = ''

await check('an E2EE key without a Matrix room is rejected (400)', async () => {
  const { status, json } = await call('/api/sessions', {
    cookie: researcher,
    body: { title: 'E2E key without room', e2eeSharedKey: callKey },
  })
  assert(status === 400, `status ${status}`)
  expectEnvelopeError(json, 'VALIDATION_ERROR')
  return status
})

await check('an encrypted session never exposes its key and stores it sealed', async () => {
  const { status, json, text } = await call('/api/sessions', {
    cookie: researcher,
    body: {
      title: 'E2E encrypted call',
      matrixRoomId: `${matrixRoomId}e2ee`,
      e2eeSharedKey: callKey,
    },
  })
  assert(status === 201, `status ${status}: ${text}`)
  const session = dataOf<{ id: string; e2eeEnabled: boolean }>(json)
  assert(session.e2eeEnabled, 'e2eeEnabled must be true')
  assert(!text.includes(callKey), 'create response leaks the key')
  encryptedSessionId = session.id
  const list = await call('/api/sessions', { cookie: researcher })
  assert(!list.text.includes(callKey), 'session list leaks the key')
  const [row] = await db
    .select({ sealed: tutoringSessions.e2eeKeyCiphertext })
    .from(tutoringSessions)
    .where(eq(tutoringSessions.id, encryptedSessionId))
  assert(row?.sealed && !row.sealed.includes(callKey), 'key must be stored sealed, not in clear')
  return status
})

await check('the E2EE key endpoint rejects callers without the agent secret (401)', async () => {
  const { status, json } = await call(`/api/sessions/${encryptedSessionId}/e2ee-key`, {
    cookie: researcher,
  })
  assert(status === 401, `status ${status}`)
  expectEnvelopeError(json, 'UNAUTHORIZED')
  return status
})

await check('the agent reads the call key; ending the session erases it', async () => {
  const keyUrl = `/api/sessions/${encryptedSessionId}/e2ee-key`
  const agent = { headers: { 'x-agent-secret': agentSecret } }
  const before = await call(keyUrl, agent)
  assert(before.status === 200, `status ${before.status}`)
  assert(dataOf<{ sharedKey: string | null }>(before.json).sharedKey === callKey, 'key round-trip')
  const ended = await call(`/api/sessions/${encryptedSessionId}/end`, {
    cookie: researcher,
    method: 'POST',
  })
  assert(ended.status === 200, `end status ${ended.status}`)
  const after = await call(keyUrl, agent)
  assert(dataOf<{ sharedKey: string | null }>(after.json).sharedKey === null, 'key must be erased')
  return after.status
})

await check('researcher ends a session', async () => {
  const { status, json } = await call(`/api/sessions/${audioOnlySessionId}/end`, {
    cookie: researcher,
    method: 'POST',
  })
  assert(status === 200, `status ${status}`)
  assert(dataOf<{ status: string }>(json).status === 'ended', 'ended')
  return status
})

// Fixture sessions point at fake Matrix rooms; left open, the web app lists them as joinable and
// their agent cannot publish its Matrix presence. Ended even when checks above failed.
for (const id of [ragSessionId, audioOnlySessionId, encryptedSessionId].filter(Boolean)) {
  const { status } = await call(`/api/sessions/${id}/end`, { cookie: researcher, method: 'POST' })
  if (status !== 200) logger.warn('Could not end an e2e fixture session', { sessionId: id, status })
}

await db.$client.end()

const failed = results.filter((result) => !result.ok)
const report = { baseUrl, passed: results.length - failed.length, failed: failed.length, results }
if (process.env.E2E_REPORT_PATH)
  await Bun.write(process.env.E2E_REPORT_PATH, JSON.stringify(report, null, 2))
logger.info('E2E finished', { passed: report.passed, failed: report.failed })
process.exit(failed.length === 0 ? 0 : 1)

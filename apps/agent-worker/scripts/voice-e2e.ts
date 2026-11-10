/**
 * End-to-end check of one spoken tutoring turn: a scripted student joins the session's call
 * through the real API, speaks a question synthesized by the deployment's own Piper voice, and
 * the run asserts the agent's state transitions, the avatar condition and the persisted telemetry.
 *
 * The student joins the way the session's students do (`callClient`): a direct LiveKit room
 * through `/token`, or a MatrixRTC call like Element Call — call credentials, a Matrix OpenID
 * token exchanged at lk-jwt-service for a LiveKit token, the shared E2EE key, and a published
 * `call.member` that makes the API dispatch the agent.
 *
 * Usage: bun --env-file=../../.env scripts/voice-e2e.ts <sessionId>
 * Env: WEB_ORIGIN (API reached through the web proxy), SPEACHES_BASE_URL, TTS_MODEL,
 * E2E_STUDENT_EMAIL/E2E_STUDENT_PASSWORD, E2E_RESEARCHER_EMAIL/E2E_RESEARCHER_PASSWORD,
 * LK_JWT_URL (default http://127.0.0.1:8080), E2E_QUESTION (optional), E2E_REPORT_PATH (optional
 * JSON report). Requires the API, agent worker, LiveKit, Ollama and speaches; MatrixRTC sessions
 * also Synapse and lk-jwt-service (`bun run demo:up`).
 */
import {
  AudioFrame,
  AudioSource,
  type E2EEOptions,
  LocalAudioTrack,
  ParticipantKind,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node'
import { createLogger } from '@monibot/logger'
import {
  AGENT_STATE_TOPIC,
  type AgentStateEvent,
  agentStateEventSchema,
  type MatrixCallCredentials,
} from '@monibot/types'
import { sharedKeyE2eeOptions } from '../src/e2ee'

const logger = createLogger('VoiceE2E')

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const sessionId = process.argv[2] ?? required('E2E_SESSION_ID')
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000'
const speaches = process.env.SPEACHES_BASE_URL ?? 'http://localhost:8000'
const ttsModel = process.env.TTS_MODEL ?? 'speaches-ai/piper-pt_BR-faber-medium'
const lkJwtUrl = process.env.LK_JWT_URL ?? 'http://127.0.0.1:8080'
const question = process.env.E2E_QUESTION ?? 'Professor, por que o meu laço while nunca termina?'
const TURN_TIMEOUT_MS = 120_000
/** An agent already in the room (student rejoining) does not greet again. */
const GREETING_GRACE_MS = 8_000

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`sign-in failed for ${email}: ${response.status}`)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function apiJson(
  path: string,
  cookie: string,
  init: { method?: string; body?: unknown } = {}
) {
  const response = await fetch(`${origin}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', origin, cookie },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const body = (await response.json()) as { success: boolean; data?: unknown; error?: unknown }
  if (!body.success) throw new Error(`${path} failed: ${JSON.stringify(body.error)}`)
  return body.data
}

/** 16-bit mono PCM samples of the question, synthesized by the same TTS the agent uses. */
async function synthesizeQuestion(): Promise<{ samples: Int16Array; rate: number }> {
  const response = await fetch(`${speaches}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ttsModel,
      voice: 'default',
      input: question,
      response_format: 'wav',
    }),
  })
  if (!response.ok) throw new Error(`TTS failed: ${response.status}`)
  const wav = new DataView(await response.arrayBuffer())
  const rate = wav.getUint32(24, true)
  return { samples: new Int16Array(wav.buffer.slice(44)), rate }
}

const studentCookie = await signIn(required('E2E_STUDENT_EMAIL'), required('E2E_STUDENT_PASSWORD'))
const researcherCookie = await signIn(
  required('E2E_RESEARCHER_EMAIL'),
  required('E2E_RESEARCHER_PASSWORD')
)
const session = (await apiJson(`/api/sessions/${sessionId}`, studentCookie)) as {
  ragEnabled: boolean
  avatarEnabled: boolean
  callClient: 'livekit_web' | 'element_call'
  title: string
}

interface CallJoin {
  serverUrl: string
  token: string
  e2ee?: E2EEOptions
  /** Called once connected: what makes the API dispatch the agent, if anything. */
  announce: () => Promise<void>
  leave: () => Promise<void>
}

/** The web room's direct LiveKit path: the API issues the token and dispatches the agent. */
async function joinThroughToken(): Promise<CallJoin> {
  const { token, serverUrl } = (await apiJson(`/api/sessions/${sessionId}/token`, studentCookie, {
    method: 'POST',
    body: { participantName: 'Estudante E2E' },
  })) as { token: string; serverUrl: string }
  return { serverUrl, token, announce: async () => {}, leave: async () => {} }
}

/** What Element Call does for the student, with the credentials the web page receives. */
async function joinThroughMatrixRtc(): Promise<CallJoin> {
  const credentials = (await apiJson(
    `/api/sessions/${sessionId}/matrix-credentials`,
    studentCookie,
    {
      method: 'POST',
    }
  )) as MatrixCallCredentials
  const matrix = async (method: string, path: string, body: unknown) => {
    const response = await fetch(new URL(path, credentials.homeserverUrl), {
      method,
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Matrix ${method} ${path} failed: ${response.status}`)
    return response.json() as Promise<unknown>
  }
  const openIdToken = await matrix(
    'POST',
    `/_matrix/client/v3/user/${encodeURIComponent(credentials.userId)}/openid/request_token`,
    {}
  )
  const sfu = await fetch(`${lkJwtUrl}/sfu/get`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      room: credentials.roomId,
      openid_token: openIdToken,
      device_id: credentials.deviceId,
    }),
  })
  if (!sfu.ok) throw new Error(`lk-jwt-service /sfu/get failed: ${sfu.status}`)
  const { url, jwt } = (await sfu.json()) as { url: string; jwt: string }
  const stateKey = `_${credentials.userId}_${credentials.deviceId}_m.call`
  const membershipPath = `/_matrix/client/v3/rooms/${encodeURIComponent(credentials.roomId)}/state/org.matrix.msc3401.call.member/${encodeURIComponent(stateKey)}`
  return {
    serverUrl: url,
    token: jwt,
    e2ee: credentials.callPassword ? sharedKeyE2eeOptions(credentials.callPassword) : undefined,
    // Shaped like Element Call's own membership (compatibility mode, state events).
    announce: async () => {
      await matrix('PUT', membershipPath, {
        application: 'm.call',
        call_id: '',
        scope: 'm.room',
        device_id: credentials.deviceId,
        membershipID: `${credentials.userId}:${credentials.deviceId}`,
        expires: 4 * 60 * 60 * 1000,
        created_ts: Date.now(),
        // No livekit_alias: Element Call v0.28 (multi_sfu) lets lk-jwt-service name the room.
        foci_preferred: [{ type: 'livekit', livekit_service_url: lkJwtUrl }],
        focus_active: { type: 'livekit', focus_selection: 'multi_sfu' },
        'm.call.intent': 'audio',
      })
    },
    leave: async () => {
      await matrix('PUT', membershipPath, {})
    },
  }
}

const call =
  session.callClient === 'element_call' ? await joinThroughMatrixRtc() : await joinThroughToken()
const { samples, rate } = await synthesizeQuestion()
const frameSize = rate / 100

const events: AgentStateEvent[] = []
const room = new Room()
const decoder = new TextDecoder()
room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
  if (topic !== AGENT_STATE_TOPIC) return
  const parsed = agentStateEventSchema.safeParse(JSON.parse(decoder.decode(payload)))
  if (parsed.success) {
    events.push(parsed.data)
    logger.info(`agent state: ${parsed.data.state}`)
  }
})

const startedAt = Date.now()
await room.connect(call.serverUrl, call.token, {
  autoSubscribe: true,
  dynacast: false,
  e2ee: call.e2ee,
})
const source = new AudioSource(rate, 1)
const publishOptions = new TrackPublishOptions()
publishOptions.source = TrackSource.SOURCE_MICROPHONE
await room.localParticipant?.publishTrack(
  LocalAudioTrack.createAudioTrack('microphone', source),
  publishOptions
)
await call.announce()

const responses = () => events.filter((event) => event.agentResponse)
const agentPresent = () =>
  [...room.remoteParticipants.values()].some(
    (participant) => participant.kind === ParticipantKind.AGENT
  )
const agentHasVideo = () =>
  [...room.remoteParticipants.values()].some(
    (participant) =>
      participant.kind === ParticipantKind.AGENT &&
      [...participant.trackPublications.values()].some(
        (publication) => publication.kind === TrackKind.KIND_VIDEO
      )
  )
let agentVideoSeen = false
const silence = new Int16Array(frameSize)
let agentSeenAt: number | undefined
let spoke = false
let responsesBeforeQuestion = 0
// Real-time pacing: captureFrame resolves as the source consumes each 10 ms frame, and the
// trailing silence lets the VAD detect the end of speech.
while (
  Date.now() - startedAt < TURN_TIMEOUT_MS &&
  !(spoke && responses().length > responsesBeforeQuestion)
) {
  if (agentSeenAt === undefined && agentPresent()) agentSeenAt = Date.now()
  if (agentHasVideo()) agentVideoSeen = true
  const greeted = responses().length > 0
  const graceOver = agentSeenAt !== undefined && Date.now() - agentSeenAt > GREETING_GRACE_MS
  if (
    !spoke &&
    agentSeenAt !== undefined &&
    events.at(-1)?.state !== 'speaking' &&
    (greeted || graceOver)
  ) {
    responsesBeforeQuestion = responses().length
    logger.info('speaking the question')
    for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
      await source.captureFrame(new AudioFrame(samples.slice(i, i + frameSize), rate, 1, frameSize))
    }
    spoke = true
  } else {
    await source.captureFrame(new AudioFrame(silence, rate, 1, frameSize))
  }
}
await call.leave()
await room.disconnect()

const states = events.map((event) => event.state)
const studentEvent = events.find((event) => event.studentTranscript)
const answer = responses()[responsesBeforeQuestion]
await new Promise((resolve) => setTimeout(resolve, 3_000))
const interactions = (await apiJson(
  '/api/evaluations/export?dataset=interactions&format=json',
  researcherCookie
)) as {
  sessionId: string
  createdAt: string
  ragLatencyMs: number
  retrievedChunkCount: number
  sttLatencyMs: number
  llmTtftMs: number
  llmTotalLatencyMs: number
  ttsLatencyMs: number
  totalE2eLatencyMs: number
}[]
const row = interactions
  .filter((item) => item.sessionId === sessionId && Date.parse(item.createdAt) >= startedAt)
  .at(-1)

const checks = [
  { name: 'agent was present in the room', ok: agentSeenAt !== undefined },
  {
    // Only Element Call shows the avatar as the agent's video; the web LiveKit room draws it.
    name:
      session.callClient === 'element_call' && session.avatarEnabled
        ? 'avatar condition: the agent published its face as video'
        : 'no agent video (audio-only condition or web-drawn avatar)',
    ok: agentVideoSeen === (session.callClient === 'element_call' && session.avatarEnabled),
  },
  { name: 'agent heard the student (listening)', ok: states.includes('listening') },
  { name: 'student speech was transcribed', ok: Boolean(studentEvent?.studentTranscript) },
  {
    name: session.ragEnabled
      ? 'RAG condition retrieved material (searching_rag)'
      : 'LLM-only condition skipped retrieval',
    ok: session.ragEnabled === states.includes('searching_rag'),
  },
  { name: 'agent spoke an answer', ok: Boolean(answer?.agentResponse) },
  { name: 'telemetry row persisted for the turn', ok: Boolean(row) },
  {
    name: 'telemetry respects the experimental condition',
    ok:
      Boolean(row) &&
      (session.ragEnabled
        ? (row?.ragLatencyMs ?? -1) >= 0
        : row?.ragLatencyMs === 0 && row.retrievedChunkCount === 0),
  },
]
const report = {
  sessionId,
  ragEnabled: session.ragEnabled,
  avatarEnabled: session.avatarEnabled,
  callClient: session.callClient,
  question,
  transcript: studentEvent?.studentTranscript ?? null,
  answer: answer?.agentResponse ?? null,
  states,
  telemetry: row ?? null,
  checks,
  passed: checks.every((check) => check.ok),
}
for (const check of checks)
  logger[check.ok ? 'info' : 'error'](`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`)
if (row) logger.info('telemetry', { ...row })
if (process.env.E2E_REPORT_PATH)
  await Bun.write(process.env.E2E_REPORT_PATH, JSON.stringify(report, null, 2))
process.exit(report.passed ? 0 : 1)

import { fileURLToPath } from 'node:url'
import {
  cli,
  defineAgent,
  type JobContext,
  type JobProcess,
  type JobRequest,
  ServerOptions,
  type VAD,
  voice,
} from '@livekit/agents'
import * as openai from '@livekit/agents-plugin-openai'
import * as silero from '@livekit/agents-plugin-silero'
import type { E2EEOptions } from '@livekit/rtc-node'
import { createLogger } from '@monibot/logger'
import { AGENT_DISPLAY_NAME, type AgentSource, agentDispatchMetadataSchema } from '@monibot/types'
import { AgentStatePublisher } from './agent-state-publisher'
import { fetchE2eeKey, fetchSession, sendAgentEvent, sendInteractionLog } from './api-client'
import { publishAvatarVideo } from './avatar/avatar-video'
import { MouthEnvelope } from './avatar/mouth-envelope'
import { sharedKeyE2eeOptions, watchStudentAudioDecryption } from './e2ee'
import { env } from './env'
import { startMatrixPresence } from './matrix-presence'
import { TelemetryReporter } from './telemetry-reporter'
import { TurnTracker } from './turn-tracker'
import { TutorAgent } from './tutor-agent'

const logger = createLogger('AgentWorker')

const GREETING =
  'Olá! Eu sou o MoniBot, monitor de Fundamentos de Programação. Qual é a sua dúvida?'

/** Time to the LLM's first token before the SDK aborts and retries (its default is 10 s). */
const LLM_TIMEOUT_MS = 30_000

interface ProcessData extends Record<string, unknown> {
  vad: VAD
}

export default defineAgent<ProcessData>({
  prewarm: async (proc: JobProcess<ProcessData>) => {
    proc.userData.vad = await silero.VAD.load()
  },
  entry: async (ctx: JobContext<ProcessData>) => {
    const { sessionId } = agentDispatchMetadataSchema.parse(JSON.parse(ctx.job.metadata || '{}'))
    // Experimental flags are read once and stay fixed for the whole session.
    const session = await fetchSession(sessionId)
    if (session.status === 'ended') {
      logger.warn('Dispatched to an ended session; leaving', { sessionId })
      return
    }

    // Joining an encrypted call without its key would fail silently (no error, only silence).
    let e2ee: E2EEOptions | undefined
    if (session.e2eeEnabled) {
      const { sharedKey } = await fetchE2eeKey(sessionId)
      if (!sharedKey) throw new Error(`Session ${sessionId} is encrypted but has no key`)
      e2ee = sharedKeyE2eeOptions(sharedKey)
    }
    watchStudentAudioDecryption(ctx.room, { sessionId, e2eeEnabled: session.e2eeEnabled })
    await ctx.connect(e2ee)
    const inElementCall = session.callClient === 'element_call'
    // An Element Call page is not in the LiveKit room: it follows the agent through the API's
    // live stream instead of the DataChannel.
    const publisher = new AgentStatePublisher(
      ctx.room,
      inElementCall ? (event) => sendAgentEvent(sessionId, event) : undefined
    )
    const tracker = new TurnTracker({ sessionId, ragEnabled: session.ragEnabled })
    const reporter = new TelemetryReporter(sendInteractionLog, {
      onDropped: (_log, error) =>
        logger.error('Telemetry rejected by the API; turn dropped', {
          sessionId,
          status: error.status,
          error,
        }),
      onStillPending: (_log, error) =>
        logger.error('Telemetry upload failed; turn kept in buffer', { sessionId, error }),
    })
    let sources: AgentSource[] = []
    // Avatar condition in an Element Call call: MoniBot's face is its video tile. In a direct
    // LiveKit room the web page draws the avatar itself, so no video is published there.
    const mouth = session.avatarEnabled && inElementCall ? new MouthEnvelope() : undefined

    const agentSession = new voice.AgentSession({
      vad: ctx.proc.userData.vad,
      stt: new openai.STT({
        baseURL: `${env.SPEACHES_BASE_URL}/v1`,
        apiKey: 'local',
        model: env.WHISPER_MODEL,
        language: env.STT_LANGUAGE,
        // speaches serves Whisper on /v1/audio/transcriptions; utterances are cut by Silero VAD.
        useRealtime: false,
      }),
      llm: new openai.LLM({
        baseURL: `${env.OLLAMA_BASE_URL}/v1`,
        apiKey: 'ollama',
        model: session.llmModel,
        temperature: 0.4,
      }),
      tts: new openai.TTS({
        baseURL: `${env.SPEACHES_BASE_URL}/v1`,
        apiKey: 'local',
        model: env.TTS_MODEL,
      }),
      // On a small GPU llama3.1:8b runs mostly on the CPU, so a long prompt can take more than the
      // SDK's default 10 s to its first token; the abort and retry then add seconds to the turn,
      // and three in a row fail it.
      connOptions: { llmConnOptions: { timeoutMs: LLM_TIMEOUT_MS } },
      // Local-only: VAD end-of-turn and VAD-based interruptions (the adaptive detector is a hosted model).
      turnHandling: { turnDetection: 'vad', interruption: { mode: 'vad' } },
    })

    agentSession.on(voice.AgentSessionEventTypes.MetricsCollected, ({ metrics }) => {
      switch (metrics.type) {
        case 'stt_metrics':
          logger.debug('STT request finished', {
            durationMs: metrics.durationMs,
            audioDurationMs: metrics.audioDurationMs,
          })
          tracker.onSttMetrics({ durationMs: metrics.durationMs })
          break
        case 'eou_metrics':
          tracker.onEou({ lastSpeakingTimeMs: metrics.lastSpeakingTimeMs })
          break
        case 'llm_metrics':
          tracker.onLlmMetrics({
            ttftMs: metrics.ttftMs,
            durationMs: metrics.durationMs,
            cancelled: metrics.cancelled,
          })
          break
        case 'tts_metrics':
          tracker.onTtsMetrics({ ttfbMs: metrics.ttfbMs })
          break
      }
    })

    agentSession.on(voice.AgentSessionEventTypes.UserStateChanged, ({ newState }) => {
      logger.debug('User state changed', { newState })
      if (newState === 'speaking') publisher.publish({ state: 'listening' })
    })

    agentSession.on(voice.AgentSessionEventTypes.AgentStateChanged, ({ newState, createdAt }) => {
      if (newState === 'speaking') mouth?.startPlayback(Date.now())
      else mouth?.stop()
      if (newState === 'speaking') {
        tracker.onAgentSpeaking(createdAt)
        publisher.publish({ state: 'speaking', sources })
      } else if (newState === 'listening' && publisher.state === 'speaking') {
        publisher.publish({ state: 'idle' })
      }
    })

    agentSession.on(voice.AgentSessionEventTypes.ConversationItemAdded, ({ item }) => {
      if (item.type !== 'message' || item.role !== 'assistant') return
      const agentResponse = item.textContent ?? ''
      publisher.publish({ state: 'idle', agentResponse })
      const result = tracker.onAgentResponse(agentResponse)
      if (!result) return
      if (result.ok) reporter.report(result.log)
      else logger.warn('Turn discarded', { sessionId, reason: result.reason })
    })

    agentSession.on(
      voice.AgentSessionEventTypes.UserInputTranscribed,
      ({ isFinal, transcript }) => {
        if (isFinal) logger.debug('Final transcript received', { characters: transcript.length })
      }
    )

    agentSession.on(voice.AgentSessionEventTypes.Error, ({ error }) => {
      logger.error('Agent session error', { sessionId, error })
    })

    // A closed voice session must not leave the job in the room: the agent would stay visible in
    // the call (MatrixRTC membership kept alive by heartbeats) while no longer listening.
    agentSession.on(voice.AgentSessionEventTypes.Close, ({ reason }) => {
      logger.info('Agent session closed; ending the job', { sessionId, reason })
      ctx.shutdown(`agent session closed: ${reason}`)
    })

    ctx.addShutdownCallback(async () => {
      await reporter.flush()
      if (reporter.pending > 0)
        logger.error('Telemetry still pending at shutdown', {
          sessionId,
          pending: reporter.pending,
        })
    })

    await agentSession.start({
      agent: new TutorAgent({
        session,
        publisher,
        tracker,
        onSources: (next) => {
          sources = next
        },
        mouth,
      }),
      room: ctx.room,
      // A student's client reconnecting (network blip, Element Call re-joining) disconnects them
      // with CLIENT_INITIATED; the SDK default would close the session for good. Keep it open:
      // RoomIO relinks the same identity when it returns, and once only the agent is left
      // LiveKit closes the room, which ends the job.
      inputOptions: { closeOnDisconnect: false },
    })
    logger.info('MoniBot joined the room', {
      sessionId,
      room: ctx.room.name,
      ragEnabled: session.ragEnabled,
      avatarEnabled: session.avatarEnabled,
      llmModel: session.llmModel,
    })
    if (session.matrixRoomId) ctx.addShutdownCallback(startMatrixPresence(sessionId))
    if (mouth) {
      const stopAvatar = await publishAvatarVideo(ctx.room, {
        sessionId,
        state: () => publisher.state,
        mouth,
      })
      ctx.addShutdownCallback(stopAvatar)
    }
    agentSession.say(GREETING)
  },
})

/**
 * Joins with the identity the API chose (Matrix calls need the agent's MatrixRTC identity);
 * malformed metadata falls back to the SDK default and fails loudly in `entry`.
 */
async function acceptJob(request: JobRequest): Promise<void> {
  let identity = ''
  try {
    identity =
      agentDispatchMetadataSchema.safeParse(JSON.parse(request.job.metadata || '{}')).data
        ?.participantIdentity ?? ''
  } catch {
    identity = ''
  }
  await request.accept(AGENT_DISPLAY_NAME, identity)
}

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: env.LIVEKIT_AGENT_NAME,
    requestFunc: acceptJob,
  })
)

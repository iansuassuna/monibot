import { fileURLToPath } from 'node:url'
import {
  cli,
  defineAgent,
  type JobContext,
  type JobProcess,
  ServerOptions,
  type VAD,
  voice,
} from '@livekit/agents'
import * as openai from '@livekit/agents-plugin-openai'
import * as silero from '@livekit/agents-plugin-silero'
import { createLogger } from '@monibot/logger'
import { type AgentSource, agentDispatchMetadataSchema } from '@monibot/types'
import { AgentStatePublisher } from './agent-state-publisher'
import { fetchSession, sendInteractionLog } from './api-client'
import { env } from './env'
import { TelemetryReporter } from './telemetry-reporter'
import { TurnTracker } from './turn-tracker'
import { TutorAgent } from './tutor-agent'

const logger = createLogger('AgentWorker')

const GREETING =
  'Olá! Eu sou o MoniBot, monitor de Fundamentos de Programação. Qual é a sua dúvida?'

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

    await ctx.connect()
    const publisher = new AgentStatePublisher(ctx.room)
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
      }),
      room: ctx.room,
    })
    logger.info('MoniBot joined the room', {
      sessionId,
      room: ctx.room.name,
      ragEnabled: session.ragEnabled,
      avatarEnabled: session.avatarEnabled,
      llmModel: session.llmModel,
    })
    agentSession.say(GREETING)
  },
})

cli.runApp(
  new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: env.LIVEKIT_AGENT_NAME })
)

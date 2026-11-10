import { type ReadableStream, TransformStream } from 'node:stream/web'
import { type llm, voice } from '@livekit/agents'
import type { AudioFrame } from '@livekit/rtc-node'
import { createLogger } from '@monibot/logger'
import {
  type AgentSource,
  buildTutorContextMessage,
  buildTutorSystemPrompt,
  RETRIEVAL_DEFAULT_MIN_SCORE,
  RETRIEVAL_DEFAULT_TOP_K,
  type TutoringSession,
} from '@monibot/types'
import type { AgentStatePublisher } from './agent-state-publisher'
import { retrieveChunks } from './api-client'
import type { MouthEnvelope } from './avatar/mouth-envelope'
import type { TurnTracker } from './turn-tracker'

const logger = createLogger('TutorAgent')
const EXCERPT_CHARS = 600

interface TutorAgentOptions {
  session: TutoringSession
  publisher: AgentStatePublisher
  tracker: TurnTracker
  onSources: (sources: AgentSource[]) => void
  /** Set when the avatar video is on: records each reply's loudness to drive the mouth. */
  mouth?: MouthEnvelope
}

/**
 * MoniBot tutor. In the RAG condition it retrieves course material for each student turn and adds
 * it as a system message right before the student's message; otherwise the conversation is sent
 * unchanged. Both conditions share the same instructions.
 */
export class TutorAgent extends voice.Agent {
  private readonly options: TutorAgentOptions

  constructor(options: TutorAgentOptions) {
    super({ instructions: buildTutorSystemPrompt() })
    this.options = options
  }

  override async ttsNode(
    text: ReadableStream<string> | AsyncIterable<string>,
    modelSettings: voice.ModelSettings
  ): Promise<ReadableStream<AudioFrame> | null> {
    const audio = await voice.Agent.default.ttsNode(this, text, modelSettings)
    const { mouth } = this.options
    if (!audio || !mouth) return audio
    mouth.beginSpeech()
    return audio.pipeThrough(
      new TransformStream<AudioFrame, AudioFrame>({
        transform(frame, controller) {
          mouth.append(frame.data, frame.sampleRate, frame.channels)
          controller.enqueue(frame)
        },
      })
    )
  }

  override async onUserTurnCompleted(
    turnCtx: llm.ChatContext,
    newMessage: llm.ChatMessage
  ): Promise<void> {
    const { session, publisher, tracker, onSources } = this.options
    const transcript = newMessage.textContent?.trim() ?? ''
    const superseded = tracker.onUserTurnCompleted({ transcript })
    if (superseded && !superseded.ok)
      logger.warn('Turn discarded', { sessionId: session.id, reason: superseded.reason })

    if (!session.ragEnabled) {
      onSources([])
      publisher.publish({ state: 'thinking', studentTranscript: transcript })
      return
    }

    publisher.publish({ state: 'searching_rag', studentTranscript: transcript })
    try {
      const retrieval = await retrieveChunks({
        query: transcript,
        topK: RETRIEVAL_DEFAULT_TOP_K,
        minScore: RETRIEVAL_DEFAULT_MIN_SCORE,
      })
      tracker.onRetrieval({
        ragLatencyMs: retrieval.ragLatencyMs,
        chunks: retrieval.chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          score: chunk.score,
          excerpt: chunk.content.slice(0, EXCERPT_CHARS),
        })),
      })
      onSources(
        retrieval.chunks.map((chunk) => ({
          documentTitle: chunk.documentTitle,
          score: chunk.score,
          excerpt: chunk.content.slice(0, EXCERPT_CHARS),
          isCode: chunk.metadata.isCode ?? false,
        }))
      )
      // turnCtx already holds the student message; a system message after it makes Llama emit a
      // literal "assistant" header, so the context goes right before it (same order as the playground).
      turnCtx.addMessage({
        role: 'system',
        content: buildTutorContextMessage(retrieval.chunks),
        createdAt: newMessage.createdAt - 1,
      })
    } catch (error) {
      // The RAG condition must never silently answer without retrieval: skip this reply.
      logger.error('Retrieval failed; turn skipped', { sessionId: session.id, error })
      publisher.publish({ state: 'idle' })
      throw new voice.StopResponse()
    }
    publisher.publish({ state: 'thinking' })
  }
}

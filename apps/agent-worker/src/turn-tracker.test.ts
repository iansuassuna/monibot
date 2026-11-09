import { describe, expect, test } from 'bun:test'
import { type TurnResult, TurnTracker } from './turn-tracker'

function logOf(result: TurnResult | null) {
  if (!result?.ok) throw new Error(`expected a logged turn, got ${JSON.stringify(result)}`)
  return result.log
}

const SESSION_ID = '0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4'
const CHUNK = {
  chunkId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  score: 0.81,
  excerpt: 'O laço while repete…',
}

function completeTurn(
  tracker: TurnTracker,
  overrides: { agentSpeakingAt?: number; lastSpeakingTimeMs?: number } = {}
) {
  tracker.onSttMetrics({ durationMs: 311.6 })
  tracker.onUserTurnCompleted({ transcript: 'Por que meu while não para?' })
  tracker.onRetrieval({ ragLatencyMs: 48, chunks: [CHUNK] })
  tracker.onEou({ lastSpeakingTimeMs: overrides.lastSpeakingTimeMs ?? 10_000 })
  tracker.onLlmMetrics({ ttftMs: 420.4, durationMs: 1800.2, cancelled: false })
  tracker.onTtsMetrics({ ttfbMs: 150.5 })
  tracker.onAgentSpeaking(overrides.agentSpeakingAt ?? 10_980)
  return tracker.onAgentResponse('O que acontece com a variável de controle a cada volta?')
}

describe('TurnTracker', () => {
  test('assembles a complete turn into an interaction log with integer milliseconds', () => {
    const result = completeTurn(new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true }))
    expect(result).toEqual({
      ok: true,
      log: {
        sessionId: SESSION_ID,
        studentTranscript: 'Por que meu while não para?',
        agentResponse: 'O que acontece com a variável de controle a cada volta?',
        retrievedChunks: [CHUNK],
        sttLatencyMs: 312,
        ragLatencyMs: 48,
        llmTtftMs: 420,
        llmTotalLatencyMs: 1800,
        ttsLatencyMs: 151,
        totalE2eLatencyMs: 980,
      },
    })
  })

  test('forces ragLatencyMs = 0 and no chunks when RAG is disabled, even if retrieval is reported', () => {
    const result = completeTurn(new TurnTracker({ sessionId: SESSION_ID, ragEnabled: false }))
    expect(logOf(result).ragLatencyMs).toBe(0)
    expect(logOf(result).retrievedChunks).toEqual([])
  })

  test('sums STT requests from several utterances in the same user turn', () => {
    const tracker = new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true })
    tracker.onSttMetrics({ durationMs: 200 })
    const result = completeTurn(tracker)
    expect(logOf(result).sttLatencyMs).toBe(512)
  })

  test('keeps the first LLM and TTS measurement of the turn (later sentences do not overwrite it)', () => {
    const tracker = new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true })
    tracker.onSttMetrics({ durationMs: 300 })
    tracker.onUserTurnCompleted({ transcript: 'pergunta' })
    tracker.onRetrieval({ ragLatencyMs: 40, chunks: [] })
    tracker.onEou({ lastSpeakingTimeMs: 1_000 })
    tracker.onLlmMetrics({ ttftMs: 400, durationMs: 1500, cancelled: false })
    tracker.onLlmMetrics({ ttftMs: 999, durationMs: 9999, cancelled: false })
    tracker.onTtsMetrics({ ttfbMs: 120 })
    tracker.onTtsMetrics({ ttfbMs: 80 })
    tracker.onAgentSpeaking(1_900)
    tracker.onAgentSpeaking(5_000)
    const result = tracker.onAgentResponse('resposta')
    const log = logOf(result)
    expect([log.llmTtftMs, log.llmTotalLatencyMs, log.ttsLatencyMs, log.totalE2eLatencyMs]).toEqual(
      [400, 1500, 120, 900]
    )
  })

  test('ignores cancelled or unmeasured LLM requests (e.g. preemptive generation) and keeps the real one', () => {
    const tracker = new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true })
    tracker.onSttMetrics({ durationMs: 300 })
    tracker.onUserTurnCompleted({ transcript: 'pergunta' })
    tracker.onEou({ lastSpeakingTimeMs: 1_000 })
    tracker.onLlmMetrics({ ttftMs: -1, durationMs: 50, cancelled: true })
    tracker.onLlmMetrics({ ttftMs: -1, durationMs: 0, cancelled: false })
    tracker.onLlmMetrics({ ttftMs: 410, durationMs: 1600, cancelled: false })
    tracker.onTtsMetrics({ ttfbMs: 110 })
    tracker.onAgentSpeaking(1_800)
    const log = logOf(tracker.onAgentResponse('resposta'))
    expect([log.llmTtftMs, log.llmTotalLatencyMs]).toEqual([410, 1600])
  })

  test('discards a turn the agent never spoke (interrupted) with an explicit reason', () => {
    const tracker = new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true })
    tracker.onSttMetrics({ durationMs: 300 })
    tracker.onUserTurnCompleted({ transcript: 'pergunta' })
    tracker.onEou({ lastSpeakingTimeMs: 1_000 })
    tracker.onLlmMetrics({ ttftMs: 400, durationMs: 1500, cancelled: false })
    const result = tracker.onAgentResponse('resposta parcial')
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('ttsLatencyMs') })
  })

  test('discards a turn whose end of speech was not detected (lastSpeakingTimeMs = 0)', () => {
    const result = completeTurn(new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true }), {
      lastSpeakingTimeMs: 0,
    })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('end of speech') })
  })

  test('discards a turn with negative end-to-end latency instead of storing a corrupt value', () => {
    const result = completeTurn(new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true }), {
      lastSpeakingTimeMs: 10_000,
      agentSpeakingAt: 9_000,
    })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('negative') })
  })

  test('a new user turn discards the unfinished previous one and starts clean', () => {
    const tracker = new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true })
    tracker.onSttMetrics({ durationMs: 300 })
    tracker.onUserTurnCompleted({ transcript: 'primeira' })
    tracker.onEou({ lastSpeakingTimeMs: 1_000 })
    tracker.onSttMetrics({ durationMs: 250 })
    const discarded = tracker.onUserTurnCompleted({ transcript: 'segunda' })
    expect(discarded).toEqual({ ok: false, reason: expect.stringContaining('superseded') })
    tracker.onEou({ lastSpeakingTimeMs: 2_000 })
    tracker.onLlmMetrics({ ttftMs: 300, durationMs: 900, cancelled: false })
    tracker.onTtsMetrics({ ttfbMs: 100 })
    tracker.onAgentSpeaking(2_700)
    const result = tracker.onAgentResponse('resposta')
    expect(logOf(result).studentTranscript).toBe('segunda')
    // The discarded turn's STT time must not leak into the new turn.
    expect(logOf(result).sttLatencyMs).toBe(250)
  })

  test('agent responses outside a user turn (e.g. the greeting) produce no log', () => {
    const tracker = new TurnTracker({ sessionId: SESSION_ID, ragEnabled: true })
    tracker.onTtsMetrics({ ttfbMs: 100 })
    tracker.onAgentSpeaking(500)
    expect(tracker.onAgentResponse('Olá! Sou o MoniBot.')).toBeNull()
  })
})

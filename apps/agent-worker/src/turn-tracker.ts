import type { InteractionLogCreate, RetrievedChunkRef } from '@monibot/types'

export type TurnResult = { ok: true; log: InteractionLogCreate } | { ok: false; reason: string }

interface TurnTrackerOptions {
  sessionId: string
  ragEnabled: boolean
}

interface TurnState {
  transcript: string
  sttMs: number
  ragMs: number
  chunks: RetrievedChunkRef[]
  lastSpeakingTimeMs?: number
  llmTtftMs?: number
  llmTotalMs?: number
  ttsTtfbMs?: number
  agentSpeakingAt?: number
}

/**
 * Assembles the per-turn latency telemetry from AgentSession events, which arrive in this order:
 * STT metrics → user turn completed (+ retrieval) → EOU → LLM → TTS → agent speaking → response.
 * Only the first LLM/TTS measurement of a turn counts, so later sentences never overwrite it.
 */
export class TurnTracker {
  private pendingSttMs = 0
  private turn: TurnState | null = null

  constructor(private readonly options: TurnTrackerOptions) {}

  /**
   * STT requests always precede the turn they belong to (even while an older turn is still open),
   * so they accumulate until the next turn starts.
   */
  onSttMetrics({ durationMs }: { durationMs: number }): void {
    this.pendingSttMs += durationMs
  }

  /** Starts a turn; returns the discard result of an unfinished previous turn, if any. */
  onUserTurnCompleted({ transcript }: { transcript: string }): TurnResult | null {
    const superseded = this.turn
      ? { ok: false as const, reason: 'superseded by a new user turn before the agent answered' }
      : null
    this.turn = { transcript, sttMs: this.pendingSttMs, ragMs: 0, chunks: [] }
    this.pendingSttMs = 0
    return superseded
  }

  onRetrieval({
    ragLatencyMs,
    chunks,
  }: {
    ragLatencyMs: number
    chunks: RetrievedChunkRef[]
  }): void {
    if (!this.turn || !this.options.ragEnabled) return
    this.turn.ragMs = ragLatencyMs
    this.turn.chunks = chunks
  }

  onEou({ lastSpeakingTimeMs }: { lastSpeakingTimeMs: number }): void {
    if (this.turn && this.turn.lastSpeakingTimeMs === undefined)
      this.turn.lastSpeakingTimeMs = lastSpeakingTimeMs
  }

  /** Cancelled requests (e.g. preemptive generation) report a negative TTFT and are ignored. */
  onLlmMetrics({
    ttftMs,
    durationMs,
    cancelled,
  }: {
    ttftMs: number
    durationMs: number
    cancelled: boolean
  }): void {
    if (cancelled || ttftMs < 0) return
    if (this.turn && this.turn.llmTtftMs === undefined) {
      this.turn.llmTtftMs = ttftMs
      this.turn.llmTotalMs = durationMs
    }
  }

  onTtsMetrics({ ttfbMs }: { ttfbMs: number }): void {
    if (this.turn && this.turn.ttsTtfbMs === undefined) this.turn.ttsTtfbMs = ttfbMs
  }

  /** Wall-clock ms when the first agent audio frame was played out to LiveKit. */
  onAgentSpeaking(atMs: number): void {
    if (this.turn && this.turn.agentSpeakingAt === undefined) this.turn.agentSpeakingAt = atMs
  }

  /** Closes the turn. `null` means the response was not an answer to a user turn (e.g. the greeting). */
  onAgentResponse(agentResponse: string): TurnResult | null {
    const turn = this.turn
    if (!turn) return null
    this.turn = null

    const missing = [
      turn.llmTtftMs === undefined && 'llmTtftMs',
      turn.ttsTtfbMs === undefined && 'ttsLatencyMs',
      turn.agentSpeakingAt === undefined && 'agent speaking time',
    ].filter(Boolean)
    if (missing.length > 0)
      return { ok: false, reason: `incomplete turn, missing ${missing.join(', ')}` }
    if (!turn.lastSpeakingTimeMs)
      return { ok: false, reason: 'end of speech was not detected by VAD' }

    const e2e = (turn.agentSpeakingAt ?? 0) - turn.lastSpeakingTimeMs
    if (e2e < 0) return { ok: false, reason: `negative end-to-end latency (${e2e} ms)` }

    return {
      ok: true,
      log: {
        sessionId: this.options.sessionId,
        studentTranscript: turn.transcript,
        agentResponse,
        retrievedChunks: this.options.ragEnabled ? turn.chunks : [],
        sttLatencyMs: Math.round(turn.sttMs),
        ragLatencyMs: this.options.ragEnabled ? Math.round(turn.ragMs) : 0,
        llmTtftMs: Math.round(turn.llmTtftMs ?? 0),
        llmTotalLatencyMs: Math.round(turn.llmTotalMs ?? 0),
        ttsLatencyMs: Math.round(turn.ttsTtfbMs ?? 0),
        totalE2eLatencyMs: Math.round(e2e),
      },
    }
  }
}

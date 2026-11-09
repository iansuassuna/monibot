---
description: LiveKit Agents worker pipeline (Silero VAD → Whisper → RAG → Ollama → Piper), MatrixRTC MSC4143/MSC4195 integration via a Matrix application service, pedagogical prompt, and per-turn latency telemetry
paths:
  - "apps/agent-worker/**"
  - "apps/api/src/services/livekit*.ts"
  - "apps/api/src/services/matrix*.ts"
  - "apps/api/src/routes/matrix*.ts"
  - "apps/api/src/routes/telemetry*.ts"
  - "apps/api/src/services/analytics*.ts"
  - "packages/types/src/telemetry.ts"
  - "docker/**"
---

# Voice Agent & MatrixRTC

## Topology

```
Element Call ──(MSC4143 m.call.member state event)──▶ Synapse
     │                                                   │ Matrix AS transaction
     │ lk-jwt-service: Matrix OpenID → LiveKit JWT        ▼
     ▼                                      apps/api PUT /api/matrix/_matrix/app/v1/transactions/:txnId
LiveKit SFU ◀── agent dispatch (createRoom + createDispatch) ── apps/api (also on POST /sessions/:id/token)
     │
apps/agent-worker (Bun)
  Silero VAD → speaches/faster-whisper (STT) → POST /api/knowledge/retrieve (RAG only)
  → Ollama (OpenAI-compatible /v1) → speaches/Piper (TTS) → audio track
  → DataChannel `monibot.agent-state` → POST /api/telemetry/logs (x-agent-secret)
```

## MatrixRTC

- Synapse delivers events to MoniBot as a **Matrix application service** (`docker/synapse/monibot-appservice.template.yaml`, rooms namespace `.*`, non-exclusive). The `hs_token` is `MATRIX_WEBHOOK_SECRET`; `matrix.routes.ts` answers `{}` per the Matrix spec (the one exception to the API envelope) and never fails a whole transaction because one event failed, or the homeserver retries it forever.
- A membership whose content advertises a LiveKit focus (`foci_preferred[].type = 'livekit'` or `focus_active.type = 'livekit'`, MSC4195) means "joined the call"; empty content means "left". Both `m.call.member` and `org.matrix.msc3401.call.member` are accepted.
- Room IDs: room versions ≤ 11 are `!opaque:server`; v12+ (MSC4291, Synapse's current default) are `!opaque` with no server part. Validation accepts both.
- The API adopts the focus's `livekit_alias` as the session's `livekit_room_name` before dispatching, so the agent joins the participants' room. Verify this against the deployed `lk-jwt-service` version's room-naming scheme; the Element Call UI path is not covered by the automated tests.
- Dispatch is idempotent: `ensureAgentDispatched` creates the room (dispatch RPCs time out on a room that does not exist yet), lists dispatches, and only creates one when missing.

## Worker pipeline

- Runs on **Bun** (`bun run src/main.ts dev|start`); verified end to end with real audio.
- One `AgentSession` per room. Session flags (`ragEnabled`, `avatarEnabled`, `llmModel`) are read from the API **once at join** and are immutable for the session.
- Local models only, all through OpenAI-compatible endpoints: STT `openai.STT({ baseURL: speaches, useRealtime: false })` (the plugin defaults to the Realtime API, which speaches does not serve), LLM `openai.LLM({ baseURL: ollama/v1 })`, TTS `openai.TTS({ baseURL: speaches })`. Turn detection **and** interruptions use the local VAD (`turnHandling: { turnDetection: 'vad', interruption: { mode: 'vad' } }`); the adaptive interruption detector is a hosted model.
- **RAG condition**: `TutorAgent.onUserTurnCompleted` retrieves and inserts `buildTutorContextMessage(chunks)` with `createdAt: newMessage.createdAt - 1`. The turn context already contains the student message; appending a system message *after* it makes Llama emit a literal `assistant` header. Retrieval failure throws `voice.StopResponse` (no silent answer without retrieval).
- **LLM-only condition**: no retrieval call at all; `ragLatencyMs = 0`, `retrievedChunks = []`.
- `avatarEnabled` only changes the web rendering; the worker publishes the same `AgentState` events in both conditions.
- DataChannel events (`agentStateEventSchema`): `listening` (user starts speaking), `searching_rag` + `studentTranscript` (RAG) or `thinking` + `studentTranscript` (LLM-only), `thinking`, `speaking` + `sources`, `idle` + `agentResponse`.
- Keep models resident (`OLLAMA_KEEP_ALIVE=-1`, `WHISPER__TTL=-1`): a cold model load inflates the measured latencies by seconds and confounds the experiment.
- Room lifecycle: the SDK closes the session on a clean client disconnect; on an abrupt drop LiveKit removes the participant (~20 s) and then closes the agent-only room (~20 s), which ends the job.

## Pedagogical system prompt

MoniBot tutors *Fundamentos de Programação*. The system prompt must:

- guide the student's reasoning with questions, hints, and small analogous examples — **never** hand out a complete solution to an assignment or exam question;
- when RAG is active, ground the answer in the retrieved excerpts and cite the source title; say so when the material does not cover the question;
- answer in Brazilian Portuguese, short spoken sentences (it is synthesized to speech — no markdown, no long code listings; describe code verbally and keep snippets to a line).

The prompts live in `@monibot/types` (`packages/types/src/prompts.ts`): `buildTutorSystemPrompt()` (both conditions) and `buildTutorContextMessage(chunks)` (an extra system message placed right before the student message, RAG only). The worker and the API playground send exactly this structure, so the experimental conditions differ **only** by the presence of that message. Never fork a local copy.

## Latency telemetry (scientific requirement)

`TurnTracker` (`src/turn-tracker.ts`, unit-tested) assembles each turn from AgentSession events, all in integer milliseconds:

| Field | Source |
|---|---|
| `sttLatencyMs` | sum of `stt_metrics.durationMs` for the utterances of the turn (STT always precedes its turn) |
| `ragLatencyMs` | server-side `ragLatencyMs` from `/api/knowledge/retrieve` (embedding + pgvector); `0` when RAG disabled |
| `llmTtftMs` / `llmTotalLatencyMs` | first **non-cancelled** `llm_metrics` (`ttftMs`, `durationMs`); cancelled/preemptive requests report a negative TTFT and are ignored |
| `ttsLatencyMs` | first `tts_metrics.ttfbMs` of the turn |
| `totalE2eLatencyMs` | `agent_state_changed → speaking`.createdAt − `eou_metrics.lastSpeakingTimeMs` (both wall-clock ms from the SDK) |

- A turn missing a measurement, with no detected end of speech, or with a negative span is discarded **with a logged reason**, never stored with a made-up value.
- `TelemetryReporter` (`src/telemetry-reporter.ts`) sends turns in order without blocking audio: transient failures stay buffered (flushed each turn and at shutdown); a 4xx rejection drops that turn with an error log so it cannot block the queue.
- Analytics aggregate mean, p50, p95, and sample standard deviation grouped by `ragEnabled` × `avatarEnabled` in SQL (`percentile_cont`) in `analytics.service.ts`.

## Verification

- `bun test` in `apps/agent-worker` (turn assembly and telemetry delivery failure modes).
- `bun run --cwd apps/agent-worker test:voice-e2e <sessionId>`: a scripted student joins through the real API and speaks a question synthesized by the deployment's Piper voice; asserts the state sequence, the condition-specific behaviour, and the persisted telemetry row. Needs API, worker, LiveKit, Ollama and speaches running, plus `E2E_STUDENT_*` / `E2E_RESEARCHER_*` credentials.
- Chrome's `--use-file-for-fake-audio-capture` publishes silence through LiveKit; don't use it for voice tests.

## Data handling

- Transcripts are research data: log them only to `interaction_logs`, never to stdout (debug logs carry lengths and durations only).
- Never record raw audio unless the session explicitly has consent tracking (not implemented — do not add recording).

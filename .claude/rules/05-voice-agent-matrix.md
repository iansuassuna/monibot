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

- Synapse delivers events to MoniBot as a **Matrix application service** (`docker/synapse/monibot-appservice.template.yaml`, rooms namespace `.*`, non-exclusive). The `hs_token` is `MATRIX_WEBHOOK_SECRET`; `matrix.routes.ts` answers `{}` per the Matrix spec (the one exception to the API envelope) and never fails a whole transaction because one event failed, or the homeserver retries it forever. A resent transaction must not dispatch twice: events are de-duplicated by `event_id` (`RecentIds`, in memory).
- A membership whose content advertises a LiveKit focus (`foci_preferred[].type = 'livekit'` or `focus_active.type = 'livekit'`, MSC4195) means "joined the call"; empty content means "left". Both `m.call.member` and `org.matrix.msc3401.call.member` are accepted.
- Room IDs: room versions ≤ 11 are `!opaque:server`; v12+ (MSC4291, Synapse's current default) are `!opaque` with no server part. Validation accepts both.
- Before dispatching, the API adopts the participants' LiveKit room as the session's `livekit_room_name`: the focus `livekit_alias` when sent (older Element Call), otherwise the room where the member's identity (`membershipID`, or `sender:device_id`) is connected, polled for up to 5 s (one lookup only for a *replayed* membership, `origin_server_ts` older than `LIVE_MEMBERSHIP_MAX_AGE_MS`, which Synapse delivers late after the API was unreachable). A member with an identity that is not connected is ignored (`Call member is not connected to LiveKit`) instead of opening an empty room; only a member without any identity (older clients) falls back to the session's own room. Current `lk-jwt-service` derives the room name from the Matrix room alone, so successive sessions in one Matrix room share it — `livekit_room_name` is deliberately not unique.
- **The agent is a MatrixRTC member** (otherwise Element Call hides its LiveKit participant). For Matrix sessions (and when `MATRIX_AS_TOKEN` is set) the dispatch metadata carries `participantIdentity = <MATRIX_BOT_USER_ID>:MONIBOT` (`agentIdentityForSession`, used by both the Matrix webhook and `POST /sessions/:id/token`, so the identity never depends on who brought the agent in); the worker accepts the job with it. The worker reports `joined` / `heartbeat` (every `AGENT_PRESENCE_HEARTBEAT_MS`) / `left` to `POST /sessions/:id/agent-presence`; the API, as the appservice bot, joins the room, schedules a delayed leave (MSC4140, 3× the heartbeat) **before** publishing the membership, restarts it on each heartbeat, and withdraws on `left`. A crashed worker's membership disappears when the delayed leave fires. A room the homeserver refuses to join (4xx: mistyped ID, unknown remote room, e2e fixtures) yields `not_applicable` with a warning, not `UPSTREAM_UNAVAILABLE`: the session keeps working as plain LiveKit. The membership copies the members' LiveKit focus from room state and must keep `membershipID` equal to the LiveKit identity.
- **Encrypted calls (Element Call shared-key E2EE)**: the researcher pastes the call link when creating the session; the web parses `roomId` and `password` from the URL fragment (`parseElementCallLink`). The API stores the key sealed (`e2ee_key_ciphertext`, AES-256-GCM keyed by HKDF of `AGENT_SECRET`), never returns it (`e2eeEnabled` only), and erases it when the session ends. The worker reads it from `GET /sessions/:id/e2ee-key` (`x-agent-secret`) and connects with `sharedKeyE2eeOptions` — the password as UTF-8, PBKDF2, salt `LKFrameEncryptionKey`, GCM, verified against Element Call in both directions. An encrypted session without a readable key fails the job instead of joining deaf.
- A wrong key fails **silently** (no SDK event; Element Call shows nothing either): decryption yields digital silence. `DecryptionWatchdog` logs an error when an unmuted student track is all-zero for 5 s. Per-participant E2EE (Element Web/X, keys over Olm) is not supported.
- The appservice receives the bot's own `call.member` events: `handleCallMemberEvent` ignores `sender = MATRIX_BOT_USER_ID`, or the agent's membership would dispatch it again.
- Synapse drops a state event identical to the current state. Element Call does not always publish a leave on hang-up, so a rejoin can produce **no** event and no dispatch.
- Dispatch is idempotent **per session**: `ensureAgentDispatched` creates the room (dispatch RPCs time out on a room that does not exist yet), keeps an existing dispatch whose metadata carries the same `sessionId`, and retires any other MoniBot dispatch and agent participant first, so a leftover agent never logs a new student's turns under an earlier session. Ending a session retires its agent (best effort; skipped when the room is already closed, since dispatch RPCs on a missing room time out). `test:e2e` ends every fixture session it creates, which link to fake Matrix rooms.

## Worker pipeline

- Runs on **Bun** (`bun run src/main.ts dev|start`); verified end to end with real audio.
- One `AgentSession` per room. Session flags (`ragEnabled`, `avatarEnabled`, `llmModel`) are read from the API **once at join** and are immutable for the session.
- Local models only, all through OpenAI-compatible endpoints: STT `openai.STT({ baseURL: speaches, useRealtime: false })` (the plugin defaults to the Realtime API, which speaches does not serve), LLM `openai.LLM({ baseURL: ollama/v1 })`, TTS `openai.TTS({ baseURL: speaches })`. Turn detection **and** interruptions use the local VAD (`turnHandling: { turnDetection: 'vad', interruption: { mode: 'vad' } }`); the adaptive interruption detector is a hosted model.
- **RAG condition**: `TutorAgent.onUserTurnCompleted` retrieves and inserts `buildTutorContextMessage(chunks)` with `createdAt: newMessage.createdAt - 1`. The turn context already contains the student message; appending a system message *after* it makes Llama emit a literal `assistant` header. Retrieval failure throws `voice.StopResponse` (no silent answer without retrieval).
- **LLM-only condition**: no retrieval call at all; `ragLatencyMs = 0`, `retrievedChunks = []`.
- `avatarEnabled` only changes the web rendering; the worker publishes the same `AgentState` events in both conditions.
- DataChannel events (`agentStateEventSchema`): `listening` (user starts speaking), `searching_rag` + `studentTranscript` (RAG) or `thinking` + `studentTranscript` (LLM-only), `thinking`, `speaking` + `sources`, `idle` + `agentResponse`.
- Keep models resident (`OLLAMA_KEEP_ALIVE=-1`, `WHISPER__TTL=-1`): a cold model load inflates the measured latencies by seconds and confounds the experiment.
- Room lifecycle: the session starts with `inputOptions: { closeOnDisconnect: false }`. A student's client reconnecting (Element Call re-joining, a network blip) disconnects them with `CLIENT_INITIATED`, and the SDK default would close the voice session while the job stays in the room — the agent then remains visible in the call but deaf. Kept open, the audio input re-attaches when the same identity publishes a microphone track again. When only the agent is left, LiveKit closes the room (~20 s), which ends the job. Any `AgentSession` close also calls `ctx.shutdown()`, so a closed session never leaves the job (and its MatrixRTC membership) behind.

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
- The LiveKit Agents SDK itself logs transcripts (`lk.pii.transcript`, `lk.pii.user_transcript`) at **debug** level. Run real sessions with `LOG_LEVEL=info`; `debug` is for development with synthetic audio only.
- Never record raw audio unless the session explicitly has consent tracking (not implemented — do not add recording).

# MoniBot

Intelligent virtual teaching assistant for synchronous tutoring in **Fundamentos de Programação**. MoniBot joins a LiveKit (or MatrixRTC / Element Call) room as a voice participant, answers students' questions with a local speech → RAG → LLM → speech pipeline, and records per-turn latency and SUS/TAM questionnaires for a 2 × 2 experiment: **RAG on/off × avatar on/off**.

Everything runs locally: PostgreSQL + pgvector, Ollama, faster-whisper and Piper (via [speaches](https://github.com/speaches-ai/speaches)), LiveKit, and optionally Synapse + Element Call.

## Architecture

```
apps/web           Next.js — knowledge studio + RAG playground, sessions, live room with avatar, SUS/TAM form, analytics
apps/api           Bun + Hono — typed RPC (AppType), RAG ingestion/retrieval, LiveKit tokens + agent dispatch,
                   Matrix application service, telemetry, analytics, CSV/JSON export
apps/agent-worker  LiveKit Agents (Bun) — Silero VAD → Whisper → RAG → Ollama → Piper, DataChannel state, telemetry
packages/db        Drizzle schema (auth, knowledge, sessions, evaluations), pgvector HNSW, migrations
packages/types     Zod contracts shared by every app, plus the pedagogical prompts
packages/auth      Better Auth (email + password, student/researcher roles)
packages/logger    Structured logger
docker/            Dockerfile (api, web, agent-worker targets) and docker-compose.yml for the full stack
```

The browser only talks to the web origin: Next.js proxies `/api/*` to the API, so auth cookies are first-party.

## Requirements

- [Bun](https://bun.sh) 1.4+
- Podman or Docker (for Postgres, Ollama, speaches, LiveKit, Synapse)
- About 10 GB of disk for models; a GPU is optional (use speaches' `latest-cuda` tag and Ollama's GPU support)

## Quick start (development)

```bash
bun install
cp .env.example .env            # replace every change-me secret (openssl rand -base64 32)

# Infrastructure
podman run -d --name monibot-pg -e POSTGRES_USER=monibot -e POSTGRES_PASSWORD=monibot -e POSTGRES_DB=monibot \
  -v monibot-pg-data:/var/lib/postgresql/data -p 127.0.0.1:5432:5432 docker.io/pgvector/pgvector:pg16
podman run -d --name monibot-ollama -e OLLAMA_KEEP_ALIVE=-1 -v monibot-ollama:/root/.ollama \
  -p 127.0.0.1:11434:11434 docker.io/ollama/ollama
podman run -d --name monibot-speaches -e WHISPER__TTL=-1 -v monibot-speaches-cache:/home/ubuntu/.cache/huggingface \
  -p 127.0.0.1:8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu
podman run -d --name monibot-livekit --network host \
  docker.io/livekit/livekit-server:v1.13.10 --dev --bind 0.0.0.0   # host network: see Known limitations

# Models
podman exec monibot-ollama ollama pull nomic-embed-text-v2-moe
podman exec monibot-ollama ollama pull llama3.1:8b
curl -X POST http://127.0.0.1:8000/v1/models/Systran/faster-whisper-small
curl -X POST http://127.0.0.1:8000/v1/models/speaches-ai/piper-pt_BR-faber-medium

# Database + apps
bun run db:migrate
bun run dev:full                     # web :3000 + api :3001 + agent worker (`bun run dev` = web + api only)
```

Open http://localhost:3000 and sign up. Accounts start as **students**; promote a researcher with:

```bash
podman exec monibot-pg psql -U monibot -c "update \"user\" set role='researcher' where email='you@example.com'"
```

## Full stack with Compose

```bash
cp .env.example .env    # fill the secrets, including MATRIX_AS_TOKEN
docker compose -f docker/docker-compose.yml --env-file .env up -d --build
```

| Service | Port | Notes |
|---|---|---|
| web | 3000 | Next.js (built with `API_INTERNAL_URL=http://api:3001`) |
| api | 3001 | runs migrations on start |
| agent-worker | — | registers with LiveKit as `monibot` |
| postgres | 5432 | pgvector/pg16 |
| ollama | 11434 | `ollama-init` pulls the embedding and LLM models |
| speaches | 8000 | `speaches-init` downloads Whisper and Piper |
| livekit | 7880/7881/7882udp | host networking; dev keys `devkey` / `secret` |
| synapse | 8008 | local homeserver `localhost`, open registration, MoniBot appservice |
| lk-jwt-service | 8080 | LiveKit tokens for Element Call |
| element-call | 8090 | MatrixRTC client |

## Running a session

1. **Researcher** → *Base de conhecimento*: add lecture notes, exercise lists, past exams or code (fenced code blocks are never split). Try the *Playground RAG comparativo* to compare LLM vs LLM + RAG answers.
2. **Researcher** → *Sessões*: create a session and choose the condition (RAG on/off, avatar on/off). Optionally link a Matrix room ID.
3. **Student**: open the session from the home page, allow the microphone, and talk. The agent greets, listens, searches the material (RAG condition), thinks, and answers; the side panel shows the transcript and the sources.
4. **Student** → after leaving the room: the SUS/TAM questionnaire.
5. **Researcher** → *Métricas*: latency per pipeline stage (mean, p50, p95), SUS and TAM per condition; export CSV/JSON.

### Through Matrix / Element Call

MoniBot joins an Element Call call as a regular participant: it shows up as **MoniBot** in the call, hears the students and answers, including in end-to-end encrypted calls.

1. Start a call in Element Call and copy its link (*Invite* → *Copy link*).
2. **Researcher** → *Sessões*: paste the link into *Link da chamada Element Call*. The form fills the Matrix room and, for an encrypted call, captures the call key (the link's `password`). The sessions table then shows *chamada criptografada*.
3. The student joins the call. Synapse forwards the `m.call.member` event (MSC4143) to the MoniBot application service; the API finds the LiveKit room the student is connected to and dispatches the agent there, with the identity `@monibot:localhost:MONIBOT`.
4. The worker joins with the call key and reports its presence; the API publishes MoniBot's own MatrixRTC membership, which is what makes Element Call show it. If the worker dies, Synapse withdraws that membership by itself about 30 s later (MSC4140 delayed leave).
5. Ending the session removes the agent from the call and erases the stored key.

Create the session **before** the student joins. Element Call does not always publish a leave on hang-up, and Synapse drops an identical rejoin, so a student who leaves and rejoins the same call may not bring MoniBot back; start a new call instead.

For a local demonstration, run `bun run demo:up` (see *Local Element Call demo*).

### Local Element Call demo

`lk-jwt-service` validates the caller's Matrix OpenID token over the federation API, which for `server_name: localhost` means HTTPS on port 8448. `bun run demo:up` provides that without disabling TLS verification:

| Container | Role |
|---|---|
| `monibot-fed-tls` | Caddy terminating TLS on `:8448` with its own local CA, proxying to Synapse `:8008` |
| `monibot-lk-jwt` | `lk-jwt-service` trusting the public CAs **plus** that local CA (verification on) |
| `monibot-element-call` | Element Call on `:8090`, pointed at `127.0.0.1` (rootless Podman resets `::1`) |

It checks each piece, then prints the container table. `bun run demo:down` restores the defaults (no Caddy, `lk-jwt-service` with the image's own trust store, Element Call with `docker/element-call/config.json`). The local CA lives in `docker/demo/.data/` (git-ignored: it holds the CA private key).

Demo run:

```bash
bun run demo:up && bun run dev:full
# 1. http://localhost:8090 → start a call, copy its link
# 2. http://localhost:3000 (researcher) → Sessões → paste the link, create the session
# 3. join the call in Element Call → MoniBot appears and greets
podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"   # containers screenshot
bun run demo:down
```

Before presenting, do not run the API e2e suite or index documents: on a small GPU the embedding model evicts the LLM and the next answer times out while it reloads (`OLLAMA_EMBED_NUM_GPU=0` keeps the embedder on the CPU).

## Experimental design notes

- The two conditions differ **only** by one system message: the retrieved course material, placed right before the student's question (`packages/types/src/prompts.ts`). The playground uses the same structure.
- Telemetry per turn (ms): `sttLatencyMs`, `ragLatencyMs` (0 without RAG), `llmTtftMs`, `llmTotalLatencyMs`, `ttsLatencyMs`, `totalE2eLatencyMs` (student stops speaking → first agent audio). Incomplete turns are discarded with a logged reason, never stored with invented values.
- **Keep models resident** (`OLLAMA_KEEP_ALIVE=-1`, `WHISPER__TTL=-1`): a cold model load adds seconds to the first turn and would confound the comparison. Consider a warm-up turn before each session.
- Embeddings use `nomic-embed-text-v2-moe` (multilingual, 768-d): the English-centric v1 misranked Portuguese questions in testing. Changing the embedding model requires re-indexing every document.
- `RETRIEVAL_DEFAULT_MIN_SCORE` is 0.35, calibrated on a small sample. Re-tune it on the real course material.

## Testing

```bash
bun run typecheck && bunx @biomejs/biome check --write .
bun run test                                   # unit specs (chunking, SUS, telemetry, MatrixRTC helpers, sealed keys, E2EE watchdog, call links)
bun run --cwd apps/api test:e2e                # 37 HTTP checks (needs api + Postgres; LiveKit/Ollama optional)
E2E_STUDENT_EMAIL=… E2E_STUDENT_PASSWORD=… E2E_RESEARCHER_EMAIL=… E2E_RESEARCHER_PASSWORD=… \
  bun run --cwd apps/agent-worker test:voice-e2e <sessionId>   # one spoken turn through the whole stack
```

Set `E2E_REPORT_PATH=report.json` on either e2e suite for a machine-readable report.

## Configuration

All settings live in `.env` (see `.env.example`). Notable ones:

| Variable | Default | Purpose |
|---|---|---|
| `BETTER_AUTH_URL` / `WEB_ORIGIN` | `http://localhost:3000` | browser-facing origin |
| `API_INTERNAL_URL` | `http://localhost:3001` | where the web server reaches the API — **baked in at `next build`** |
| `AGENT_SECRET` | — | worker ↔ API authentication (`x-agent-secret`) |
| `MATRIX_WEBHOOK_SECRET` / `MATRIX_AS_TOKEN` | — | appservice `hs_token` / `as_token`; without `MATRIX_AS_TOKEN` the API cannot publish MoniBot's call membership, so Element Call does not show it |
| `MATRIX_HOMESERVER_URL` | `http://127.0.0.1:8008` | Synapse client-server API, used as the appservice bot |
| `MATRIX_BOT_USER_ID` | `@monibot:localhost` | the appservice's `sender_localpart` user |
| `OLLAMA_EMBED_MODEL` / `OLLAMA_LLM_MODEL` | `nomic-embed-text-v2-moe` / `llama3.1:8b` | sessions can override the LLM per session |
| `WHISPER_MODEL` / `TTS_MODEL` | `Systran/faster-whisper-small` / `speaches-ai/piper-pt_BR-faber-medium` | speaches models |

Never set `NODE_ENV` in `.env`: `next build` fails with `NODE_ENV=development`.

## Known limitations

- **LiveKit must use host networking** (Linux). Behind rootless-Podman or bridge port forwarding, browsers connect (ICE succeeds) but the media handshake times out (`connect timeout after ICE connected`). The API therefore reaches LiveKit at `host.docker.internal` in Compose and hands browsers `LIVEKIT_PUBLIC_URL`. On macOS/Windows Docker Desktop, host networking behaves differently; publish the ports and set LiveKit's `rtc.node_ip` instead.

- **Element Call** is verified locally (Element Call v0.28.0, Synapse 1.163.0, the pinned `lk-jwt-service` build, LiveKit 1.13.10) but has no automated UI test. Upgrading any of them can break the chain; they are pinned in `docker/docker-compose.yml` for that reason. A real deployment needs a resolvable homeserver name with TLS instead of the local Caddy CA.
- **E2EE**: only Element Call's shared-key mode (call link `password`) is supported. Per-participant keys (Element Web / Element X, keys exchanged over Olm) would need MoniBot to run a full Matrix crypto device. A wrong or missing key fails silently in LiveKit (the audio is digital silence); the worker logs `E2EE key mismatch?` when an unmuted student track stays silent for 5 s.
- **Rejoining a call**: a student who drops and comes back while MoniBot is still in the room (about 20 s after the last student left) is heard again. Later, once the room has closed, rejoining the same Element Call call may not trigger a new dispatch (identical membership, dropped by Synapse); start a new call.
- **Network changes break the appservice path** on rootless Podman: `host.containers.internal` keeps the host address from when Synapse started, so after switching networks Synapse can no longer deliver call memberships to the API (no error in the UI; Synapse logs `push_bulk … 504`). `bun run demo:up` detects this (even before the API is running) and restarts Synapse; otherwise run `podman restart monibot-synapse`. Memberships that Synapse delivers late, once the route is back, are treated as replays: the API dispatches the agent only if that member is still connected to LiveKit. After a restart, Synapse resumes the queued transactions only when the next event reaches it (any room), not at boot: until then `application_services_state` stays `down`.
- **`LOG_LEVEL=debug` logs transcripts**: the LiveKit Agents SDK writes `lk.pii.*` transcript fields at debug level. Use `LOG_LEVEL=info` for real sessions.
- **Coqui TTS** is not wired in; Piper (through speaches) is the TTS engine.
- On rootless Podman, `localhost` can resolve to `::1` where published ports may not answer; use `127.0.0.1` in scripts if a request hangs.

## Credentials

  Account   │           Email            │  Password  │

│ Researcher│ pesquisador@monibot.local  │ monibot123 │

│ Student   │ aluno@monibot.local        │ monibot123 │

│ Student 2 │ aluno2@monibot.com            │ monibot123 │

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
  docker.io/livekit/livekit-server --dev --bind 0.0.0.0   # host network: see Known limitations

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

Create a session with the Matrix room ID. When a participant starts a call in that room, Synapse sends the `m.call.member` event (MSC4143) to the MoniBot application service and the API dispatches the agent into the LiveKit room named by the call's MSC4195 focus. The homeserver → appservice → API → LiveKit → agent path is tested; the Element Call UI and `lk-jwt-service` are configured but not covered by automated tests (see *Known limitations*).

## Experimental design notes

- The two conditions differ **only** by one system message: the retrieved course material, placed right before the student's question (`packages/types/src/prompts.ts`). The playground uses the same structure.
- Telemetry per turn (ms): `sttLatencyMs`, `ragLatencyMs` (0 without RAG), `llmTtftMs`, `llmTotalLatencyMs`, `ttsLatencyMs`, `totalE2eLatencyMs` (student stops speaking → first agent audio). Incomplete turns are discarded with a logged reason, never stored with invented values.
- **Keep models resident** (`OLLAMA_KEEP_ALIVE=-1`, `WHISPER__TTL=-1`): a cold model load adds seconds to the first turn and would confound the comparison. Consider a warm-up turn before each session.
- Embeddings use `nomic-embed-text-v2-moe` (multilingual, 768-d): the English-centric v1 misranked Portuguese questions in testing. Changing the embedding model requires re-indexing every document.
- `RETRIEVAL_DEFAULT_MIN_SCORE` is 0.35, calibrated on a small sample. Re-tune it on the real course material.

## Testing

```bash
bun run typecheck && bunx @biomejs/biome check --write .
bun run test                                   # unit specs (chunking, SUS, turn telemetry, telemetry delivery)
bun run --cwd apps/api test:e2e                # 28 HTTP checks (needs api + Postgres; LiveKit/Ollama optional)
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
| `MATRIX_WEBHOOK_SECRET` / `MATRIX_AS_TOKEN` | — | appservice `hs_token` / `as_token` |
| `OLLAMA_EMBED_MODEL` / `OLLAMA_LLM_MODEL` | `nomic-embed-text-v2-moe` / `llama3.1:8b` | sessions can override the LLM per session |
| `WHISPER_MODEL` / `TTS_MODEL` | `Systran/faster-whisper-small` / `speaches-ai/piper-pt_BR-faber-medium` | speaches models |

Never set `NODE_ENV` in `.env`: `next build` fails with `NODE_ENV=development`.

## Known limitations

- **LiveKit must use host networking** (Linux). Behind rootless-Podman or bridge port forwarding, browsers connect (ICE succeeds) but the media handshake times out (`connect timeout after ICE connected`). The API therefore reaches LiveKit at `host.docker.internal` in Compose and hands browsers `LIVEKIT_PUBLIC_URL`. On macOS/Windows Docker Desktop, host networking behaves differently; publish the ports and set LiveKit's `rtc.node_ip` instead.

- **Element Call end to end** has not been exercised. `lk-jwt-service` validates Matrix OpenID tokens through federation, which needs a resolvable homeserver name (usually a real domain with TLS); the local `server_name: localhost` setup is enough for the appservice path but likely not for Element Call. Also confirm that the LiveKit room name `lk-jwt-service` assigns matches the focus `livekit_alias` the API adopts.
- **Coqui TTS** is not wired in; Piper (through speaches) is the TTS engine.
- On rootless Podman, `localhost` can resolve to `::1` where published ports may not answer; use `127.0.0.1` in scripts if a request hangs.

## Credentials

  Account   │           Email            │  Password  │

│ Researcher│ pesquisador@monibot.local  │ monibot123 │

│ Student   │ aluno@monibot.local        │ monibot123 │

│ Student 2 │ aluno2@monibot.com            │ monibot123 │

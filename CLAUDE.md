# MoniBot — Engineering Standards & Claude Code Rules

You are the Lead Full-Stack & AI Systems Architect building **MoniBot**: an Intelligent Virtual Teaching Assistant integrated into federated MatrixRTC and LiveKit video conferencing rooms for synchronous academic tutoring in Fundamentals of Programming[cite: 1, 2, 4].

---

## 0. Bootstrap Action: Generate `.claude/` Configuration
As your very first action when initializing this repository, create the following files inside `.claude/` so Claude Code has modular context and custom slash commands:
1. `.claude/rules/01-monorepo-tooling.md` (Bun workspaces, Turborepo, Biome rules, strict package boundaries)
2. `.claude/rules/02-backend-hono.md` (Hono RPC chaining, Zod validation, layered service pattern, error handling)
3. `.claude/rules/03-database-drizzle.md` (PostgreSQL + pgvector, Drizzle ORM conventions, HNSW vector indexing)[cite: 4]
4. `.claude/rules/04-frontend-nextjs.md` (Next.js App Router, RSC vs Client boundaries, Zustand stores, Hono RPC client)
5. `.claude/rules/05-voice-agent-matrix.md` (MatrixRTC MSC4143/MSC4195, LiveKit Agents STT-RAG-LLM-TTS pipeline, scientific telemetry)[cite: 1, 2, 7]
6. `.claude/commands/check.md` (Runs `bun run typecheck && bunx @biomejs/biome check --write .`)
7. `.claude/commands/db-sync.md` (Runs Drizzle schema generation and migrations across `@monibot/db`)

---

## 1. Core Runtime & Tooling Directives
- **Runtime & Package Manager**: Exclusively use **Bun** (`bun install`, `bun run`, `bunx`, `bun test`). Never use `npm`, `yarn`, or `pnpm`.
- **Linter & Formatter**: Exclusively use **Biome** (`@biomejs/biome`). Never install or configure ESLint or Prettier.
  - Indentation: 2 spaces
  - Quotes: Single quotes (`'`)
  - Semicolons: As needed
- **Verification Loop**: After creating or modifying any module, always run `bun run typecheck` and `bunx @biomejs/biome check --write .` via bash tool to verify zero type or lint regressions before completing a task.

---

## 2. Modular Monolith Workspace Boundaries
The repository is organized as a modular monolith managed by Bun Workspaces and Turborepo:
- `apps/web`: Next.js (App Router) frontend application.
- `apps/api`: Bun + Hono monolithic HTTP/RPC backend server.
- `apps/agent-worker`: LiveKit Agents SDK worker handling real-time audio (Silero VAD -> Whisper STT -> RAG -> Ollama Llama 3 -> Piper/Coqui TTS)[cite: 1, 3, 5].
- `packages/db` (`@monibot/db`): PostgreSQL + `pgvector` schemas, Drizzle ORM client, and vector similarity queries[cite: 4].
- `packages/auth` (`@monibot/auth`): Shared Better Auth configuration for Next.js and Hono.
- `packages/types` (`@monibot/types`): Shared Zod schemas, DTOs, and TypeScript contracts.
- `packages/logger` (`@monibot/logger`): Structured isomorphic logger (`createLogger('ModuleName')`). Never use raw `console.log` in application code.
- `packages/tsconfig` (`@monibot/tsconfig`): Shared strict TypeScript configurations.

---

## 3. TypeScript, Validation & End-to-End RPC Rules
- **Zero `any` Policy**: `strict: true` is mandatory across all packages. Never use `any` or `@ts-ignore`. Use `unknown` with Zod parsing.
- **Zod Single Source of Truth**: Define all request/response payloads in `@monibot/types` using Zod. Import those exact schemas into `apps/api` (`@hono/zod-validator`) and `apps/web` (forms and client validation).
- **Hono RPC Chaining**:
  - In `apps/api`, always chain route declarations (`const route = new Hono().get(...).post(...)`) so TypeScript infers the complete route tree.
  - Export `export type AppType = typeof app` from `apps/api/src/index.ts`.
  - In `apps/web`, consume the backend exclusively through Hono's typed client (`hc<AppType>()`).
- **Naming Conventions**:
  - Files and folders: `kebab-case` (e.g., `rag-retrieval.service.ts`, `avatar-canvas.tsx`)
  - React components: `PascalCase`
  - Functions, variables, instances: `camelCase`
  - SQL columns: `snake_case` (mapped to `camelCase` keys in Drizzle definitions)

---

## 4. Database & Vector Search Rules (`@monibot/db`)
- **Unified PostgreSQL + `pgvector`**: Store both relational data and 768-dimensional vector embeddings in a single PostgreSQL 16+ instance (`pgvector/pgvector:pg16`).
- **Drizzle ORM Standard**: Write all queries using `drizzle-orm/postgres-js`. Use Drizzle's native vector helpers (`cosineDistance`, `sql`) and create an HNSW index (`vector_cosine_ops`) on the chunk embeddings table[cite: 4].
- **Domain Schema Split**: Organize `packages/db/src/schema/` into modular files:
  - `auth.ts` (Users, sessions, accounts)
  - `knowledge.ts` (`knowledgeDocuments`, `knowledgeChunks`)[cite: 4]
  - `sessions.ts` (`tutoringSessions`, `interactionLogs`)[cite: 1, 3, 5]
  - `evaluations.ts` (`userEvaluations` for SUS and TAM scales)[cite: 5, 7]

---

## 5. Backend Monolith Architecture (`apps/api`)
- **Strict Separation of Concerns**:
  - `src/routes/*.routes.ts`: Route definitions, `zValidator` middleware, auth checks, and HTTP status formatting only.
  - `src/services/*.service.ts`: Business logic (document chunking, Ollama embedding requests, `pgvector` similarity search, Matrix room event hooks, LiveKit token generation, and agent dispatch)[cite: 2, 4, 5].
  - `src/middlewares/*.middleware.ts`: Better Auth session extraction, internal worker authentication (`x-agent-secret`), and global error handling.
- **Standard Error Envelope**: All errors must return `{ success: false, error: { code: string, message: string, details?: unknown } }`.

---

## 6. Frontend Architecture (`apps/web`)
- **Server Components First**: Keep pages and layouts as React Server Components by default. Mark leaf interactive units with `'use client'`.
- **State Management**:
  - Async server state: **TanStack Query** wrapping the Hono RPC client.
  - Synchronous UI, room controls, and real-time voice/avatar state: **Zustand** stores inside `src/stores/`.
- **Design System**: Tailwind CSS + Shadcn UI components (`src/components/ui/`).

---

## 7. Scientific Experimentation & Real-Time Voice Requirements
- **Pedagogical System Prompt**: MoniBot acts as a tutor for *Fundamentals of Programming*[cite: 4]. When answering student questions, it must guide logical reasoning rather than handing out ready-made assignment solutions, grounding responses in the retrieved course material whenever RAG is active[cite: 1, 2, 4].
- **Independent Experimental Variables**: Every tutoring session must explicitly store and enforce two experimental flags[cite: 1, 3, 5]:
  1. `ragEnabled` (`boolean`): Compares LLM + RAG vs. isolated LLM[cite: 1, 2, 3, 5].
  2. `avatarEnabled` (`boolean`): Compares Avatar visual presence vs. audio-only interaction[cite: 3, 5].
- **Granular Latency Telemetry**: Every voice interaction turn must measure and persist millisecond durations for[cite: 1, 3, 4, 5, 7]:
  - `sttLatencyMs` (Whisper speech-to-text duration)[cite: 3, 5]
  - `ragLatencyMs` (Embedding + `pgvector` retrieval duration; `0` when `ragEnabled = false`)[cite: 4, 5]
  - `llmTtftMs` & `llmTotalLatencyMs` (Ollama Llama 3 time-to-first-token and total generation time)[cite: 3, 5]
  - `ttsLatencyMs` (Piper/Coqui text-to-speech synthesis time)[cite: 3, 5]
  - `totalE2eLatencyMs` (End of user speech VAD event to first audio frame transmitted to LiveKit)[cite: 3, 5, 7]

---

## 8. Claude Code Configuration Map
This file holds the repo-wide rules. Area detail lives in `.claude/rules/*.md`, loaded automatically by path when you edit matching files; read the relevant one before editing in that area.

| Rule | Scope |
|---|---|
| `.claude/rules/01-monorepo-tooling.md` | root configs, `package.json`s, tsconfig presets, boundaries, naming, hygiene |
| `.claude/rules/02-backend-hono.md` | `apps/api/**` — RPC chaining, `zValidator`, layers, error envelope, auth |
| `.claude/rules/03-database-drizzle.md` | `packages/db/**` — schema split, pgvector, HNSW, queries, migrations |
| `.claude/rules/04-frontend-nextjs.md` | `apps/web/**` — RSC boundary, `hc<AppType>`, TanStack Query, Zustand |
| `.claude/rules/05-voice-agent-matrix.md` | `apps/agent-worker/**`, LiveKit/Matrix routes and services, `docker/**` — pipeline, Matrix appservice, MSC4143/MSC4195, telemetry assembly |
| `.claude/rules/06-shared-contracts.md` | `packages/types/**` — Zod naming, envelopes, constants |

**Skills** (`.claude/skills/`): `add-api-endpoint` (contract → service → route → RPC hook), `add-telemetry-metric` (new research measurement end to end), `db-migrate` (safe schema changes, pgvector specifics), `you-might-not-need-a-comment`, `you-might-not-need-an-effect`.

**Commands** (`.claude/commands/`): `/check` (typecheck + Biome), `/db-sync` (generate + apply migrations).

---

## 9. Code Conventions (Repo-Wide)
- **No non-null assertions** (`!`) in addition to the zero-`any` policy. Narrow with guards or Zod.
- **Comments**: names explain *what*; a comment exists only for a non-obvious *why*. TSDoc on exported APIs. No banner separators or commented-out code.
- **Unused bindings** fail lint: delete the dead variable, import, or parameter instead of prefixing `_`.
- **Imports**: `import type` for type-only imports; import packages only through their `exports` entry points.
- **Env**: each app parses `process.env` once with Zod in `src/env.ts`; nothing else reads `process.env` directly (packages accept config or read a single documented variable such as `DATABASE_URL`).
- **Research data**: transcripts, answers, and evaluations are never logged to stdout; they go only to their tables.

---

## 10. Testing
Prefer tests that hit real boundaries over unit tests that restate implementation:
- Pure, high-value logic (SUS scoring, chunking that must preserve code blocks, percentile aggregation) gets focused `bun test` specs written from its failure modes *before* the code.
- Endpoints are verified against the running API with a real Postgres (`docker compose`), not by mocking Drizzle.
- Never write tests that only assert schemas accept valid input, or mock every collaborator and assert call arguments.

---

## 11. How Your Work Is Checked
Before declaring a change done, run from the repo root:

```bash
bun run typecheck                    # every workspace via Turborepo
bunx @biomejs/biome check --write .  # format + lint with autofix
```

When `packages/db/src/schema/**` changed, also run `bun run db:generate` and confirm a second run reports no changes. When a check fails, fix the code — never relax the rule or the config.

End-to-end suites (need the running stack; see `README.md`):

```bash
bun run test                                        # unit specs in every workspace
bun run --cwd apps/api test:e2e                     # 28 HTTP checks against a real Postgres
bun run --cwd apps/agent-worker test:voice-e2e <id> # one spoken turn through LiveKit + models
```

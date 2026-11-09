---
description: Hono RPC chaining, zValidator with shared Zod contracts, layered routes/services/middlewares, and the error envelope
paths:
  - "apps/api/**"
---

# Backend — Bun + Hono Monolith (`apps/api`)

## Layout

```
apps/api/src/
├── index.ts                    # composes routers, exports AppType, Bun.serve entry
├── env.ts                      # Zod-parsed process.env (single read site)
├── routes/<domain>.routes.ts   # HTTP surface only
├── services/<domain>.service.ts# business logic
├── middlewares/<name>.middleware.ts
└── lib/                        # http errors, response helpers, small shared utils
```

## Layer responsibilities

| Layer | Does | Never does |
|---|---|---|
| `routes/*.routes.ts` | declare paths, `zValidator`, auth middleware, map service result → status + JSON | query the DB, call Ollama/LiveKit/Matrix, contain branching business rules |
| `services/*.service.ts` | chunking, embeddings, pgvector search, LiveKit tokens + agent dispatch, Matrix hooks, analytics, SUS scoring | read `Context`, return `Response`, know about HTTP status codes |
| `middlewares/*.middleware.ts` | Better Auth session extraction, `x-agent-secret` worker auth, request logging, global `onError` | business logic |

Services are plain functions (or a factory taking dependencies) that accept typed input and return typed output or throw an `HttpError`/domain error. They are testable without Hono.

## RPC chaining (mandatory)

TypeScript infers the client route tree only from a **single chained expression**. Never build a router with separate statements.

```ts
import { createKnowledgeDocumentSchema, retrieveRequestSchema } from '@monibot/types'
import { Hono } from 'hono'
import { success } from '../lib/envelope'
import { validate } from '../lib/validate'
import { requireResearcher, requireSession, requireUserOrAgent } from '../middlewares/auth.middleware'
import { createDocument, listDocuments, retrieveChunks } from '../services/rag.service'

export const knowledgeRoutes = new Hono()
  .get('/documents', requireSession, async (c) => c.json(success(await listDocuments()), 200))
  .post('/documents', requireResearcher, validate('json', createKnowledgeDocumentSchema), async (c) =>
    c.json(success(await createDocument(c.req.valid('json'))), 201)
  )
  .post('/retrieve', requireUserOrAgent, validate('json', retrieveRequestSchema), async (c) =>
    c.json(success(await retrieveChunks(c.req.valid('json'))), 200)
  )
```

`index.ts` defines the app and exports `AppType` without starting a server; `server.ts` calls `Bun.serve`, so importing `AppType` never boots the API.

```ts
// index.ts
const app = new Hono()
  .basePath('/api')
  .route('/knowledge', knowledgeRoutes)
  .route('/sessions', sessionsRoutes)

export type AppType = typeof app
```

- `export type AppType = typeof app` lives in `apps/api/src/index.ts` and nowhere else.
- Always pass an explicit status to `c.json(data, status)` for non-200 responses so the client sees the status union.
- Mount Better Auth with `.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))`.

## Validation

- Every `json`, `query`, `param`, and `header` input goes through `zValidator(target, schema)` with a schema imported from `@monibot/types`. Routes never import `zod` to define ad-hoc schemas.
- Use `validate(target, schema)` from `src/lib/validate.ts` (a `zValidator` wrapper), so a failed validation returns the standard envelope with code `VALIDATION_ERROR` and `details` = the Zod issues.
- Read validated input only via `c.req.valid(target)` — never `c.req.json()`.

## Error envelope

Every error response is:

```ts
{ success: false, error: { code: string, message: string, details?: unknown } }
```

- Throw `new HttpError(status, code, message, details?)` from services; the global `app.onError` handler maps it (and any unknown error → `500 INTERNAL_ERROR`, message redacted, full error logged).
- Success responses are `{ success: true, data }`. The envelope schemas live in `@monibot/types` (`apiErrorSchema`, `apiSuccess(schema)`).
- Codes are `SCREAMING_SNAKE_CASE` and stable: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UPSTREAM_UNAVAILABLE` (Ollama/LiveKit/Matrix down), `INTERNAL_ERROR`.

## Auth

- Student/researcher endpoints: `requireSession` / `requireResearcher` from `auth.middleware.ts`, applied **per route** (one router mixes user, researcher, agent, and webhook routes). They set `c.var.user`.
- Role checks must bypass Better Auth's cookie cache (`query: { disableCookieCache: true }`) — the cached cookie holds a copy of `role` for up to five minutes.
- Endpoints both the worker and users read (session flags, retrieval) use the explicit `requireUserOrAgent`.
- Worker endpoints (`POST /telemetry/logs`, RAG retrieval called by the worker): `requireAgentSecret` compares `x-agent-secret` against `env.AGENT_SECRET` with a timing-safe comparison. Never accept both auth modes on the same route implicitly.
- Matrix webhook: verify the homeserver/appservice token before parsing the body.

## External calls

- Ollama (`/api/embed`, `/api/chat`), LiveKit server SDK, and Matrix client-server API calls live in their own service files with a timeout (`AbortSignal.timeout(ms)`) and map failures to `UPSTREAM_UNAVAILABLE`.
- Measure retrieval latency with `performance.now()` inside the service and return it (`ragLatencyMs`) — the route never times anything.

## Verification

- Pure logic (chunking, SUS scoring) has `bun test` specs next to the service.
- `bun run --cwd apps/api test:e2e` drives the running API over HTTP against a real Postgres (sign-up, roles, envelopes, telemetry, analytics, export, webhook). Set `E2E_REPORT_PATH` for a JSON report. Add a check there for every new endpoint.

## Logging

`const logger = createLogger('RagService')` at module top. Log at boundaries (request failed, upstream error, ingestion finished with N chunks) — never log full transcripts, embeddings, or secrets.

---
description: Zod single source of truth in @monibot/types — schema naming, envelopes, constants, and how API/web/worker consume contracts
paths:
  - "packages/types/**"
---

# Shared Contracts — `@monibot/types`

## Purpose

Every payload that crosses a process boundary (web ↔ api, worker ↔ api, DataChannel, DB JSONB columns) is defined **once** here as a Zod schema. Types are inferred from schemas, never hand-written alongside them.

## Layout

```
packages/types/src/
├── index.ts          # barrel
├── constants.ts      # as const tuples + numeric constants (EMBEDDING_DIMENSIONS, KNOWLEDGE_CATEGORIES…)
├── common.ts         # api envelopes, pagination, uuid/likert primitives
├── knowledge.ts      # documents, chunks, retrieval
├── sessions.ts       # tutoring sessions, LiveKit token, Matrix webhook events
├── telemetry.ts      # interaction logs, agent state, analytics
└── evaluations.ts    # SUS / TAM
```

## Conventions

- Schema names are `camelCase` + `Schema`: `createTutoringSessionSchema`. The inferred type drops the suffix and is `PascalCase`: `export type CreateTutoringSession = z.infer<typeof createTutoringSessionSchema>`.
- Request schemas: `create*Schema`, `update*Schema`, `*QuerySchema`, `*ParamsSchema`. Response DTOs: `*Schema` named after the resource (`tutoringSessionSchema`).
- Enumerations: an `as const` tuple in `constants.ts` (`KNOWLEDGE_CATEGORIES`), a `z.enum(TUPLE)` here, and a `pgEnum(..., TUPLE)` in `@monibot/db`. Never repeat the literal values elsewhere.
- Dates on the wire are ISO strings (`z.iso.datetime()`); the API serializes `Date` before responding.
- Use `z.coerce` only for `query`/`param` targets (strings on the wire). JSON bodies are strict.
- Defaults that matter to the experiment (`ragEnabled`, `avatarEnabled`, `topK`, `minScore`) are declared with `.default()` here so API and UI agree.
- This package depends on `zod` only. No Node/Bun/DOM APIs, no logger, no DB.

## Consumption

- `apps/api`: `zValidator('json', createTutoringSessionSchema)`.
- `apps/web`: `zodResolver(createTutoringSessionSchema)` and inferred types for props.
- `apps/agent-worker`: parse API responses and DataChannel messages with `.parse()`; build telemetry with `interactionLogCreateSchema`.
- `@monibot/db`: `.$type<RetrievedChunk[]>()` for JSONB columns.

Changing a schema is a contract change: update every consumer in the same change and run `bun run typecheck` at the root.

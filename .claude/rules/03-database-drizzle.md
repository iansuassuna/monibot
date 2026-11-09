---
description: PostgreSQL 16 + pgvector with Drizzle ORM — schema split, column conventions, HNSW cosine index, similarity queries, and migrations
paths:
  - "packages/db/**"
---

# Database — `@monibot/db`

## Stack

- One PostgreSQL 16 instance (`pgvector/pgvector:pg16`) holds relational data **and** 768-dimensional embeddings (`nomic-embed-text-v2-moe` via Ollama, multilingual; queries and passages carry the `search_query: ` / `search_document: ` prefixes). Never introduce a separate vector store.
- Driver: `postgres` (postgres-js). ORM: `drizzle-orm/postgres-js`. Migrations: `drizzle-kit`.

## Layout

```
packages/db/
├── drizzle.config.ts
├── migrations/               # generated SQL + meta journal (committed)
└── src/
    ├── index.ts              # public entry: db client, schema, queries, types
    ├── client.ts             # createDb(url) + default db from DATABASE_URL
    ├── migrate.ts            # programmatic migrator (bun run db:migrate)
    ├── schema/
    │   ├── index.ts          # re-exports every table + relations
    │   ├── auth.ts           # users, authSessions, accounts, verifications (Better Auth)
    │   ├── knowledge.ts      # knowledgeDocuments, knowledgeChunks
    │   ├── sessions.ts       # tutoringSessions, interactionLogs
    │   └── evaluations.ts    # userEvaluations (SUS + TAM)
    └── queries/
        └── knowledge.ts      # searchSimilarChunks (cosine similarity)
```

## Column conventions

- SQL names `snake_case`, Drizzle keys `camelCase`: `chunkIndex: integer('chunk_index').notNull()`.
- Primary keys on domain tables: `uuid('id').primaryKey().defaultRandom()`. Better Auth tables use `text('id')` (Better Auth generates the IDs).
- Timestamps: `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()`. Always `withTimezone`.
- Enumerations: `pgEnum` whose values come from the `as const` tuples in `@monibot/types` (e.g. `KNOWLEDGE_CATEGORIES`) — one source of truth for DB, API, and UI.
- JSONB columns are typed with `.$type<T>()` where `T` is inferred from the matching Zod schema in `@monibot/types`.
- Foreign keys to a parent aggregate use `onDelete: 'cascade'` (chunks → document, logs/evaluations → session).
- Export row types with `typeof table.$inferSelect` / `$inferInsert`.

## Experimental flags and telemetry

- `tutoring_sessions.rag_enabled` and `avatar_enabled` are `boolean NOT NULL` with defaults — never nullable, never derived. They are the independent variables of the experiment.
- `interaction_logs` stores every latency as `integer NOT NULL` milliseconds: `stt_latency_ms`, `rag_latency_ms` (0 when RAG is disabled), `llm_ttft_ms`, `llm_total_latency_ms`, `tts_latency_ms`, `total_e2e_latency_ms`. Never store seconds or floats; never allow `NULL` to mean "not measured".

## Vectors

```ts
embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull()
```

```ts
(table) => [
  index('knowledge_chunks_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
]
```

- Dimensions come from `EMBEDDING_DIMENSIONS` in `@monibot/types`. Changing the embedding model is a migration (new column, re-embed, swap), never an in-place edit.
- Similarity is `1 - cosineDistance(...)`; order by the **distance** expression (ascending) so the HNSW index is used, then filter by `minScore`.

```ts
const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryEmbedding)})`
await db
  .select({ id: knowledgeChunks.id, content: knowledgeChunks.content, score: similarity })
  .from(knowledgeChunks)
  .where(gt(similarity, minScore))
  .orderBy(cosineDistance(knowledgeChunks.embedding, queryEmbedding))
  .limit(topK)
```

- Insert chunks for one document in a single batched `insert().values([...])` inside a transaction together with the document status update.

## Query rules

- Queries live in `src/queries/` (reusable, cross-app) or in `apps/api` services (domain-specific). Never in route handlers or React code.
- Select explicit columns on wide tables (`knowledgeDocuments.rawText`, `knowledgeChunks.embedding`) — never send embeddings or raw documents over the wire unless the endpoint is for them.
- Use `db.transaction(async (tx) => ...)` for multi-statement writes; pass `tx` down, never mix `db` and `tx` inside one unit.

## Migrations

- Edit `src/schema/*.ts`, then `bun run db:generate`. Commit the generated SQL and `meta/` journal together with the schema change.
- The first migration enables the extension: `CREATE EXTENSION IF NOT EXISTS vector;` must precede any `vector` column. Keep it there.
- Never edit an applied migration. Fix forward with a new one.
- After generating, re-run `bun run db:generate` — it must report no changes.
- Use the `db-migrate` skill for anything beyond an additive change.

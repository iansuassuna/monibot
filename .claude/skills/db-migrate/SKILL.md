---
name: db-migrate
description: Author or review a Drizzle migration for @monibot/db safely — additive-first changes, pgvector/HNSW specifics, preserving experiment data, and verifying generate is idempotent. Use when editing packages/db/src/schema/** or files under packages/db/migrations/.
---

# DB Migrate

The database holds **research data** (interaction logs, latency telemetry, SUS/TAM answers). A migration that loses or silently rewrites it invalidates the experiment. Treat every destructive change as needing explicit user confirmation.

## Workflow

1. Edit the schema file in `packages/db/src/schema/` (keep the domain split: `auth`, `knowledge`, `sessions`, `evaluations`). New enum values go in the `as const` tuple in `@monibot/types` first.
2. `bun run db:generate`.
3. Read the generated SQL. Classify each statement:

| Statement | Verdict |
|---|---|
| `CREATE TABLE`, `ADD COLUMN` nullable or with `DEFAULT`, `CREATE INDEX` on a new table | safe |
| `ALTER TYPE ... ADD VALUE` | safe (cannot run inside a transaction with other uses of the value — keep it in its own migration) |
| `ADD COLUMN ... NOT NULL` without default | rewrite: add nullable → backfill → `SET NOT NULL` in a later migration |
| `RENAME COLUMN/TABLE` | drizzle-kit asks interactively; prefer add-new → copy → drop-old |
| `DROP COLUMN/TABLE` on `interaction_logs`, `user_evaluations`, `tutoring_sessions` | **stop and ask the user** — this destroys experiment data |
| `ALTER COLUMN ... TYPE` on a latency column | stop — latencies must stay `integer` ms |
| `CREATE INDEX` on a populated table | add `CONCURRENTLY` in a separate migration file with `--> statement-breakpoint` |

4. Re-run `bun run db:generate`. It must print no changes — otherwise the schema and migrations disagree.
5. `bun run db:migrate` against the local Postgres (`docker compose -f docker/docker-compose.yml up -d postgres`).
6. `bun run typecheck` at the root.

## pgvector specifics

- The very first migration must contain `CREATE EXTENSION IF NOT EXISTS vector;` before any `vector(...)` column. drizzle-kit does not emit it — keep the hand-added line.
- **Changing embedding dimensions** (new embedding model): add a new `vector(N)` column + new HNSW index, re-embed all chunks via the API ingestion service, switch reads, then drop the old column in a later migration. Never `ALTER COLUMN TYPE vector(N)` — existing vectors can't be cast.
- HNSW index: `USING hnsw (embedding vector_cosine_ops)`. If you change the distance operator in queries, the operator class must change with it, or the index is ignored.
- Building HNSW on a large table is slow and memory-heavy; for re-indexing, set `maintenance_work_mem` in that migration and use `CREATE INDEX CONCURRENTLY`.

## Hard rule

Never edit a migration that has already been applied anywhere. Fix forward.

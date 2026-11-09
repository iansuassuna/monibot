---
description: Generate Drizzle migrations from the @monibot/db schema and apply them to DATABASE_URL
argument-hint: "[--generate-only]"
allowed-tools: Bash(bun run db:*), Bash(bun run --cwd packages/db:*), Bash(docker compose:*)
---

# DB Sync

Synchronize the database with `packages/db/src/schema/**`.

Arguments: $ARGUMENTS

1. **Generate**: `bun run db:generate` (runs `drizzle-kit generate` in `@monibot/db`).
   - Inspect the new SQL file under `packages/db/migrations/`. If it drops or renames a column/table, or adds `NOT NULL` without a default, stop and follow the `db-migrate` skill before continuing.
   - The first migration must start with `CREATE EXTENSION IF NOT EXISTS vector;`.
2. **Verify idempotence**: run `bun run db:generate` again — it must report no schema changes.
3. Unless `--generate-only` was passed:
   - Confirm Postgres is reachable at `DATABASE_URL` (start it with `docker compose -f docker/docker-compose.yml up -d postgres` if the compose file exists).
   - **Migrate**: `bun run db:migrate`.
4. Run `bun run typecheck` so every consumer of the changed schema still compiles.
5. Report the migration file(s) created and whether they were applied.

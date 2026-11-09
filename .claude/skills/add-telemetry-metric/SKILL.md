---
name: add-telemetry-metric
description: Add a new per-turn measurement or experimental variable to the research pipeline — contract, DB column, worker instrumentation, telemetry ingestion, analytics aggregation, dashboard, and CSV export. Use when the study needs a new latency, counter, or session-level flag.
argument-hint: "<metricName> — <start event> → <end event>"
---

# Add Telemetry Metric

Request: $ARGUMENTS

A metric is only useful to the study if it is defined precisely, measured the same way in every condition, and survives all the way to the exported dataset. Touch every layer below in one change.

## 0. Define it

Write down, before coding:

- **Name** in camelCase ending in the unit (`vadLatencyMs`, `retrievedChunkCount`).
- **Start and end events** (exact code points in the worker).
- **Value in each experimental condition** — especially when `ragEnabled = false` or `avatarEnabled = false`. Prefer a defined value (`0`) over `null`; if `null` is truly meaningful, document why.

Confirm the definition with the user if it is ambiguous.

## 1. Contract — `packages/types/src/telemetry.ts`

- Add the field to `interactionLogCreateSchema` (`z.number().int().nonnegative()` for ms) and to the analytics response schema.

## 2. Storage — `packages/db/src/schema/sessions.ts`

- New `integer('<snake_name>')` column. Existing rows have no value: add it with `.notNull().default(0)` **only** if 0 is a truthful historical value; otherwise nullable, and say so in the analytics output.
- Follow the `db-migrate` skill.

## 3. Instrumentation — `apps/agent-worker`

- Mark start/end on the turn's `TurnTimer` with `performance.now()`.
- Include it in the telemetry POST.

## 4. Ingestion & analytics — `apps/api`

- `telemetry.routes.ts` needs no change if it validates with the shared schema; the service insert must map the new field.
- `analytics.service.ts`: add mean, p50, p95, stddev for the field, grouped by `ragEnabled × avatarEnabled`.
- Export (`GET /evaluations/export`): add the column to CSV and JSON.

## 5. Dashboard — `apps/web/src/app/dashboard/analytics`

- Add the series to the latency comparison.

## 6. Verify

- `bun run typecheck && bunx @biomejs/biome check --write .`
- Run one real voice turn and confirm the row in `interaction_logs` has a plausible value in both RAG conditions.

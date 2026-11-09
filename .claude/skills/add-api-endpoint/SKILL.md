---
name: add-api-endpoint
description: Add or change an API endpoint end to end — Zod contract in @monibot/types, service in apps/api, chained Hono route with zValidator, and the typed RPC + TanStack Query hook in apps/web. Use whenever a new route, request field, or response field is introduced.
argument-hint: "<METHOD> <path> — <what it does>"
---

# Add API Endpoint

Request: $ARGUMENTS

Follow this order. Each step must typecheck before the next.

## 1. Contract — `packages/types/src/<domain>.ts`

- Define the request schema (`create*Schema`, `*QuerySchema`, `*ParamsSchema`) and the response DTO schema.
- Export inferred types (`export type X = z.infer<typeof xSchema>`). Re-export from `src/index.ts`.
- Put experiment-relevant defaults in the schema (`.default(...)`).

## 2. Data — `packages/db` (only if storage changes)

- Use the `db-migrate` skill.

## 3. Service — `apps/api/src/services/<domain>.service.ts`

- Plain async functions taking validated, typed input (`CreateX`) and returning the DTO shape.
- Throw `HttpError(status, CODE, message, details?)` for expected failures (`NOT_FOUND`, `CONFLICT`, `UPSTREAM_UNAVAILABLE`).
- Measure any latency the experiment needs with `performance.now()` here.
- No `Context`, no `Response`, no status codes.

## 4. Route — `apps/api/src/routes/<domain>.routes.ts`

- Add to the **existing chain** (`.get(...).post(...)`), never as a separate statement.
- `zValidator(target, schema, validationHook)` for every input; read with `c.req.valid(target)`.
- Apply `requireSession` (users) or `requireAgentSecret` (worker) explicitly.
- Respond `c.json({ success: true as const, data }, status)`.
- If it's a new router, mount it in `apps/api/src/index.ts` with `.route('/<domain>', router)` in the `app` chain so `AppType` includes it.

## 5. Client — `apps/web`

- Add the key to the domain's key factory in `src/hooks/queries/<domain>.ts`.
- `useQuery` / `useMutation` calling `rpc.api.<domain>.<path>.$<method>(...)` and `unwrap()`; pass `signal` for queries; invalidate through the key factory on mutation success.
- Forms reuse the same Zod schema via `zodResolver`.

## 6. Worker (only if the agent calls it)

- Call with `fetch` + `x-agent-secret`, parse the response with the `@monibot/types` schema.

## 7. Verify

```bash
bun run typecheck && bunx @biomejs/biome check --write .
```

Then exercise the endpoint against the running API (`curl` with a real session cookie or `x-agent-secret`) and show the status and envelope returned. A route that typechecks but was never called is not done.

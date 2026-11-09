---
description: Bun workspaces, Turborepo pipeline, Biome, package boundaries, naming, and the shared tsconfig presets
paths:
  - "package.json"
  - "turbo.json"
  - "biome.json"
  - "bunfig.toml"
  - "apps/*/package.json"
  - "packages/*/package.json"
  - "packages/*/tsconfig.json"
  - "apps/*/tsconfig.json"
  - "packages/tsconfig/**"
---

# Monorepo Tooling

## Toolchain

- **Bun only**: `bun install`, `bun add`, `bun run`, `bunx`, `bun test`. Never `npm`, `npx`, `yarn`, `pnpm`; never commit a `package-lock.json` or `yarn.lock`.
- **Biome only**: never add ESLint, Prettier, or their config files and directives (`eslint-disable`, `prettier-ignore`). A suppression is `// biome-ignore <rule>: <reason>` and must carry a real reason.
- **Turborepo** orchestrates per-workspace scripts. Root scripts delegate (`turbo run typecheck`), they never `cd` into a workspace.
- `bunfig.toml` pins exact versions (`exact = true`); there is no minimum release age, so `bun add` resolves the newest published version. Add dependencies with `bun add <pkg>` inside the workspace (`bun add --cwd packages/db drizzle-orm`), never by hand-editing a version you did not resolve.

## Env files in scripts

- Load the root env with `bun --env-file=../../.env run <bin>` — **never** `bun --env-file=… x <bin>`: `bun x` does not pass the env file to the spawned command.
- `.env` never sets `NODE_ENV`; each tool sets it.

## Workspace layout

```
apps/
├── web/            # Next.js App Router frontend
├── api/            # Bun + Hono monolith (REST/RPC, AppType)
└── agent-worker/   # LiveKit Agents worker (VAD → STT → RAG → LLM → TTS)
packages/
├── tsconfig/       # @monibot/tsconfig — base, bun, library, nextjs presets
├── logger/         # @monibot/logger — createLogger('Module')
├── types/          # @monibot/types — Zod contracts, DTOs, shared constants
├── db/             # @monibot/db — Drizzle schema, client, pgvector queries, migrations
└── auth/           # @monibot/auth — Better Auth server instance + client factory
```

## Package boundaries

- `apps/* → packages/*` only. A package never imports from `apps/*`, and an app never imports another app (the web app consumes the API through `hc<AppType>` — a **type-only** import of `AppType`).
- Dependency direction between packages: `tsconfig ← logger ← types ← db ← auth`. Never create a cycle; `@monibot/types` must stay runtime-light (only `zod`) because the browser bundles it.
- `@monibot/db` and `@monibot/auth` are server-only. Never import them from a `'use client'` module or from `apps/web` client code; the web app reaches data through the API.
- Each package exposes an explicit `exports` map pointing at TypeScript source (`"types"` + `"default"` → `./src/*.ts`). Import only through those entry points — never `@monibot/db/src/...`.
- Internal dependencies use `"workspace:*"`.

## Package scripts contract

Every workspace defines the scripts Turbo runs:

```json
{
  "typecheck": "tsc --noEmit",
  "lint": "biome check --write .",
  "lint:check": "biome check ."
}
```

Apps additionally define `dev`, `build`, `start`. Add a new Turbo task to `turbo.json` before relying on it from the root.

## TypeScript presets

| Preset | Use for |
|---|---|
| `@monibot/tsconfig/library.json` | isomorphic packages (`logger`, `types`) |
| `@monibot/tsconfig/bun.json` | server code on Bun (`db`, `auth`, `apps/api`, `apps/agent-worker`) |
| `@monibot/tsconfig/nextjs.json` | `apps/web` |

All extend `base.json` (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`). Never loosen a strictness flag in a leaf tsconfig.

## Naming

- Files and folders: `kebab-case` (`rag-retrieval.service.ts`, `avatar-canvas.tsx`). Inside a package's `src/`, a file never repeats its folder's name (`schema/knowledge.ts`, not `schema/knowledge-schema.ts`).
- React components `PascalCase`; functions, variables, instances `camelCase`; module-level constants `SCREAMING_SNAKE_CASE`; types and interfaces `PascalCase`.
- SQL identifiers `snake_case`, mapped to `camelCase` Drizzle keys.

## Code hygiene

- **No `any`, no `@ts-ignore`, no non-null `!`.** Use `unknown` + Zod parsing or a narrowing guard. `@ts-expect-error` only with a reason, and only in tests.
- `import type` for type-only imports (`verbatimModuleSyntax` enforces it).
- **Logging**: `createLogger('ModuleName')` from `@monibot/logger`. Never `console.*` in application code (Biome `noConsole` is an error everywhere except the logger itself).
- **Comments**: names explain *what*; a comment explains only a non-obvious *why*. TSDoc on exported APIs. No banner separators, no commented-out code.
- Unused variables, imports, and parameters fail lint — delete them instead of prefixing `_`.

## Verification

After every change:

```bash
bun run typecheck
bunx @biomejs/biome check --write .
```

Both must exit clean. Fix the code, never relax the rule.

---
description: Next.js App Router — RSC-first boundaries, Hono RPC client + TanStack Query, Zustand stores, Tailwind + shadcn/ui
paths:
  - "apps/web/**"
---

# Frontend — Next.js App Router (`apps/web`)

## Layout

```
apps/web/src/
├── app/
│   ├── (auth)/                     # sign-in / sign-up
│   ├── dashboard/knowledge/        # knowledge studio + RAG playground
│   ├── dashboard/sessions/         # session management
│   ├── dashboard/analytics/        # scientific telemetry dashboard
│   ├── room/[sessionId]/           # live tutoring room (LiveKit + avatar)
│   └── evaluation/[sessionId]/     # SUS / TAM questionnaire
├── components/
│   ├── ui/                         # shadcn/ui primitives (generated, edit sparingly)
│   └── <feature>/                  # feature components
├── hooks/queries/<domain>.ts       # TanStack Query hooks + key factories
├── lib/rpc.ts                      # hc<AppType> client
├── lib/auth-client.ts              # Better Auth client
├── providers/                      # QueryClientProvider etc.
└── stores/<feature>-store.ts       # Zustand stores
```

## Server/Client boundary

- Pages and layouts are **React Server Components** by default. Add `'use client'` only to the leaf that needs state, effects, event handlers, or browser APIs (LiveKit room, avatar canvas, forms).
- A server module may *render* a client component but never *call* a function exported from a `'use client'` file. Keep query-key factories, fetchers, and constants in non-client modules.
- Never import `@monibot/db`, `@monibot/auth` (server), or anything reading secrets into client code. Only `NEXT_PUBLIC_*` env reaches the browser.

## Talking to the API

- The browser never calls apps/api cross-origin. `next.config.ts` rewrites `/api/*` to `API_INTERNAL_URL`, so Better Auth cookies are first-party on the web origin. Rewrites are baked in at **build time**: `API_INTERNAL_URL` must be set when running `next build` (the `build` script loads the root `.env`; a Docker image needs it as a build arg).
- The **only** way to call the backend is the typed Hono client in `src/lib/rpc.ts` (`hc<AppType>`, same-origin in the browser, `API_INTERNAL_URL` on the server), unwrapped with `unwrap()`.
- Server Components read the session with `getServerSession()` / `requireServerSession()` / `requireResearcherSession()` from `src/lib/server-session.ts` (forwards cookies, bypasses the cookie cache). Client code uses `authClient` from `src/lib/auth-client.ts`.

- `import type` only — the API runtime never enters the web bundle.
- No raw `fetch` to our API, no hand-written response types. Infer with `InferResponseType<typeof rpc.api.sessions.$get>` when a type is needed. Download links use `rpc...$url()` (see `evaluationExportHref`).

## Server state — TanStack Query

```ts
export const sessionKeys = {
  all: ['sessions'] as const,
  list: () => [...sessionKeys.all, 'list'] as const,
  detail: (id: string) => [...sessionKeys.all, 'detail', id] as const,
}

export function useSessions() {
  return useQuery({
    queryKey: sessionKeys.list(),
    queryFn: async ({ signal }) => {
      const res = await rpc.api.sessions.$get({}, { init: { signal } })
      return unwrap(res)
    },
  })
}
```

- One key factory per domain, in `hooks/queries/<domain>.ts`. Mutations invalidate through the factory, never with string literals.
- `unwrap()` parses the envelope: returns `data` on success, throws an `ApiError(code, message, details)` on `{ success: false }`.
- Never `useState` + `useEffect` + `fetch` for server data.

## Client state — Zustand

- Synchronous UI, room controls, and real-time voice/avatar state live in `src/stores/`:
  - `room-store.ts`: connection status, mic/camera toggles, experimental flags of the joined session.
  - `agent-state-store.ts`: `AgentState` received over the LiveKit DataChannel (`idle | listening | searching_rag | thinking | speaking`), live transcript, last retrieved sources.
- Select narrowly: `useRoomStore((s) => s.micEnabled)`. Never subscribe to the whole store.
- Stores hold no server data (that is Query's job) and no LiveKit objects (keep `Room` in LiveKit's React context).
- Use `devtools`; `persist` only with an explicit `partialize` whitelist.

## Forms

- Validate with the **same** Zod schema from `@monibot/types` that the API's `zValidator` uses (react-hook-form + `zodResolver`).

## Experimental controls in the UI

- The room renders `<MoniBotAvatar />` only when the session's `avatarEnabled` is `true`; otherwise the minimal audio indicator. Read the flag from the session returned by the API — never from a URL param or local toggle.
- Never let participants see which experimental condition they are in beyond what the condition itself shows.

## Charts

- Recharts, through `components/analytics/grouped-bar-chart.tsx`. Conditions map to fixed colors (`CONDITION_SERIES`, CSS vars `--series-1..4`, validated for color-vision deficiency in light and dark); never color by rank and never add a second y-axis.
- Tooltip and legend text use text tokens, not the series color. Keep the full table view: two light-mode slots are below 3:1 contrast and rely on it.

## Build & env gotchas

- Never put `NODE_ENV` in `.env`: `next build` with `NODE_ENV=development` fails prerendering (`useContext` of null).
- Next runs on Node, not the Bun runtime (`bun --bun next build` breaks prerendering).
- Third-party CSS whose package `exports` lacks a `style` condition (e.g. `@livekit/components-styles`) is imported from the client component that needs it, not from `globals.css`.

## Styling

- Tailwind CSS + shadcn/ui (`src/components/ui/`). `cn()` for conditional classes. No inline `style` except for genuinely dynamic values (audio-reactive avatar scale).
- Text is in Brazilian Portuguese for participant-facing screens.

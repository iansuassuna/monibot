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
│   ├── room/[sessionId]/           # live tutoring room (Element Call widget, or LiveKit + avatar)
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
  - `agent-state-store.ts`: `AgentState` (`idle | listening | searching_rag | thinking | speaking`), live transcript, last retrieved sources — from the LiveKit DataChannel in a direct LiveKit room, or from the API's SSE stream (`AgentEventsListener`, `EventSource` on `rpc…['agent-events'].$url()`) in an Element Call room.
- Select narrowly: `useRoomStore((s) => s.micEnabled)`. Never subscribe to the whole store.
- Stores hold no server data (that is Query's job) and no LiveKit objects (keep `Room` in LiveKit's React context).
- Use `devtools`; `persist` only with an explicit `partialize` whitelist.

## Element Call room (Matrix sessions)

- `TutoringRoom` renders `ElementCallRoom` when the session has a `matrixRoomId`: *Entrar na monitoria* calls `useMatrixCallCredentials` (a mutation — each call is a login, never cache or refetch it), then `ElementCallFrame` hosts Element Call as a **widget** (`src/lib/element-call/`: `widget-url.ts` puts every parameter, the call password included, in the fragment and starts audio-only; `widget-driver.ts` carries out Element Call's widget API requests with the student's Matrix client; `widget-host.ts` loads `matrix-js-sdk`/`matrix-widget-api` on demand). Element Call's hang-up navigates to the evaluation.
- The driver returns an empty transport list (Element Call then uses its `config.json` focus), rejects sticky events asynchronously (the base class throws synchronously and Element Call would never get an answer), and refuses encrypted to-device (the call uses a shared key; Element Call only logs it).
- The iframe needs `allow="microphone; camera; display-capture; autoplay; clipboard-write; speaker-selection; screen-wake-lock"`. `ClientWidgetApi.stop()` neither removes its iframe `load` listener nor clears its `contentLoaded` timer, so a host must never be attached to an iframe it no longer owns: `startElementCallHost` takes an `AbortSignal` and quits before attaching (React StrictMode's double effect would otherwise attach a second, stopped host that logs "timed out waiting for contentLoaded" and syncs a Matrix client for nothing), and new credentials remount the iframe (`key`).
- The avatar condition lives in the call (the agent's video track), not in the page.

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

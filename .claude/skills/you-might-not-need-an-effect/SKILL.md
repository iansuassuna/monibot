---
name: you-might-not-need-an-effect
description: Find and remove unnecessary useEffect/useState in apps/web React code — derived state, event logic in effects, fetch-in-effect, and store syncing
argument-hint: "[scope] [fix=true|false]"
---

# You Might Not Need an Effect

Arguments: $ARGUMENTS (scope defaults to the current changes under `apps/web`; fix defaults to true)

An effect is for synchronizing with an **external system** (LiveKit room events, audio analyser nodes, `requestAnimationFrame` for the avatar, DataChannel subscriptions). Everything else is usually wrong.

## Anti-patterns

1. **Derived state**: `useState` + `useEffect` to compute a value from props/state → compute during render (or `useMemo` if measurably expensive).
2. **Fetching in an effect**: `useEffect(() => { fetch(...) })` → TanStack Query hook over `rpc`.
3. **Event logic in an effect**: reacting to a state flag set by a click (`useEffect(() => { if (submitted) post() }, [submitted])`) → do it in the event handler / mutation `onSuccess`.
4. **Syncing props into state**: `useEffect(() => setX(props.x), [props.x])` → use the prop, or key the component to reset.
5. **Copying server data into Zustand**: an effect that writes Query data into a store → read from Query directly.
6. **Chained effects** that set state which triggers another effect → compute it in one place.
7. **Resetting state on id change** → `key={sessionId}` on the component.

## Legitimate effects here

- Subscribing to `RoomEvent.DataReceived` for `monibot.agent-state` and writing into `agent-state-store` (with cleanup).
- Driving the avatar's audio-reactive animation from a `MediaStreamTrack` via `AnalyserNode` + `requestAnimationFrame` (with cleanup; prefer refs over state for per-frame values).
- Attaching/detaching LiveKit tracks to DOM elements when not handled by `@livekit/components-react`.

## Steps

1. Scan the scope for the anti-patterns.
2. If fix=true, refactor; otherwise list file:line with the proposed change.
3. `bun run typecheck && bunx @biomejs/biome check --write .`
4. For anything touching the room or avatar, verify in the running app — effect bugs don't show up in typecheck.

---
name: you-might-not-need-a-comment
description: Remove redundant or self-explanatory comments from a diff or path, and promote genuine documentation to TSDoc
argument-hint: "[scope] [fix=true|false]"
---

# You Might Not Need a Comment

Arguments: $ARGUMENTS (scope defaults to the current changes; fix defaults to true)

## The rule

A comment must add information the code cannot express. Code says *what* and *how*; a comment earns its place only by explaining *why* — a non-obvious constraint, a workaround, a decision, a protocol detail (MSC numbers, Ollama quirks, LiveKit timing). If deleting it loses nothing a competent reader would not recover from the code in seconds, delete it.

Convention: **TSDoc on exported declarations; inline `//` only for a terse non-obvious why; no banner separators; no commented-out code.**

## Delete

1. Restates the code (`// increment counter`).
2. Repeats the identifier (`// creates a session` above `createSession`).
3. Section banners (`// ==== Helpers ====`, `// #region`).
4. Commented-out code.
5. Prose that echoes the type signature.
6. Changelog/attribution noise (`// added by…`, `// fix for bug`).

## Promote

7. A real explanation written as stacked `//` lines on an exported declaration → one `/** ... */` TSDoc block.

## Keep

- Non-obvious whys (`// MSC4143: empty content means the member left the call`).
- `// biome-ignore <rule>: <reason>` and `@ts-expect-error` with a reason.
- `// TODO` / `// FIXME` pointing at real open work.
- Units and measurement boundaries on telemetry fields when not obvious from the name.

## Bias

Prefer deletion over rewriting. Never add new comments in this pass. When unsure whether a comment encodes a real why, keep it.

## Steps

1. Scan the scope for the patterns above.
2. If fix=true, apply; otherwise list proposed changes with file:line.
3. Run `bunx @biomejs/biome check --write .` on touched files.

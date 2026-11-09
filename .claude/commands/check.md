---
description: Run the verification gate — typecheck every workspace, then Biome check with autofix
allowed-tools: Bash(bun run typecheck:*), Bash(bunx @biomejs/biome check:*)
---

# Check

Run the repository verification gate from the repo root:

```bash
bun run typecheck && bunx @biomejs/biome check --write .
```

1. If `typecheck` fails, fix the reported type errors at their source (no `any`, no `@ts-ignore`, no `!`), then rerun.
2. If Biome reports diagnostics it could not autofix, fix them by hand (delete unused bindings rather than prefixing `_`; replace `console.*` with `createLogger`), then rerun.
3. Report the final result: which workspaces were checked and whether both steps exited clean. If anything is still failing, show the remaining errors verbatim — never report success on a partial run.

# syntax=docker/dockerfile:1.7
# One image definition, three targets: `api`, `web`, `agent-worker`.
# The base ships Node (Next.js runs on Node) plus Bun (package manager + API/worker runtime).

FROM docker.io/oven/bun:1.4.3-debian AS bun

FROM docker.io/library/node:22-bookworm-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/logger/package.json packages/logger/
COPY packages/types/package.json packages/types/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/agent-worker/package.json apps/agent-worker/
RUN bun install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "bun run packages/db/src/migrate.ts && exec bun apps/api/src/server.ts"]

FROM source AS web-build
# Next.js bakes the /api/* rewrite target into the build.
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_TELEMETRY_DISABLED=1
RUN cd apps/web && node_modules/.bin/next build

FROM web-build AS web
ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node_modules/.bin/next", "start", "--port", "3000"]

FROM source AS agent-worker
ENV NODE_ENV=production
WORKDIR /app/apps/agent-worker
# Fetch plugin model files (Silero VAD) at build time instead of on the first session.
RUN node_modules/.bin/livekit-agents download-files
CMD ["bun", "run", "src/main.ts", "start"]

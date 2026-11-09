import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://monibot:monibot@localhost:5432/monibot',
  },
  strict: true,
  verbose: true,
})

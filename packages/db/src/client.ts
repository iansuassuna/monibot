import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { z } from 'zod'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema> & { $client: Sql }

/** A database handle or an open transaction on it; services accept either. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export interface CreateDbOptions {
  /** Maximum pool size (default 10). */
  max?: number
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): Database {
  const client = postgres(connectionString, { max: options.max ?? 10 })
  return drizzle(client, { schema, casing: 'snake_case' })
}

const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ })

let defaultDb: Database | undefined

/**
 * Process-wide database handle built from `DATABASE_URL` on first use, so importing the
 * package (e.g. during type generation or a Next.js build) never opens a connection.
 */
export function getDb(): Database {
  if (!defaultDb) {
    const parsed = databaseUrlSchema.safeParse(process.env.DATABASE_URL)
    if (!parsed.success) {
      throw new Error('DATABASE_URL is missing or is not a postgres:// connection string')
    }
    defaultDb = createDb(parsed.data)
  }
  return defaultDb
}

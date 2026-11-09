import { fileURLToPath } from 'node:url'
import { createLogger } from '@monibot/logger'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './client'

const logger = createLogger('DbMigrate')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  logger.error('DATABASE_URL is not set')
  process.exit(1)
}

const db = createDb(databaseUrl, { max: 1 })
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

try {
  await migrate(db, { migrationsFolder })
  logger.info('Migrations applied', { migrationsFolder })
} catch (error) {
  logger.error('Migration failed', { error })
  process.exitCode = 1
} finally {
  await db.$client.end()
}

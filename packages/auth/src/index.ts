import { accounts, authSessions, type Database, getDb, users, verifications } from '@monibot/db'
import { createLogger } from '@monibot/logger'
import { USER_ROLES } from '@monibot/types'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { type AuthEnv, authEnvSchema } from './config'

const logger = createLogger('Auth')

export interface CreateAuthOptions {
  db: Database
  secret: string
  baseURL: string
  trustedOrigins: string[]
}

/**
 * Builds the Better Auth instance shared by `apps/api` (mounted at `/api/auth/*`) and
 * `apps/web` server code. Both must use the same secret and database so sessions are valid
 * across the two processes.
 */
export function createAuth({ db, secret, baseURL, trustedOrigins }: CreateAuthOptions) {
  return betterAuth({
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: authSessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    user: {
      additionalFields: {
        role: {
          type: [...USER_ROLES],
          required: false,
          defaultValue: 'student',
          // Researchers are promoted out-of-band; sign-up must not self-assign the role.
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
    },
    logger: {
      log: (level, message, ...args) => {
        const context = args.length > 0 ? { args } : undefined
        if (level === 'error') logger.error(message, context)
        else if (level === 'warn') logger.warn(message, context)
        else if (level === 'info') logger.info(message, context)
        else logger.debug(message, context)
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
export type AuthSession = Auth['$Infer']['Session']
export type AuthUser = AuthSession['user']

let defaultAuth: Auth | undefined

/** Process-wide auth instance configured from `BETTER_AUTH_*`, `WEB_ORIGIN`, and `DATABASE_URL`. */
export function getAuth(): Auth {
  if (!defaultAuth) {
    const env: AuthEnv = authEnvSchema.parse(process.env)
    defaultAuth = createAuth({
      db: getDb(),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      trustedOrigins: [env.WEB_ORIGIN],
    })
  }
  return defaultAuth
}

export { type AuthEnv, authEnvSchema } from './config'

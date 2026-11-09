import { type AuthSession, type AuthUser, getAuth } from '@monibot/auth'
import { createMiddleware } from 'hono/factory'
import { HttpError } from '../lib/http-error'
import { isValidAgentSecret } from './internal-auth.middleware'

export interface AuthVariables {
  user: AuthUser
  session: AuthSession['session']
}

export interface CallerVariables {
  /** `null` when the caller is the agent worker. */
  user: AuthUser | null
}

/**
 * `fresh` bypasses Better Auth's cookie cache, which holds a copy of the user (including
 * `role`) for up to five minutes; role checks must see a promotion or demotion immediately.
 */
async function readSession(headers: Headers, fresh = false) {
  return getAuth().api.getSession({
    headers,
    ...(fresh ? { query: { disableCookieCache: true } } : {}),
  })
}

/** Requires a signed-in Better Auth user (student or researcher). */
export const requireSession = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const result = await readSession(c.req.raw.headers)
  if (!result) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in required')
  c.set('user', result.user)
  c.set('session', result.session)
  await next()
})

/** Requires a signed-in user with the `researcher` role. */
export const requireResearcher = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const result = await readSession(c.req.raw.headers, true)
  if (!result) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in required')
  if (result.user.role !== 'researcher') {
    throw new HttpError(403, 'FORBIDDEN', 'Researcher role required')
  }
  c.set('user', result.user)
  c.set('session', result.session)
  await next()
})

/**
 * Explicitly accepts either the agent worker (`x-agent-secret`) or a signed-in user, for the
 * few read endpoints both need (session flags, retrieval).
 */
export const requireUserOrAgent = createMiddleware<{ Variables: CallerVariables }>(
  async (c, next) => {
    if (isValidAgentSecret(c.req.header('x-agent-secret'))) {
      c.set('user', null)
      await next()
      return
    }
    const result = await readSession(c.req.raw.headers)
    if (!result) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in or agent secret required')
    c.set('user', result.user)
    await next()
  }
)

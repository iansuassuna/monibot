import { createMoniBotAuthClient } from '@monibot/auth/client'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

const serverAuthClient = createMoniBotAuthClient(
  process.env.API_INTERNAL_URL ?? 'http://localhost:3001'
)

/**
 * Reads the Better Auth session in a Server Component by forwarding the request cookies to
 * apps/api. The cookie cache is bypassed so a role change takes effect immediately.
 */
export async function getServerSession() {
  const cookie = (await headers()).get('cookie') ?? ''
  if (!cookie) return null
  const { data } = await serverAuthClient.getSession({
    query: { disableCookieCache: true },
    fetchOptions: { headers: { cookie } },
  })
  return data
}

export async function requireServerSession(returnTo: string) {
  const session = await getServerSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`)
  return session
}

export async function requireResearcherSession(returnTo: string) {
  const session = await requireServerSession(returnTo)
  if (session.user.role !== 'researcher') redirect('/')
  return session
}

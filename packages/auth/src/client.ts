import { createAuthClient } from 'better-auth/client'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import type { Auth } from './index'

/** Browser-safe Better Auth client; points at the API origin that mounts `/api/auth/*`. */
export function createMoniBotAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    basePath: '/api/auth',
    fetchOptions: { credentials: 'include' },
    plugins: [inferAdditionalFields<Auth>()],
  })
}

export type MoniBotAuthClient = ReturnType<typeof createMoniBotAuthClient>

import { createMoniBotAuthClient } from '@monibot/auth/client'

/** Browser auth client; same-origin through the `/api/*` rewrite. */
export const authClient = createMoniBotAuthClient(
  typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin
)

import { z } from 'zod'

export const authEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  WEB_ORIGIN: z.url(),
})

export type AuthEnv = z.infer<typeof authEnvSchema>

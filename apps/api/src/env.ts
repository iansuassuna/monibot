import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.url(),
  AGENT_SECRET: z.string().min(16, 'AGENT_SECRET must be at least 16 characters'),
  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  OLLAMA_EMBED_MODEL: z.string().min(1).default('nomic-embed-text-v2-moe'),
  OLLAMA_LLM_MODEL: z.string().min(1).default('llama3.1:8b'),
  /**
   * GPU layers for the embedding model; `0` keeps it on the CPU so it never evicts the LLM from a
   * small GPU (each eviction reloads the LLM and adds seconds to the measured latencies).
   */
  OLLAMA_EMBED_NUM_GPU: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(0).optional()
  ),
  /** LiveKit as reached by this server (server SDK calls). */
  LIVEKIT_URL: z.url(),
  /** LiveKit as reached by browsers; defaults to LIVEKIT_URL (differs inside containers). */
  LIVEKIT_PUBLIC_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url().optional()
  ),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_NAME: z.string().min(1).default('monibot'),
  MATRIX_WEBHOOK_SECRET: z.string().min(16, 'MATRIX_WEBHOOK_SECRET must be at least 16 characters'),
})

export type Env = z.infer<typeof envSchema>

/** The only place in apps/api that reads `process.env` (DATABASE_URL and BETTER_AUTH_* are read by their packages). */
export const env: Env = envSchema.parse(process.env)

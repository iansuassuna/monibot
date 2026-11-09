import { z } from 'zod'

const envSchema = z.object({
  LIVEKIT_URL: z.url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_NAME: z.string().min(1).default('monibot'),
  API_INTERNAL_URL: z.url().default('http://localhost:3001'),
  AGENT_SECRET: z.string().min(16),
  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  /** OpenAI-compatible speech server (speaches): faster-whisper STT + Piper TTS. */
  SPEACHES_BASE_URL: z.url().default('http://localhost:8000'),
  WHISPER_MODEL: z.string().min(1).default('Systran/faster-whisper-small'),
  STT_LANGUAGE: z.string().min(2).default('pt'),
  TTS_MODEL: z.string().min(1).default('speaches-ai/piper-pt_BR-faber-medium'),
})

export type WorkerEnv = z.infer<typeof envSchema>

/** The only place in apps/agent-worker that reads `process.env`. */
export const env: WorkerEnv = envSchema.parse(process.env)

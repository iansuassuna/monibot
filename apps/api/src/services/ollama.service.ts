import { createLogger } from '@monibot/logger'
import { EMBEDDING_DIMENSIONS } from '@monibot/types'
import { z } from 'zod'
import { env } from '../env'
import { upstreamUnavailable } from '../lib/http-error'

const logger = createLogger('OllamaService')

const EMBED_TIMEOUT_MS = 60_000
const CHAT_TIMEOUT_MS = 180_000
const EMBED_BATCH_SIZE = 32

const embedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number()).length(EMBEDDING_DIMENSIONS)),
})

const chatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
})

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, timeoutMs: number) {
  let response: Response
  try {
    response = await fetch(new URL(path, env.OLLAMA_BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    logger.error('Ollama request failed', { path, error })
    throw upstreamUnavailable('Ollama', error)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    logger.error('Ollama returned an error', { path, status: response.status, detail })
    throw upstreamUnavailable('Ollama')
  }
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) {
    logger.error('Unexpected Ollama response shape', { path, issues: parsed.error.issues })
    throw upstreamUnavailable('Ollama')
  }
  return parsed.data
}

/**
 * Nomic embedding models are trained with task prefixes; without them, query↔passage similarity
 * degrades noticeably. Changing a prefix requires re-indexing every document.
 */
const EMBED_PREFIX = { document: 'search_document: ', query: 'search_query: ' } as const

export type EmbedKind = keyof typeof EMBED_PREFIX

/** Embeds texts with `OLLAMA_EMBED_MODEL` (768-d `nomic-embed-text-v2-moe`), batching requests. */
export async function embedTexts(texts: readonly string[], kind: EmbedKind): Promise<number[][]> {
  const embeddings: number[][] = []
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts
      .slice(start, start + EMBED_BATCH_SIZE)
      .map((text) => EMBED_PREFIX[kind] + text)
    const result = await post(
      '/api/embed',
      {
        model: env.OLLAMA_EMBED_MODEL,
        input: batch,
        ...(env.OLLAMA_EMBED_NUM_GPU === undefined
          ? {}
          : { options: { num_gpu: env.OLLAMA_EMBED_NUM_GPU } }),
      },
      embedResponseSchema,
      EMBED_TIMEOUT_MS
    )
    embeddings.push(...result.embeddings)
  }
  return embeddings
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text], 'query')
  if (!embedding) throw upstreamUnavailable('Ollama')
  return embedding
}

/** Non-streaming chat completion; returns the answer and its wall-clock generation time. */
export async function chat(messages: readonly ChatMessage[], model = env.OLLAMA_LLM_MODEL) {
  const start = performance.now()
  const result = await post(
    '/api/chat',
    { model, messages, stream: false },
    chatResponseSchema,
    CHAT_TIMEOUT_MS
  )
  return { content: result.message.content, latencyMs: Math.round(performance.now() - start) }
}

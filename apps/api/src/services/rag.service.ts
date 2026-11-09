import {
  getDb,
  knowledgeChunks,
  knowledgeDocuments,
  listKnowledgeDocuments,
  searchSimilarChunks,
} from '@monibot/db'
import { createLogger } from '@monibot/logger'
import {
  buildTutorContextMessage,
  buildTutorSystemPrompt,
  type CreateKnowledgeDocument,
  type KnowledgeDocument,
  type PlaygroundRequest,
  type PlaygroundResponse,
  type RetrieveRequest,
  type RetrieveResponse,
} from '@monibot/types'
import { eq } from 'drizzle-orm'
import { env } from '../env'
import { HttpError, notFound } from '../lib/http-error'
import { chunkDocument } from './chunking.service'
import { chat, embedQuery, embedTexts } from './ollama.service'

const logger = createLogger('RagService')

type DocumentRow = Awaited<ReturnType<typeof listKnowledgeDocuments>>[number]

const toKnowledgeDocument = (row: DocumentRow): KnowledgeDocument => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

export async function listDocuments(): Promise<KnowledgeDocument[]> {
  const rows = await listKnowledgeDocuments(getDb())
  return rows.map(toKnowledgeDocument)
}

/**
 * Chunks, embeds, and stores a document. The document row is created as `processing` first so
 * a failed ingestion stays visible as `failed` instead of disappearing.
 */
export async function createDocument(input: CreateKnowledgeDocument): Promise<KnowledgeDocument> {
  const db = getDb()
  const chunks = chunkDocument(input.rawText)
  if (chunks.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Document has no indexable text')
  }

  const [document] = await db
    .insert(knowledgeDocuments)
    .values({ ...input, status: 'processing' })
    .returning({ id: knowledgeDocuments.id })
  if (!document) throw new Error('Insert into knowledge_documents returned no row')

  try {
    const embeddings = await embedTexts(
      chunks.map((chunk) => chunk.content),
      'document'
    )
    await db.transaction(async (tx) => {
      await tx.insert(knowledgeChunks).values(
        chunks.map((chunk, index) => ({
          documentId: document.id,
          chunkIndex: index,
          content: chunk.content,
          metadata: chunk.metadata,
          embedding: embeddings[index] ?? [],
        }))
      )
      await tx
        .update(knowledgeDocuments)
        .set({ status: 'indexed', chunkCount: chunks.length })
        .where(eq(knowledgeDocuments.id, document.id))
    })
    logger.info('Document indexed', { documentId: document.id, chunkCount: chunks.length })
  } catch (error) {
    await db
      .update(knowledgeDocuments)
      .set({ status: 'failed' })
      .where(eq(knowledgeDocuments.id, document.id))
    throw error
  }

  return getDocument(document.id)
}

export async function getDocument(id: string): Promise<KnowledgeDocument> {
  const [row] = await getDb()
    .select({
      id: knowledgeDocuments.id,
      title: knowledgeDocuments.title,
      category: knowledgeDocuments.category,
      course: knowledgeDocuments.course,
      status: knowledgeDocuments.status,
      chunkCount: knowledgeDocuments.chunkCount,
      createdAt: knowledgeDocuments.createdAt,
    })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
  if (!row) throw notFound('Knowledge document')
  return toKnowledgeDocument(row)
}

export async function deleteDocument(id: string): Promise<{ id: string }> {
  const [deleted] = await getDb()
    .delete(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .returning({ id: knowledgeDocuments.id })
  if (!deleted) throw notFound('Knowledge document')
  return deleted
}

/** Embeds the query and runs cosine search; `ragLatencyMs` covers both steps. */
export async function retrieveChunks(input: RetrieveRequest): Promise<RetrieveResponse> {
  const start = performance.now()
  const embedding = await embedQuery(input.query)
  const chunks = await searchSimilarChunks(getDb(), {
    embedding,
    topK: input.topK,
    minScore: input.minScore,
  })
  return { chunks, ragLatencyMs: Math.round(performance.now() - start) }
}

/** Answers the same question in both RAG conditions using the shared tutor prompts. */
export async function runPlayground(input: PlaygroundRequest): Promise<PlaygroundResponse> {
  const userMessage = { role: 'user' as const, content: input.question }

  const withoutRag = await chat([
    { role: 'system', content: buildTutorSystemPrompt() },
    userMessage,
  ])

  const retrieval = await retrieveChunks({
    query: input.question,
    topK: input.topK,
    minScore: input.minScore,
  })
  const withRag = await chat([
    { role: 'system', content: buildTutorSystemPrompt() },
    { role: 'system', content: buildTutorContextMessage(retrieval.chunks) },
    userMessage,
  ])

  return {
    withoutRag: { answer: withoutRag.content, llmLatencyMs: withoutRag.latencyMs },
    withRag: {
      answer: withRag.content,
      llmLatencyMs: withRag.latencyMs,
      ragLatencyMs: retrieval.ragLatencyMs,
      chunks: retrieval.chunks,
    },
    model: env.OLLAMA_LLM_MODEL,
  }
}

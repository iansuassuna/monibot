import { z } from 'zod'
import { isoDateTimeSchema, latencyMsSchema, uuidSchema } from './common'
import {
  DEFAULT_COURSE,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_DOCUMENT_STATUSES,
  RETRIEVAL_DEFAULT_MIN_SCORE,
  RETRIEVAL_DEFAULT_TOP_K,
  RETRIEVAL_MAX_TOP_K,
} from './constants'

export const knowledgeCategorySchema = z.enum(KNOWLEDGE_CATEGORIES)
export type KnowledgeCategory = z.infer<typeof knowledgeCategorySchema>

export const knowledgeDocumentStatusSchema = z.enum(KNOWLEDGE_DOCUMENT_STATUSES)
export type KnowledgeDocumentStatus = z.infer<typeof knowledgeDocumentStatusSchema>

/** Per-chunk metadata stored as JSONB alongside the embedding. */
export const chunkMetadataSchema = z.object({
  page: z.number().int().positive().optional(),
  section: z.string().optional(),
  language: z.string().optional(),
  isCode: z.boolean().optional(),
})
export type ChunkMetadata = z.infer<typeof chunkMetadataSchema>

export const createKnowledgeDocumentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  category: knowledgeCategorySchema,
  course: z.string().trim().min(1).default(DEFAULT_COURSE),
  rawText: z.string().min(1),
})
export type CreateKnowledgeDocument = z.infer<typeof createKnowledgeDocumentSchema>

export const knowledgeDocumentSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  category: knowledgeCategorySchema,
  course: z.string(),
  status: knowledgeDocumentStatusSchema,
  chunkCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
})
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>

export const retrieveRequestSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(RETRIEVAL_MAX_TOP_K).default(RETRIEVAL_DEFAULT_TOP_K),
  minScore: z.number().min(0).max(1).default(RETRIEVAL_DEFAULT_MIN_SCORE),
})
export type RetrieveRequest = z.infer<typeof retrieveRequestSchema>

export const retrievedChunkSchema = z.object({
  chunkId: uuidSchema,
  documentId: uuidSchema,
  documentTitle: z.string(),
  content: z.string(),
  metadata: chunkMetadataSchema,
  score: z.number(),
})
export type RetrievedChunk = z.infer<typeof retrievedChunkSchema>

export const retrieveResponseSchema = z.object({
  chunks: z.array(retrievedChunkSchema),
  ragLatencyMs: latencyMsSchema,
})
export type RetrieveResponse = z.infer<typeof retrieveResponseSchema>

/** Compact reference to a retrieved chunk, persisted per interaction turn. */
export const retrievedChunkRefSchema = z.object({
  chunkId: uuidSchema,
  score: z.number(),
  excerpt: z.string(),
})
export type RetrievedChunkRef = z.infer<typeof retrievedChunkRefSchema>

export const playgroundRequestSchema = retrieveRequestSchema
  .pick({ topK: true, minScore: true })
  .extend({
    question: z.string().trim().min(1).max(2000),
  })
export type PlaygroundRequest = z.infer<typeof playgroundRequestSchema>

export const playgroundAnswerSchema = z.object({
  answer: z.string(),
  llmLatencyMs: latencyMsSchema,
})

/** Side-by-side comparison of the two RAG conditions for the same question. */
export const playgroundResponseSchema = z.object({
  withoutRag: playgroundAnswerSchema,
  withRag: playgroundAnswerSchema.extend({
    ragLatencyMs: latencyMsSchema,
    chunks: z.array(retrievedChunkSchema),
  }),
  model: z.string(),
})
export type PlaygroundResponse = z.infer<typeof playgroundResponseSchema>

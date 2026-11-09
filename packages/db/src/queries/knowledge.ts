import { cosineDistance, desc, eq, gt, sql } from 'drizzle-orm'
import type { DbExecutor } from '../client'
import { knowledgeChunks, knowledgeDocuments } from '../schema'

export interface SimilarChunksInput {
  embedding: number[]
  topK: number
  minScore: number
}

export interface SimilarChunk {
  chunkId: string
  documentId: string
  documentTitle: string
  content: string
  metadata: typeof knowledgeChunks.$inferSelect.metadata
  score: number
}

/**
 * Cosine-similarity search over chunk embeddings. Orders by raw distance so the planner can
 * use the HNSW `vector_cosine_ops` index, then drops results below `minScore`.
 */
export async function searchSimilarChunks(
  db: DbExecutor,
  { embedding, topK, minScore }: SimilarChunksInput
): Promise<SimilarChunk[]> {
  const distance = cosineDistance(knowledgeChunks.embedding, embedding)
  const similarity = sql<number>`1 - (${distance})`.mapWith(Number)

  return db
    .select({
      chunkId: knowledgeChunks.id,
      documentId: knowledgeChunks.documentId,
      documentTitle: knowledgeDocuments.title,
      content: knowledgeChunks.content,
      metadata: knowledgeChunks.metadata,
      score: similarity,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
    .where(gt(similarity, minScore))
    .orderBy(distance)
    .limit(topK)
}

export async function listKnowledgeDocuments(db: DbExecutor) {
  return db
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
    .orderBy(desc(knowledgeDocuments.createdAt))
}

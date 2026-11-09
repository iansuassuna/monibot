import {
  type ChunkMetadata,
  DEFAULT_COURSE,
  EMBEDDING_DIMENSIONS,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_DOCUMENT_STATUSES,
} from '@monibot/types'
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

export const knowledgeCategoryEnum = pgEnum('knowledge_category', KNOWLEDGE_CATEGORIES)

export const knowledgeDocumentStatusEnum = pgEnum(
  'knowledge_document_status',
  KNOWLEDGE_DOCUMENT_STATUSES
)

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    category: knowledgeCategoryEnum('category').notNull(),
    course: text('course').notNull().default(DEFAULT_COURSE),
    rawText: text('raw_text').notNull(),
    status: knowledgeDocumentStatusEnum('status').notNull().default('processing'),
    chunkCount: integer('chunk_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('knowledge_documents_category_idx').on(table.category)]
)

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<ChunkMetadata>().notNull().default({}),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('knowledge_chunks_document_chunk_unique').on(table.documentId, table.chunkIndex),
    index('knowledge_chunks_embedding_hnsw_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
  ]
)

export type KnowledgeDocumentRow = typeof knowledgeDocuments.$inferSelect
export type NewKnowledgeDocumentRow = typeof knowledgeDocuments.$inferInsert
export type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect
export type NewKnowledgeChunkRow = typeof knowledgeChunks.$inferInsert

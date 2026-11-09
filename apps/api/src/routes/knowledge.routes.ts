import {
  createKnowledgeDocumentSchema,
  idParamsSchema,
  playgroundRequestSchema,
  retrieveRequestSchema,
} from '@monibot/types'
import { Hono } from 'hono'
import { success } from '../lib/envelope'
import { validate } from '../lib/validate'
import {
  requireResearcher,
  requireSession,
  requireUserOrAgent,
} from '../middlewares/auth.middleware'
import {
  createDocument,
  deleteDocument,
  listDocuments,
  retrieveChunks,
  runPlayground,
} from '../services/rag.service'

export const knowledgeRoutes = new Hono()
  .get('/documents', requireSession, async (c) => c.json(success(await listDocuments()), 200))
  .post(
    '/documents',
    requireResearcher,
    validate('json', createKnowledgeDocumentSchema),
    async (c) => c.json(success(await createDocument(c.req.valid('json'))), 201)
  )
  .delete('/documents/:id', requireResearcher, validate('param', idParamsSchema), async (c) =>
    c.json(success(await deleteDocument(c.req.valid('param').id)), 200)
  )
  .post('/retrieve', requireUserOrAgent, validate('json', retrieveRequestSchema), async (c) =>
    c.json(success(await retrieveChunks(c.req.valid('json'))), 200)
  )
  .post('/playground', requireResearcher, validate('json', playgroundRequestSchema), async (c) =>
    c.json(success(await runPlayground(c.req.valid('json'))), 200)
  )

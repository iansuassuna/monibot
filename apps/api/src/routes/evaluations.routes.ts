import { createUserEvaluationSchema, evaluationExportQuerySchema } from '@monibot/types'
import { Hono } from 'hono'
import { toCsv } from '../lib/csv'
import { success } from '../lib/envelope'
import { validate } from '../lib/validate'
import { requireResearcher, requireSession } from '../middlewares/auth.middleware'
import {
  createEvaluation,
  EVALUATION_EXPORT_COLUMNS,
  exportEvaluationRows,
  exportInteractionRows,
  INTERACTION_EXPORT_COLUMNS,
} from '../services/evaluations.service'

export const evaluationsRoutes = new Hono()
  .post('/', requireSession, validate('json', createUserEvaluationSchema), async (c) =>
    c.json(success(await createEvaluation(c.req.valid('json'), c.var.user.id)), 201)
  )
  .get('/export', requireResearcher, validate('query', evaluationExportQuerySchema), async (c) => {
    const { dataset, format } = c.req.valid('query')
    const filename = `monibot-${dataset}-${new Date().toISOString().slice(0, 10)}`

    if (dataset === 'interactions') {
      const rows = await exportInteractionRows()
      if (format === 'json') return c.json(success(rows), 200)
      return c.body(toCsv(rows, INTERACTION_EXPORT_COLUMNS), 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}.csv"`,
      })
    }

    const rows = await exportEvaluationRows()
    if (format === 'json') return c.json(success(rows), 200)
    return c.body(toCsv(rows, EVALUATION_EXPORT_COLUMNS), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}.csv"`,
    })
  })

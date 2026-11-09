import { z } from 'zod'
import { isoDateTimeSchema, likertSchema, uuidSchema } from './common'
import { SUS_ITEM_COUNT } from './constants'

/** The 10 SUS items in questionnaire order, each on a 1–5 Likert scale. */
export const susAnswersSchema = z.array(likertSchema).length(SUS_ITEM_COUNT)
export type SusAnswers = z.infer<typeof susAnswersSchema>

export const createUserEvaluationSchema = z.object({
  sessionId: uuidSchema,
  susAnswers: susAnswersSchema,
  tamPerceivedUsefulnessAnswers: z.array(likertSchema).min(1),
  tamPerceivedEaseOfUseAnswers: z.array(likertSchema).min(1),
  /** Omitted for audio-only sessions (`avatarEnabled = false`). */
  avatarNaturalnessScore: likertSchema.nullable().default(null),
  comments: z.string().trim().max(5000).default(''),
})
export type CreateUserEvaluation = z.infer<typeof createUserEvaluationSchema>

export const userEvaluationSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  userId: z.string().nullable(),
  susAnswers: susAnswersSchema,
  susCalculatedScore: z.number().min(0).max(100),
  tamPerceivedUsefulness: z.number().min(1).max(5),
  tamPerceivedEaseOfUse: z.number().min(1).max(5),
  avatarNaturalnessScore: z.number().min(1).max(5).nullable(),
  comments: z.string(),
  createdAt: isoDateTimeSchema,
})
export type UserEvaluation = z.infer<typeof userEvaluationSchema>

export const EXPORT_DATASETS = ['evaluations', 'interactions'] as const

export const evaluationExportQuerySchema = z.object({
  dataset: z.enum(EXPORT_DATASETS).default('evaluations'),
  format: z.enum(['csv', 'json']).default('csv'),
})
export type EvaluationExportQuery = z.infer<typeof evaluationExportQuerySchema>

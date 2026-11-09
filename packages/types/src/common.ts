import { z } from 'zod'
import { API_ERROR_CODES, LIKERT_MAX, LIKERT_MIN } from './constants'

export const uuidSchema = z.uuid()

export const idParamsSchema = z.object({ id: uuidSchema })
export type IdParams = z.infer<typeof idParamsSchema>

export const isoDateTimeSchema = z.iso.datetime({ offset: true })

/** Integer millisecond duration measured with a monotonic clock. */
export const latencyMsSchema = z.number().int().nonnegative()

export const likertSchema = z.number().int().min(LIKERT_MIN).max(LIKERT_MAX)

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES)
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiError = z.infer<typeof apiErrorSchema>

/** Builds the `{ success: true, data }` envelope schema around a payload schema. */
export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data })
}

export type ApiSuccess<T> = { success: true; data: T }
export type ApiResponse<T> = ApiSuccess<T> | ApiError

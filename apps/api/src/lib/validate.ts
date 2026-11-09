import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'
import { failure } from './envelope'

/** `zValidator` that answers failed validation with the standard error envelope. */
export const validate = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        failure('VALIDATION_ERROR', `Invalid request ${target}`, result.error.issues),
        400
      )
    }
  })

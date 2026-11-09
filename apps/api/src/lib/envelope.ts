import type { ApiError, ApiErrorCode } from '@monibot/types'

export const success = <T>(data: T) => ({ success: true as const, data })

export const failure = (code: ApiErrorCode, message: string, details?: unknown): ApiError => ({
  success: false,
  error: details === undefined ? { code, message } : { code, message, details },
})

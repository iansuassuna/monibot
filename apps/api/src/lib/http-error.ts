import type { ApiErrorCode } from '@monibot/types'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Expected failure thrown by services; the global error handler renders it as the error envelope. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'HttpError'
  }
}

export const notFound = (resource: string) =>
  new HttpError(404, 'NOT_FOUND', `${resource} not found`)

export const upstreamUnavailable = (service: string, cause?: unknown) =>
  new HttpError(503, 'UPSTREAM_UNAVAILABLE', `${service} is unavailable`, undefined, {
    cause,
  })

import type { AppType } from '@monibot/api'
import { apiErrorSchema } from '@monibot/types'
import { hc } from 'hono/client'

/**
 * In the browser the API is same-origin (Next.js rewrites `/api/*` to apps/api), so auth
 * cookies are first-party. Server code talks to apps/api directly.
 */
const baseUrl =
  typeof window === 'undefined'
    ? (process.env.API_INTERNAL_URL ?? 'http://localhost:3001')
    : window.location.origin

export const rpc = hc<AppType>(baseUrl, { init: { credentials: 'include' } })

/** Error envelope `{ success: false, error }` surfaced as a throwable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RpcResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type SuccessData<Body> = Body extends { success: true; data: infer Data } ? Data : never

/** Returns `data` from a success envelope; throws `ApiError` for an error envelope. */
export async function unwrap<Response extends RpcResponse>(
  response: Response
): Promise<SuccessData<Awaited<ReturnType<Response['json']>>>> {
  const body: unknown = await response.json().catch(() => undefined)
  const failure = apiErrorSchema.safeParse(body)
  if (!response.ok || failure.success) {
    const error = failure.success ? failure.data.error : undefined
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details
    )
  }
  return (body as { data: SuccessData<Awaited<ReturnType<Response['json']>>> }).data
}

import type { CreateUserEvaluation, EvaluationExportQuery } from '@monibot/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { rpc, unwrap } from '@/lib/rpc'
import { telemetryKeys } from './telemetry'

export function useCreateEvaluation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateUserEvaluation) =>
      unwrap(await rpc.api.evaluations.$post({ json: input })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: telemetryKeys.analytics() }),
  })
}

/** Same-origin download URL for a dataset export (served as an attachment by the API). */
export function evaluationExportHref(query: EvaluationExportQuery): string {
  const url = rpc.api.evaluations.export.$url({ query })
  return `${url.pathname}${url.search}`
}

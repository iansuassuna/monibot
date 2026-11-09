import { useQuery } from '@tanstack/react-query'
import { rpc, unwrap } from '@/lib/rpc'

export const telemetryKeys = {
  all: ['telemetry'] as const,
  analytics: () => [...telemetryKeys.all, 'analytics'] as const,
}

export function useAnalytics() {
  return useQuery({
    queryKey: telemetryKeys.analytics(),
    queryFn: async ({ signal }) =>
      unwrap(await rpc.api.telemetry.analytics.$get({}, { init: { signal } })),
    refetchInterval: 30_000,
  })
}

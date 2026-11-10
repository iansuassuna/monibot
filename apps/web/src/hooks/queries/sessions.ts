import type { CreateTutoringSession, TutoringSessionStatus } from '@monibot/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc, unwrap } from '@/lib/rpc'

export const sessionKeys = {
  all: ['sessions'] as const,
  list: (status?: TutoringSessionStatus) => [...sessionKeys.all, 'list', status ?? 'all'] as const,
  detail: (id: string) => [...sessionKeys.all, 'detail', id] as const,
}

export function useSessions(status?: TutoringSessionStatus) {
  return useQuery({
    queryKey: sessionKeys.list(status),
    queryFn: async ({ signal }) =>
      unwrap(
        await rpc.api.sessions.$get({ query: status ? { status } : {} }, { init: { signal } })
      ),
  })
}

export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: async ({ signal }) =>
      unwrap(await rpc.api.sessions[':id'].$get({ param: { id } }, { init: { signal } })),
  })
}

export function useCreateSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTutoringSession) =>
      unwrap(await rpc.api.sessions.$post({ json: input })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
  })
}

export function useEndSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await rpc.api.sessions[':id'].end.$post({ param: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
  })
}

export function useLivekitToken(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (participantName: string) =>
      unwrap(
        await rpc.api.sessions[':id'].token.$post({
          param: { id: sessionId },
          json: { participantName },
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) }),
  })
}

/**
 * Matrix login and call password for joining the session's call in embedded Element Call.
 * A mutation, not a query: every call issues a new device (revoking the previous one), so it
 * must never be refetched or cached.
 */
export function useMatrixCallCredentials(sessionId: string) {
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await rpc.api.sessions[':id']['matrix-credentials'].$post({ param: { id: sessionId } })
      ),
  })
}

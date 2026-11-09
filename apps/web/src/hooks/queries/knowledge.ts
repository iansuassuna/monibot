import type { CreateKnowledgeDocument, PlaygroundRequest } from '@monibot/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc, unwrap } from '@/lib/rpc'

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  documents: () => [...knowledgeKeys.all, 'documents'] as const,
}

export function useKnowledgeDocuments() {
  return useQuery({
    queryKey: knowledgeKeys.documents(),
    queryFn: async ({ signal }) =>
      unwrap(await rpc.api.knowledge.documents.$get({}, { init: { signal } })),
  })
}

export function useCreateDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateKnowledgeDocument) =>
      unwrap(await rpc.api.knowledge.documents.$post({ json: input })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents() }),
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await rpc.api.knowledge.documents[':id'].$delete({ param: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents() }),
  })
}

export function usePlayground() {
  return useMutation({
    mutationFn: async (input: PlaygroundRequest) =>
      unwrap(await rpc.api.knowledge.playground.$post({ json: input })),
  })
}

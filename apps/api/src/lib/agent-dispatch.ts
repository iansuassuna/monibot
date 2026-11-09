import { agentDispatchMetadataSchema } from '@monibot/types'

/** Session a LiveKit agent dispatch belongs to, read from the metadata the API attached to it. */
export function dispatchSessionId(metadata: string): string | undefined {
  try {
    return agentDispatchMetadataSchema.safeParse(JSON.parse(metadata)).data?.sessionId
  } catch {
    return undefined
  }
}

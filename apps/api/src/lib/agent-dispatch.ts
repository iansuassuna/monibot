import { agentDispatchMetadataSchema } from '@monibot/types'

/** Session a LiveKit agent dispatch belongs to, read from the metadata the API attached to it. */
export function dispatchSessionId(metadata: string): string | undefined {
  try {
    return agentDispatchMetadataSchema.safeParse(JSON.parse(metadata)).data?.sessionId
  } catch {
    return undefined
  }
}

/** Time a worker gets between a dispatch and its agent showing up in the room. */
export const DISPATCH_JOIN_GRACE_MS = 20_000

export interface DispatchLiveness {
  /** `AgentDispatchState.createdAt`, Unix nanoseconds. */
  createdAtNs: bigint | undefined
  agentInRoom: boolean
  nowMs: number
}

/**
 * Whether a dispatch no longer has an agent behind it. LiveKit keeps reporting the job as running
 * after its worker restarts, so only the agent's presence in the room proves it is alive.
 */
export function isOrphanedDispatch({ createdAtNs, agentInRoom, nowMs }: DispatchLiveness): boolean {
  if (agentInRoom) return false
  if (createdAtNs === undefined) return true
  return nowMs - Number(createdAtNs / 1_000_000n) > DISPATCH_JOIN_GRACE_MS
}

/** Dispatches tried for one arrival before giving up (the student can rejoin to try again). */
export const MAX_DISPATCH_ATTEMPTS = 3

export interface ArrivalState {
  agentInRoom: boolean
  /** A non-agent participant is still connected. */
  studentInRoom: boolean
  /** Dispatches made so far for this arrival, starting at 1. */
  attempt: number
}

/**
 * What to do once the join grace period after a dispatch has passed. LiveKit drops a job it
 * could not hand to a worker (and removes the dispatch) without retrying, which would leave the
 * student alone in the call.
 */
export function nextArrivalCheck({
  agentInRoom,
  studentInRoom,
  attempt,
}: ArrivalState): 'arrived' | 'retry' | 'give_up' {
  if (agentInRoom) return 'arrived'
  if (!studentInRoom || attempt >= MAX_DISPATCH_ATTEMPTS) return 'give_up'
  return 'retry'
}

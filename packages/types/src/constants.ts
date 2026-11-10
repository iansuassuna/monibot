/** Output width of `nomic-embed-text-v2-moe` served by Ollama; must match `vector(N)` in `@monibot/db`. */
export const EMBEDDING_DIMENSIONS = 768

export const DEFAULT_COURSE = 'Fundamentos de Programação'
/** Study default; deployments override it with `OLLAMA_LLM_MODEL` (the DB column default mirrors it). */
export const DEFAULT_LLM_MODEL = 'llama3.1:8b'

export const KNOWLEDGE_CATEGORIES = [
  'lecture_slides',
  'exercise_list',
  'past_exam',
  'code_reference',
] as const

export const KNOWLEDGE_DOCUMENT_STATUSES = ['processing', 'indexed', 'failed'] as const

/**
 * How students joined a session's call, recorded for the methodology: data from the two clients
 * are not directly comparable (the avatar is drawn on the page in `livekit_web`, and is the
 * agent's video tile in `element_call`, which also adds Element Call's audio path).
 */
export const CALL_CLIENTS = ['livekit_web', 'element_call'] as const

export const TUTORING_SESSION_STATUSES = ['scheduled', 'active', 'ended'] as const

/** States the agent broadcasts over the LiveKit DataChannel to drive the avatar. */
export const AGENT_STATES = ['idle', 'listening', 'searching_rag', 'thinking', 'speaking'] as const

/** LiveKit DataChannel topic carrying `AgentStateEvent` payloads. */
export const AGENT_STATE_TOPIC = 'monibot.agent-state'

/** Name the agent shows in LiveKit and, as its Matrix display name, in Element Call. */
export const AGENT_DISPLAY_NAME = 'MoniBot'
/** MatrixRTC device of the agent; its LiveKit identity is `<bot user id>:<device>`. */
export const AGENT_MATRIX_DEVICE_ID = 'MONIBOT'

/** Lifecycle reports the worker sends so the API can mirror its presence as a MatrixRTC member. */
export const AGENT_PRESENCE_STATES = ['joined', 'heartbeat', 'left'] as const
/** How often the worker sends `heartbeat`; must stay well below the API's delayed-leave timeout. */
export const AGENT_PRESENCE_HEARTBEAT_MS = 10_000
export const AGENT_MATRIX_MEMBERSHIP_OUTCOMES = [
  'published',
  'refreshed',
  'removed',
  'not_applicable',
] as const

export const USER_ROLES = ['student', 'researcher'] as const

export const RETRIEVAL_DEFAULT_TOP_K = 4
export const RETRIEVAL_MAX_TOP_K = 20
/**
 * Cosine-similarity floor, calibrated for `nomic-embed-text-v2-moe` on Portuguese course text
 * (relevant passages ≈ 0.44–0.55, unrelated ≈ 0.15–0.29). Re-tune when the model or material changes.
 */
export const RETRIEVAL_DEFAULT_MIN_SCORE = 0.35

export const SUS_ITEM_COUNT = 10
export const LIKERT_MIN = 1
export const LIKERT_MAX = 5

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const

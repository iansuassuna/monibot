import type {
  AgentState,
  KnowledgeCategory,
  KnowledgeDocumentStatus,
  LatencyMetric,
  TutoringSessionStatus,
} from '@monibot/types'

export const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  lecture_slides: 'Notas de aula',
  exercise_list: 'Lista de exercícios',
  past_exam: 'Prova anterior',
  code_reference: 'Código de referência',
}

export const DOCUMENT_STATUS_LABELS: Record<KnowledgeDocumentStatus, string> = {
  processing: 'Processando',
  indexed: 'Indexado',
  failed: 'Falhou',
}

export const SESSION_STATUS_LABELS: Record<TutoringSessionStatus, string> = {
  scheduled: 'Agendada',
  active: 'Em andamento',
  ended: 'Encerrada',
}

export const AGENT_STATE_LABELS: Record<AgentState, string> = {
  idle: 'Aguardando',
  listening: 'Ouvindo',
  searching_rag: 'Consultando o material',
  thinking: 'Pensando',
  speaking: 'Falando',
}

export const METRIC_LABELS: Record<LatencyMetric, string> = {
  sttLatencyMs: 'STT',
  ragLatencyMs: 'RAG',
  llmTtftMs: 'LLM (TTFT)',
  llmTotalLatencyMs: 'LLM (total)',
  ttsLatencyMs: 'TTS',
  totalE2eLatencyMs: 'Total E2E',
}

export function conditionLabel(condition: { ragEnabled: boolean; avatarEnabled: boolean }) {
  return `${condition.ragEnabled ? 'Com RAG' : 'Sem RAG'} · ${condition.avatarEnabled ? 'Com avatar' : 'Só áudio'}`
}

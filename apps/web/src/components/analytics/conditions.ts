import type { ConditionAnalytics } from '@monibot/types'

export interface ConditionSeries {
  key: string
  label: string
  color: string
  ragEnabled: boolean
  avatarEnabled: boolean
}

/** Fixed design-cell → color mapping; a cell keeps its color whether or not it has data. */
export const CONDITION_SERIES: readonly ConditionSeries[] = [
  {
    key: 'rag-avatar',
    label: 'RAG + Avatar',
    color: 'var(--series-1)',
    ragEnabled: true,
    avatarEnabled: true,
  },
  {
    key: 'rag-audio',
    label: 'RAG + Só áudio',
    color: 'var(--series-2)',
    ragEnabled: true,
    avatarEnabled: false,
  },
  {
    key: 'llm-avatar',
    label: 'Sem RAG + Avatar',
    color: 'var(--series-3)',
    ragEnabled: false,
    avatarEnabled: true,
  },
  {
    key: 'llm-audio',
    label: 'Sem RAG + Só áudio',
    color: 'var(--series-4)',
    ragEnabled: false,
    avatarEnabled: false,
  },
]

export function findCondition(conditions: readonly ConditionAnalytics[], series: ConditionSeries) {
  return conditions.find(
    (condition) =>
      condition.ragEnabled === series.ragEnabled && condition.avatarEnabled === series.avatarEnabled
  )
}

export const msFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
export const scoreFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

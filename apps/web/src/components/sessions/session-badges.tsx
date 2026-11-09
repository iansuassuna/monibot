import type { TutoringSessionStatus } from '@monibot/types'
import { Badge } from '@/components/ui/badge'
import { SESSION_STATUS_LABELS } from '@/lib/labels'

const STATUS_VARIANT = {
  scheduled: 'secondary',
  active: 'success',
  ended: 'outline',
} as const satisfies Record<TutoringSessionStatus, 'secondary' | 'success' | 'outline'>

export function SessionStatusBadge({ status }: { status: TutoringSessionStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{SESSION_STATUS_LABELS[status]}</Badge>
}

export function ConditionBadges({
  ragEnabled,
  avatarEnabled,
}: {
  ragEnabled: boolean
  avatarEnabled: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant={ragEnabled ? 'default' : 'secondary'}>
        {ragEnabled ? 'Com RAG' : 'Sem RAG'}
      </Badge>
      <Badge variant={avatarEnabled ? 'default' : 'secondary'}>
        {avatarEnabled ? 'Com avatar' : 'Só áudio'}
      </Badge>
    </div>
  )
}

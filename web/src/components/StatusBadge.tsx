import { Badge } from '@/components/ui/badge'
import type { ThreadStatus } from '@/lib/api'

/**
 * Where a thread stands: waiting for somebody, taken, or done.
 * Only "claimed" gets the accent colour — nearly everything is waiting, so
 * colouring that too would make the colour meaningless.
 */
export function StatusBadge({
  status,
  claimedBy,
}: {
  status: ThreadStatus
  claimedBy: string | null
}) {
  if (status === 'answered') return <Badge variant="outline">Answered</Badge>
  if (status === 'claimed') {
    return (
      <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {claimedBy ?? 'Claimed'}
      </Badge>
    )
  }
  return <Badge variant="secondary">Waiting</Badge>
}

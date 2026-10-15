import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchThreads } from '@/lib/api'

/**
 * How many customer threads are still waiting on us, in the header of every
 * page — so you can see whether the team is on top of it without reading the
 * list.
 *
 * It uses the same query key as the inbox list, so the two can never disagree
 * and the data is fetched once. A claim or an answer elsewhere invalidates
 * `['threads']`, which refreshes this number too.
 *
 * Shows a small skeleton while it loads. If the very first load fails there is
 * no number to show, so it shows nothing — but a *refresh* that fails keeps
 * the last known number, the same as the list below, instead of the badge
 * disappearing from under you.
 */
export function WaitingCount() {
  const waiting = useQuery({
    queryKey: ['threads', 'waiting'],
    queryFn: () => fetchThreads('waiting'),
  })

  if (waiting.isPending) return <Skeleton className="h-7 w-32" />
  if (!waiting.data) return null

  const count = waiting.data.length

  return (
    <Badge variant="secondary" className="h-7 max-w-full gap-1.5 px-2.5 text-sm">
      <Clock className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">
        <span className="font-semibold tabular-nums">{count}</span>{' '}
        {count === 1 ? 'thread waiting' : 'waiting for a reply'}
      </span>
    </Badge>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, HandHeart, TriangleAlert, Undo2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MessageList } from '@/components/MessageList'
import { RefreshFailed } from '@/components/RefreshFailed'
import { StatusBadge } from '@/components/StatusBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ApiError,
  claimThread,
  fetchThread,
  markAnswered,
  releaseThread,
  reopenThread,
} from '@/lib/api'

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function ThreadPage({ me }: { me: string | null }) {
  const { threadId: param } = useParams()
  const threadId = Number(param)
  const queryClient = useQueryClient()

  const thread = useQuery({
    queryKey: ['thread', threadId],
    queryFn: () => fetchThread(threadId),
    enabled: Number.isInteger(threadId) && threadId > 0,
  })

  /** After a claim or an answer, both the thread and the list have changed. */
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] }),
      queryClient.invalidateQueries({ queryKey: ['threads'] }),
    ])
  }

  const claim = useMutation({
    mutationFn: () => claimThread(threadId, me ?? ''),
    onSuccess: async () => {
      toast.success('Yours now — the team can see your name on it')
      await refresh()
    },
    onError: async (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Could not claim this thread')
      await refresh()
    },
  })

  const answer = useMutation({
    mutationFn: () => markAnswered(threadId, me ?? ''),
    onSuccess: async () => {
      toast.success('Marked answered — it has left the waiting list')
      await refresh()
    },
    onError: async (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Could not mark this answered')
      await refresh()
    },
  })

  const release = useMutation({
    mutationFn: () => releaseThread(threadId, me ?? ''),
    onSuccess: async () => {
      toast.success('Handed back — it is waiting for the team again')
      await refresh()
    },
    onError: async (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Could not hand this back')
      await refresh()
    },
  })

  const reopen = useMutation({
    mutationFn: () => reopenThread(threadId, me ?? ''),
    onSuccess: async () => {
      toast.success('Back on the waiting list, and still yours')
      await refresh()
    },
    onError: async (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Could not undo this')
      await refresh()
    },
  })

  if (!Number.isInteger(threadId) || threadId <= 0) return <NotFound />
  if (thread.isPending) return <Loading />
  // Only give up the screen when there is nothing to show. A failed refresh
  // must never take the conversation you are reading away from you.
  if (thread.isError && !thread.data) {
    const missing = thread.error instanceof ApiError && thread.error.status === 404
    return missing ? (
      <NotFound />
    ) : (
      <LoadFailed busy={thread.isFetching} onRetry={() => void thread.refetch()} />
    )
  }

  const { thread: head, messages } = thread.data
  const mine = head.status === 'claimed' && head.claimedBy === me
  const iAnswered = head.status === 'answered' && head.answeredBy === me
  const busy = claim.isPending || answer.isPending || release.isPending || reopen.isPending

  return (
    <div className="space-y-6">
      <Button render={<Link to="/" />} variant="ghost" size="sm" className="-ml-2">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the waiting list
      </Button>

      {thread.isError ? (
        <RefreshFailed busy={thread.isFetching} onRetry={() => void thread.refetch()} />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="text-xl">{head.customer}</CardTitle>
              <CardDescription>
                {head.contactName ? `${head.contactName} · ` : ''}
                {head.messageCount} messages · last one{' '}
                {dateTime.format(new Date(head.lastMessageAt))}
              </CardDescription>
            </div>
            <StatusBadge status={head.status} claimedBy={head.claimedBy} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {!me ? (
            <p className="text-sm text-muted-foreground">
              Pick your name in the header before taking a thread.
            </p>
          ) : head.status === 'answered' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Answered by {head.answeredBy}
                {head.answeredAt ? ` on ${dateTime.format(new Date(head.answeredAt))}` : ''}.
              </p>
              {iAnswered ? (
                <Button variant="outline" onClick={() => reopen.mutate()} disabled={busy}>
                  <Undo2 className="size-4" aria-hidden="true" />
                  Undo — it still needs a reply
                </Button>
              ) : null}
            </>
          ) : mine ? (
            <>
              <ConfirmAnswered
                customer={head.customer}
                busy={busy}
                onConfirm={() => answer.mutate()}
              />
              <Button variant="outline" onClick={() => release.mutate()} disabled={busy}>
                <HandHeart className="size-4" aria-hidden="true" />
                Hand it back
              </Button>
              <p className="text-sm text-muted-foreground">
                This one is yours — mark it answered once you have replied, or hand it back if you
                cannot finish it.
              </p>
            </>
          ) : head.status === 'claimed' ? (
            <p className="text-sm text-muted-foreground">
              {head.claimedBy} is taking care of this one.
            </p>
          ) : (
            <>
              <Button onClick={() => claim.mutate()} disabled={busy}>
                Claim this thread
              </Button>
              <p className="text-sm text-muted-foreground">
                Your name goes on it, so no colleague starts the same reply.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* A single odd message must cost you the conversation, not the app. */}
      <ErrorBoundary where="conversation">
        <MessageList messages={messages} />
      </ErrorBoundary>
    </div>
  )
}

/**
 * Marking a thread answered takes it off the waiting list for everyone, so it
 * asks first instead of acting on one stray click. You can undo your own mark
 * afterwards; a colleague cannot undo it for you.
 */
function ConfirmAnswered({
  customer,
  busy,
  onConfirm,
}: {
  customer: string
  busy: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button disabled={busy} />}>
        <Check className="size-4" aria-hidden="true" />
        Mark answered
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Have you replied to {customer}?</AlertDialogTitle>
          <AlertDialogDescription>
            This takes the thread off the waiting list for the whole team. You can undo it
            yourself afterwards — a colleague cannot.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Yes, I have replied</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the thread">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

function NotFound() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="font-medium text-foreground">That thread does not exist</p>
        <Button render={<Link to="/" />} variant="outline">
          Back to the waiting list
        </Button>
      </CardContent>
    </Card>
  )
}

function LoadFailed({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <TriangleAlert className="size-8 text-destructive" aria-hidden="true" />
        <p className="font-medium text-foreground">Could not load this thread</p>
        <Button variant="outline" onClick={onRetry} disabled={busy}>
          {busy ? 'Trying…' : 'Try again'}
        </Button>
      </CardContent>
    </Card>
  )
}

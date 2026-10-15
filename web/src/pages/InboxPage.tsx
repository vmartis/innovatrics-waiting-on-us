import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCheck, Search, TriangleAlert, UserRound } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChannelBadge } from '@/components/ChannelBadge'
import { RefreshFailed } from '@/components/RefreshFailed'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ApiError,
  claimThread,
  fetchThreads,
  type ThreadSummary,
  type ThreadView,
} from '@/lib/api'
import { filterBySearch } from '@shared/search.ts'
import { isLongWait, waitedFor } from '@shared/elapsed.ts'
import { onlyMine } from '@shared/waiting.ts'

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function InboxPage({ me }: { me: string | null }) {
  const [view, setView] = useState<ThreadView>('waiting')
  const [search, setSearch] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const threads = useQuery({ queryKey: ['threads', view], queryFn: () => fetchThreads(view) })
  const answered = view === 'answered'

  // All 22 threads are already in the browser, so narrowing them is instant
  // and needs no request. Both rules live in /lib and are tested there.
  // "Only mine" means "mine to do", so it never applies to the answered list —
  // otherwise switching views would empty the screen with the toggle that did
  // it hidden, and no obvious way back.
  const pile = threads.data && mineOnly && !answered ? onlyMine(threads.data, me) : threads.data
  const shown = pile ? filterBySearch(pile, search) : undefined
  const hiddenBySearch = pile && shown ? pile.length - shown.length : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>{answered ? 'Answered' : 'Waiting on us'}</CardTitle>
            <CardDescription>
              {threads.data
                ? answered
                  ? `${threads.data.length} customer threads the team has answered`
                  : `${threads.data.length} customer threads still need a reply`
                : 'Reading the shared inbox'}
            </CardDescription>
          </div>
          <ViewSwitch view={view} onChange={setView} />
        </div>
      </CardHeader>
      <CardContent>
        {threads.isPending ? <LoadingRows /> : null}
        {threads.isError && !threads.data ? (
          <LoadFailed busy={threads.isFetching} onRetry={() => void threads.refetch()} />
        ) : null}
        {threads.isError && threads.data ? (
          <RefreshFailed busy={threads.isFetching} onRetry={() => void threads.refetch()} />
        ) : null}
        {threads.data?.length === 0 ? <Nothing answered={answered} /> : null}
        {threads.data && threads.data.length > 0 ? (
          <>
            <SearchBox
              value={search}
              onChange={setSearch}
              hidden={hiddenBySearch}
              mineOnly={mineOnly}
              onMineOnly={answered ? null : setMineOnly}
              me={me}
            />
            {shown && shown.length > 0 ? (
              <ThreadTable threads={shown} answered={answered} me={me} />
            ) : (
              <NoMatch
                search={search}
                mineOnly={mineOnly}
                onClear={() => {
                  setSearch('')
                  setMineOnly(false)
                }}
              />
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Type a few letters of a company or a contact person to narrow the list. */
function SearchBox({
  value,
  onChange,
  hidden,
  mineOnly,
  onMineOnly,
  me,
}: {
  value: string
  onChange: (value: string) => void
  hidden: number
  mineOnly: boolean
  /** null on the answered list, where "mine to do" means nothing. */
  onMineOnly: ((mineOnly: boolean) => void) | null
  me: string | null
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Find a customer or contact…"
          aria-label="Find a customer or contact"
          className="pl-8"
        />
      </div>
      {onMineOnly ? (
        <Button
          variant={mineOnly ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={mineOnly}
          disabled={!me}
          title={me ? undefined : 'Pick your name in the header first'}
          onClick={() => onMineOnly(!mineOnly)}
        >
          <UserRound className="size-4" aria-hidden="true" />
          {mineOnly ? 'Showing only mine' : 'Only mine'}
        </Button>
      ) : null}
      {hidden > 0 ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {hidden} hidden by your search
          <Button variant="link" size="sm" className="px-1" onClick={() => onChange('')}>
            Clear
          </Button>
        </p>
      ) : null}
    </div>
  )
}

function NoMatch({
  search,
  mineOnly,
  onClear,
}: {
  search: string
  mineOnly: boolean
  onClear: () => void
}) {
  const typed = search.trim()
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Search className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-md break-words font-medium text-foreground">
        {typed ? `No customer matches “${typed.slice(0, 60)}”` : 'Nothing claimed by you'}
        {typed && mineOnly ? ' in your own threads' : ''}
      </p>
      <p className="text-sm text-muted-foreground">
        {typed
          ? 'Check the spelling, or try just a few letters of the company name.'
          : 'Claim a thread and it will show up here.'}
      </p>
      <Button variant="outline" onClick={onClear}>
        Show all
      </Button>
    </div>
  )
}

/** Two lists: the work, and the record of work done. */
function ViewSwitch({
  view,
  onChange,
}: {
  view: ThreadView
  onChange: (view: ThreadView) => void
}) {
  return (
    <div className="flex gap-1 rounded-md bg-muted p-1" role="group" aria-label="Which list">
      {(['waiting', 'answered'] as const).map((option) => (
        <Button
          key={option}
          size="sm"
          variant={view === option ? 'secondary' : 'ghost'}
          aria-pressed={view === option}
          onClick={() => onChange(option)}
        >
          {option === 'waiting' ? 'Waiting on us' : 'Answered'}
        </Button>
      ))}
    </div>
  )
}

function ThreadTable({
  threads,
  answered,
  me,
}: {
  threads: ThreadSummary[]
  answered: boolean
  me: string | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Claim and open in one go: the slow path was open -> claim -> read.
  // A 409 ("somebody else got there first") keeps you on the list with the
  // server's own wording, so you can pick a different thread.
  const claim = useMutation({
    mutationFn: (thread: ThreadSummary) => claimThread(thread.threadId, me ?? ''),
    onSuccess: async (_state, thread) => {
      toast.success(`Yours now — opening ${thread.customer}`)
      navigate(`/threads/${thread.threadId}`)
      // The thread page may already hold this thread from earlier in the
      // session; without this it would show "Claim this thread" for a moment.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads'] }),
        queryClient.invalidateQueries({ queryKey: ['thread', thread.threadId] }),
      ])
    },
    onError: async (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Could not claim this thread')
      await queryClient.invalidateQueries({ queryKey: ['threads'] })
    },
  })

  const onClaim = (event: MouseEvent, thread: ThreadSummary) => {
    // Never let the claim also open the row underneath it.
    event.stopPropagation()
    if (!me) {
      toast.info('Pick your name in the header first, then claim.')
      return
    }
    claim.mutate(thread)
  }

  /**
   * The whole row opens the thread, so you do not have to aim at the name.
   * The row is deliberately not focusable: the customer name is a real link,
   * which keeps keyboard access, middle-click and "open in a new tab" working
   * without a second tab stop per row. Clicks that the link or a button
   * already handled, and clicks meant to open a new tab or select text, are
   * left alone.
   */
  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, thread: ThreadSummary) => {
    if (event.defaultPrevented || event.button !== 0) return
    // A disabled button does not swallow its own click, so without this a
    // click on a greyed "Claim and open" would open that thread unclaimed.
    if (claim.isPending) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.target instanceof Element && event.target.closest('a, button, [role="button"]')) {
      return
    }
    if (window.getSelection()?.toString()) return
    navigate(`/threads/${thread.threadId}`)
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead>
          <TableHead>{answered ? 'Answered by' : 'Status'}</TableHead>
          <TableHead>Channels</TableHead>
          <TableHead className="text-right">Messages</TableHead>
          <TableHead>{answered ? 'Answered' : 'Waiting'}</TableHead>
          {answered ? null : (
            <TableHead className="text-right">
              <span className="sr-only">Take the thread</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {threads.map((thread) => (
          <TableRow
            key={thread.threadId}
            className="cursor-pointer hover:bg-muted/50"
            onClick={(event) => onRowClick(event, thread)}
          >
            <TableCell>
              <Link
                to={`/threads/${thread.threadId}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {thread.customer}
              </Link>
              {thread.contactName ? (
                <div className="text-xs text-muted-foreground">{thread.contactName}</div>
              ) : null}
            </TableCell>
            <TableCell>
              {answered ? (
                <span className="text-sm text-foreground">{thread.answeredBy}</span>
              ) : (
                <StatusBadge status={thread.status} claimedBy={thread.claimedBy} />
              )}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {thread.channels.map((channel) => (
                  <ChannelBadge key={channel} channel={channel} />
                ))}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{thread.messageCount}</TableCell>
            <TableCell>
              {answered ? (
                <span className="text-muted-foreground">
                  {dateTime.format(new Date(thread.answeredAt ?? thread.lastMessageAt))}
                </span>
              ) : (
                <WaitedFor since={thread.lastMessageAt} />
              )}
            </TableCell>
            {answered ? null : (
              <TableCell className="text-right">
                {thread.status === 'waiting' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={claim.isPending}
                    aria-label={`Claim and open ${thread.customer}`}
                    onClick={(event) => onClaim(event, thread)}
                  >
                    {/* Say which row is being claimed, not just "something is". */}
                    {claim.isPending && claim.variables?.threadId === thread.threadId ? (
                      'Claiming…'
                    ) : (
                      <>
                        Claim and open
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                ) : null}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * How long this customer has been waiting. The exact time is still there on
 * hover, but "9 days" is what tells you whether to pick this one up.
 */
function WaitedFor({ since }: { since: string }) {
  const now = new Date()
  const overdue = isLongWait(since, now)
  return (
    <span
      className={overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}
      title={dateTime.format(new Date(since))}
    >
      {waitedFor(since, now)}
    </span>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading the inbox">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

function Nothing({ answered }: { answered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <CheckCheck className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium text-foreground">
        {answered ? 'Nothing answered yet' : 'Nothing is waiting on us'}
      </p>
      <p className="text-sm text-muted-foreground">
        {answered
          ? 'Threads show up here once somebody marks them answered.'
          : 'Every customer thread has been answered. New messages show up here.'}
      </p>
    </div>
  )
}

function LoadFailed({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <TriangleAlert className="size-8 text-destructive" aria-hidden="true" />
      <p className="font-medium text-foreground">Could not load the inbox</p>
      <p className="text-sm text-muted-foreground">
        The server did not answer. Nothing has been lost — try again.
      </p>
      <Button variant="outline" onClick={onRetry} disabled={busy}>
        {busy ? 'Trying…' : 'Try again'}
      </Button>
    </div>
  )
}


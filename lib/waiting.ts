/**
 * The waiting rule and the claim state, kept free of database and HTTP code.
 *
 * Every row in `requests` is an inbound customer message, so a thread is
 * waiting on us until somebody marks it answered. If the customer writes again
 * *after it was answered*, the thread is waiting again and anybody may take
 * it, because the person who answered has finished their reply.
 *
 * A claim that nobody has finished is never freed by a new message: the
 * colleague is still working on it, and dropping their name would bring back
 * the "customers hear from two of us" problem the product exists to remove.
 */
import type { ThreadSummary } from './threads.ts'
import { NO_WORK, type TopicWork } from './topics.ts'

/** One row of our own `thread_claims` table. */
export type ClaimRow = {
  thread_id: number
  latest_message_id: number
  claimed_by: string | null
  claimed_at: Date | null
  answered_by: string | null
  answered_at: Date | null
}

export type ThreadStatus = 'waiting' | 'claimed' | 'answered'

export type ThreadState = {
  status: ThreadStatus
  /** Who is responsible for the next reply, when somebody claimed it. */
  claimedBy: string | null
  claimedAt: string | null
  answeredBy: string | null
  answeredAt: string | null
}

export type ThreadListItem = ThreadSummary & ThreadState & TopicWork

const FRESH: ThreadState = {
  status: 'waiting',
  claimedBy: null,
  claimedAt: null,
  answeredBy: null,
  answeredAt: null,
}

function iso(value: Date | null): string | null {
  return value ? new Date(value).toISOString() : null
}

/**
 * Work out where a thread stands from its newest message and our own row.
 *
 * An answered row from before the newest message is spent: the customer has
 * come back since, so the thread starts over as waiting. An unfinished claim
 * stays with its owner however many messages arrive.
 */
export function threadState(latestMessageId: number, claim: ClaimRow | undefined): ThreadState {
  if (!claim) return FRESH

  const reopened = claim.latest_message_id < latestMessageId
  if (reopened && claim.answered_by) return FRESH

  if (claim.answered_by) {
    return {
      status: 'answered',
      claimedBy: claim.claimed_by,
      claimedAt: iso(claim.claimed_at),
      answeredBy: claim.answered_by,
      answeredAt: iso(claim.answered_at),
    }
  }

  if (claim.claimed_by) {
    return {
      status: 'claimed',
      claimedBy: claim.claimed_by,
      claimedAt: iso(claim.claimed_at),
      answeredBy: null,
      answeredAt: null,
    }
  }

  return FRESH
}

/** True while this thread still needs a reply from us. */
export function isWaitingOnUs(state: ThreadState): boolean {
  return state.status !== 'answered'
}

/** Which list a teammate is looking at. */
export type ThreadView = 'waiting' | 'answered'

/** Accept only a known view name; anything else means the normal list. */
export function asThreadView(value: unknown): ThreadView {
  return value === 'answered' ? 'answered' : 'waiting'
}

/**
 * When this customer started waiting on us: their oldest message nobody has
 * answered yet. Measuring from the *newest* message was a mistake — a
 * customer who waited five days and chased this morning looked two hours old
 * and dropped to the bottom, so the more they chased, the less urgent they
 * looked. Without topic numbers (old callers, tests) it falls back to the
 * newest message, which is what the list did before.
 */
export function waitingSince(item: ThreadListItem): string {
  return item.waitingSince ?? item.lastMessageAt
}

/**
 * The threads one list shows.
 *
 * "waiting" is the job, **longest wait first**, counted from the oldest
 * unanswered message (see `waitingSince`): the customer nobody has got to is
 * the first thing you see rather than the last (FRICTION.md 15:12). Between
 * two equally long waits, the customer who chased more often comes first.
 * This is deliberately the opposite of the order inside a thread, where the
 * newest message is on top — the list asks "who has waited longest", a thread
 * asks "what did they just say".
 *
 * "answered" is the record of what the team has dealt with, most recently
 * answered first — the order in which somebody asks "who answered this?".
 */
export function forView(items: readonly ThreadListItem[], view: ThreadView): ThreadListItem[] {
  if (view === 'waiting') {
    return items.filter(isWaitingOnUs).sort((a, b) => {
      const since = waitingSince(a).localeCompare(waitingSince(b))
      if (since !== 0) return since
      if (a.unansweredCount !== b.unansweredCount) return b.unansweredCount - a.unansweredCount
      return a.threadId - b.threadId
    })
  }

  return items
    .filter((item) => item.status === 'answered')
    .sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? ''))
}

/**
 * Just the threads this person has taken, for working your own pile. An
 * answered thread is never "mine to do", so only live claims count.
 */
export function onlyMine(items: readonly ThreadListItem[], me: string | null): ThreadListItem[] {
  if (!me) return []
  return items.filter((item) => item.status === 'claimed' && item.claimedBy === me)
}

/**
 * Join the inbox summaries with our own rows and the topic numbers, newest
 * thread first. A thread with no topic numbers gets zeros, not a crash.
 */
export function withState(
  summaries: readonly ThreadSummary[],
  claims: readonly ClaimRow[],
  work: ReadonlyMap<number, TopicWork> = new Map(),
): ThreadListItem[] {
  const byThread = new Map(claims.map((claim) => [claim.thread_id, claim]))
  return summaries.map((summary) => ({
    ...summary,
    ...threadState(summary.latestMessageId, byThread.get(summary.threadId)),
    ...(work.get(summary.threadId) ?? NO_WORK),
  }))
}

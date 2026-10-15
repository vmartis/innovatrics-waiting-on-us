import { Router } from 'express'
import { pool } from '../db.ts'
import { asThreadId, findThread } from '../threadLookup.ts'
import { toTimeline, type TimelineRow } from '../../lib/thread.ts'
import { toThreadSummaries, type RequestRow } from '../../lib/threads.ts'
import { asThreadView, forView, threadState, withState, type ClaimRow } from '../../lib/waiting.ts'

export const threadsRouter: Router = Router()

const CLAIM_COLUMNS = 'thread_id, latest_message_id, claimed_by, claimed_at, answered_by, answered_at'

/**
 * GET /api/threads — the waiting list, longest wait first.
 *
 * `?show=answered` gives the other list instead: what the team has dealt with,
 * most recently answered first, with the name of whoever answered. A thread is
 * never in both. Message bodies and subjects stay in the database until a
 * teammate opens a thread. The 340 sample rows are folded in JavaScript so the
 * rules live in tested functions (lib/threads.ts, lib/waiting.ts).
 */
threadsRouter.get('/', async (req, res) => {
  const view = asThreadView(req.query.show)
  const [messages, claims] = await Promise.all([
    pool.query<RequestRow>(`SELECT id, customer, contact_name, channel, received_at FROM requests`),
    pool.query<ClaimRow>(`SELECT ${CLAIM_COLUMNS} FROM thread_claims`),
  ])

  const all = withState(toThreadSummaries(messages.rows), claims.rows)
  res.json({ view, threads: forView(all, view) })
})

/**
 * GET /api/threads/:threadId — one customer's whole conversation, every
 * channel in one timeline, newest message first with replies kept next to the
 * message they answer (the rule lives in lib/thread.ts).
 *
 * Bodies are sent as plain text and the web app renders them as text only.
 */
threadsRouter.get('/:threadId', async (req, res) => {
  const threadId = asThreadId(req.params.threadId)
  if (threadId === null) {
    res.status(400).json({ error: 'unknown thread' })
    return
  }

  const thread = await findThread(threadId)
  if (!thread) {
    res.status(404).json({ error: 'unknown thread' })
    return
  }

  const [messages, claim] = await Promise.all([
    pool.query<RequestRow & TimelineRow>(
      // LIMIT is a safeguard, not a feature: the busiest sample customer has
      // 18 messages, and the folding below is linear in what it is given.
      `SELECT id, customer, contact_name, channel, received_at, subject, body, in_reply_to
         FROM requests
        WHERE customer = $1
        ORDER BY received_at DESC, id DESC
        LIMIT 500`,
      [thread.customer],
    ),
    pool.query<ClaimRow>(`SELECT ${CLAIM_COLUMNS} FROM thread_claims WHERE thread_id = $1`, [
      thread.threadId,
    ]),
  ])

  const [summary] = toThreadSummaries(messages.rows)
  res.json({
    thread: { ...summary, ...threadState(thread.latestMessageId, claim.rows[0]) },
    messages: toTimeline(messages.rows),
  })
})

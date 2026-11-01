import { Router, type Request, type Response } from 'express'
import type { PoolClient } from 'pg'
import { currentPerson } from '../currentPerson.ts'
import { pool } from '../db.ts'
import { asThreadId, findThread, type ThreadRef } from '../threadLookup.ts'
import { asMessageId, loadTopics, type ThreadTopics } from '../topicLookup.ts'
import { threadState, type ClaimRow, type ThreadState } from '../../lib/waiting.ts'
import type { TeamMember } from '../../lib/team.ts'

export const topicsRouter: Router = Router()

const CLAIM_COLUMNS = 'thread_id, latest_message_id, claimed_by, claimed_at, answered_by, answered_at'

/** Why a topic change was refused: the status code and the server's words. */
class Refused extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Context = {
  client: PoolClient
  thread: ThreadRef
  person: TeamMember
  state: ThreadState
  work: ThreadTopics
}

/**
 * The shared shape of every topic change: check the input, then run `change`
 * inside one transaction that holds the thread's claim row locked, so a claim,
 * a hand-back or another topic change cannot slip in between the checks and
 * the write. The answer is the thread's state and topics after the change.
 *
 * The claim row is the lock because every topic change needs a claim: one
 * owner per customer stays the rule, topics only split up what "answered"
 * means.
 */
async function changeTopics(
  req: Request,
  res: Response,
  change: (ctx: Context) => Promise<void>,
): Promise<void> {
  const threadId = asThreadId(req.params.threadId)
  const person = currentPerson(req)
  if (threadId === null) {
    res.status(400).json({ error: 'unknown thread' })
    return
  }
  if (!person) {
    res.status(400).json({ error: 'pick your name from the team list first' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const thread = await findThread(threadId, client)
    if (!thread) throw new Refused(404, 'unknown thread')

    const claim = await client.query<ClaimRow>(
      `SELECT ${CLAIM_COLUMNS} FROM thread_claims WHERE thread_id = $1 FOR UPDATE`,
      [thread.threadId],
    )
    const state = threadState(thread.latestMessageId, claim.rows[0])
    const work = await loadTopics(thread, client)
    await change({ client, thread, person, state, work })

    const after = await client.query<ClaimRow>(
      `SELECT ${CLAIM_COLUMNS} FROM thread_claims WHERE thread_id = $1`,
      [thread.threadId],
    )
    const { topics } = await loadTopics(thread, client)
    await client.query('COMMIT')
    res.json({ state: threadState(thread.latestMessageId, after.rows[0]), topics })
  } catch (err) {
    await client.query('ROLLBACK')
    if (!(err instanceof Refused)) throw err
    res.status(err.status).json({ error: err.message })
  } finally {
    client.release()
  }
}

/** Only the person holding the thread may change its topics. */
function mustHoldClaim({ state, person }: Context, what: string): void {
  if (state.status === 'claimed' && state.claimedBy === person) return
  if (state.status === 'claimed' && state.claimedBy) {
    throw new Refused(409, `${state.claimedBy} is taking care of this one now`)
  }
  throw new Refused(409, `claim this thread first — only the person who claimed it can ${what}`)
}

function findTopic({ work }: Context, value: unknown) {
  const topicId = asThreadId(value)
  const topic = work.topics.find((t) => t.topicId === topicId)
  if (!topic) throw new Refused(404, 'unknown topic')
  return topic
}

/**
 * POST /api/threads/:threadId/topics/:topicId/answered — record that you
 * replied to one topic of this customer.
 *
 * The body says which message you saw last in the topic (`seenMessageId`).
 * If the customer has written in it since, it is refused: you cannot close a
 * message you have not read. When this was the last open topic, the whole
 * thread is answered and leaves the waiting list, exactly as before topics.
 */
topicsRouter.post('/:threadId/topics/:topicId/answered', async (req, res) => {
  await changeTopics(req, res, async (ctx) => {
    mustHoldClaim(ctx, 'mark a topic answered')
    const topic = findTopic(ctx, req.params.topicId)
    if (topic.status === 'answered') throw new Refused(409, 'this topic is already answered')

    const seen = asMessageId((req.body as { seenMessageId?: unknown }).seenMessageId)
    if (seen !== topic.newestMessageId) {
      throw new Refused(
        409,
        'the customer has written again in this topic — read the new message, then mark it answered',
      )
    }

    const { client, thread, person } = ctx
    await client.query(
      `INSERT INTO topic_answers (topic_id, thread_id, latest_message_id, answered_by, answered_at)
            VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (topic_id) DO UPDATE
               SET thread_id         = EXCLUDED.thread_id,
                   latest_message_id = EXCLUDED.latest_message_id,
                   answered_by       = EXCLUDED.answered_by,
                   answered_at       = EXCLUDED.answered_at`,
      [topic.topicId, thread.threadId, topic.newestMessageId, person],
    )

    const stillOpen = ctx.work.topics.some(
      (t) => t.topicId !== topic.topicId && t.status === 'open',
    )
    if (!stillOpen) {
      // Same `now()` as the topic answer above (one transaction), which is how
      // undoing the thread finds the topic answers it has to take back.
      await client.query(
        `UPDATE thread_claims
            SET answered_by = $2, answered_at = now(), latest_message_id = $3
          WHERE thread_id = $1`,
        [thread.threadId, person, thread.latestMessageId],
      )
    }
  })
})

/**
 * POST /api/threads/:threadId/topics/:topicId/reopen — undo your own answer
 * on one topic. The thread must still be yours; if it had left the waiting
 * list because of that answer, it comes back, still yours.
 */
topicsRouter.post('/:threadId/topics/:topicId/reopen', async (req, res) => {
  await changeTopics(req, res, async (ctx) => {
    const topic = findTopic(ctx, req.params.topicId)
    const { client, thread, person, state } = ctx
    if (topic.status !== 'answered' || topic.answeredBy !== person) {
      throw new Refused(409, 'only the person who answered this topic can undo it')
    }
    if (state.status === 'waiting' || state.claimedBy !== person) {
      if (state.claimedBy && state.claimedBy !== person) {
        throw new Refused(409, `${state.claimedBy} is taking care of this one now`)
      }
      throw new Refused(409, 'claim this thread first — then you can undo your answer')
    }

    await client.query(`DELETE FROM topic_answers WHERE topic_id = $1`, [topic.topicId])
    if (state.status === 'answered') {
      await client.query(
        `UPDATE thread_claims SET answered_by = NULL, answered_at = NULL WHERE thread_id = $1`,
        [thread.threadId],
      )
    }
  })
})

/**
 * POST /api/threads/:threadId/messages/:messageId/topic — move a message that
 * has no reply link into the topic it belongs to (`topicId`), or back into a
 * topic of its own (`topicId: null`).
 *
 * Always by hand, never guessed from the text: message bodies are untrusted
 * customer input. A message that answers another one keeps the customer's own
 * link and cannot be moved.
 */
topicsRouter.post('/:threadId/messages/:messageId/topic', async (req, res) => {
  await changeTopics(req, res, async (ctx) => {
    mustHoldClaim(ctx, 'move messages between topics')
    const { client, thread, person, work } = ctx

    const messageId = asThreadId(req.params.messageId)
    const message = work.rows.find((row) => row.id === messageId)
    if (!message) throw new Refused(404, 'unknown message')
    if (message.in_reply_to !== null) {
      throw new Refused(409, 'this message answers another one, so it stays in that topic')
    }

    const raw = (req.body as { topicId?: unknown }).topicId
    if (raw === null) {
      await client.query(`DELETE FROM message_topics WHERE message_id = $1`, [message.id])
      return
    }

    const topicId = asMessageId(raw)
    if (topicId === null) throw new Refused(400, 'say which topic to move it into')
    // Only into another current topic, never into its own chain: that keeps
    // every move pointing at a different chain, so no loop can be built.
    const target = work.topics.find((t) => t.topicId === topicId)
    if (!target || target.messageIds.includes(message.id)) {
      throw new Refused(409, 'pick one of the other topics of this customer')
    }

    await client.query(
      `INSERT INTO message_topics (message_id, thread_id, topic_id, assigned_by)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id) DO UPDATE
               SET topic_id = EXCLUDED.topic_id,
                   assigned_by = EXCLUDED.assigned_by,
                   assigned_at = now()`,
      [message.id, thread.threadId, target.topicId, person],
    )
  })
})

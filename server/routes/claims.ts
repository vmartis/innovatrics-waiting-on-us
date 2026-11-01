import { Router, type Request, type Response } from 'express'
import type { QueryResult } from 'pg'
import { currentPerson } from '../currentPerson.ts'
import { pool } from '../db.ts'
import { asThreadId, findThread } from '../threadLookup.ts'
import { loadTopics } from '../topicLookup.ts'
import { threadState, type ClaimRow } from '../../lib/waiting.ts'

export const claimsRouter: Router = Router()

const CLAIM_COLUMNS = 'thread_id, latest_message_id, claimed_by, claimed_at, answered_by, answered_at'

/**
 * POST /api/threads/:threadId/claim — put your name on a thread.
 *
 * One statement does the whole thing, so two people clicking at the same
 * moment cannot both win: the row either does not exist yet, or it is free
 * (nobody claimed it), or the customer has written since it was last touched.
 * In every other case Postgres updates nothing and we answer 409.
 */
claimsRouter.post('/:threadId/claim', async (req, res) => {
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

  const thread = await findThread(threadId)
  if (!thread) {
    res.status(404).json({ error: 'unknown thread' })
    return
  }

  const claimed = await pool.query<ClaimRow>(
    `INSERT INTO thread_claims (thread_id, latest_message_id, claimed_by, claimed_at)
          VALUES ($1, $2, $3, now())
     ON CONFLICT (thread_id) DO UPDATE
            SET latest_message_id = EXCLUDED.latest_message_id,
                claimed_by        = EXCLUDED.claimed_by,
                claimed_at        = EXCLUDED.claimed_at,
                answered_by       = NULL,
                answered_at       = NULL
          WHERE thread_claims.claimed_by IS NULL
             OR (thread_claims.answered_by IS NOT NULL
                 AND thread_claims.latest_message_id < EXCLUDED.latest_message_id)
      RETURNING ${CLAIM_COLUMNS}`,
    [thread.threadId, thread.latestMessageId, person],
  )

  if (claimed.rowCount === 0) {
    const current = await readClaim(thread.threadId)
    const mine = current?.claimed_by === person
    res.status(409).json({
      error: mine ? 'you already have this one' : 'somebody else got there first',
      state: threadState(thread.latestMessageId, current),
    })
    return
  }

  res.json({ state: threadState(thread.latestMessageId, claimed.rows[0]) })
})

/**
 * POST /api/threads/:threadId/answered — record that you have replied.
 *
 * Only the person holding the claim may do it, so two people cannot close each
 * other's work by accident. With a name picker instead of a login this is a
 * coordination rule, not security: see server/currentPerson.ts.
 */
claimsRouter.post('/:threadId/answered', async (req, res) => {
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

  const thread = await findThread(threadId)
  if (!thread) {
    res.status(404).json({ error: 'unknown thread' })
    return
  }

  // One transaction: the thread mark and the answer for every open topic it
  // closes go in together, with the same `now()`, so undoing the thread can
  // find exactly the topic answers it has to take back.
  const client = await pool.connect()
  let answered: QueryResult<ClaimRow>
  try {
    await client.query('BEGIN')
    answered = await client.query<ClaimRow>(
      `UPDATE thread_claims
          SET answered_by = $3, answered_at = now()
        WHERE thread_id = $1
          AND latest_message_id = $2
          AND claimed_by = $3
          AND answered_by IS NULL
        RETURNING ${CLAIM_COLUMNS}`,
      [thread.threadId, thread.latestMessageId, person],
    )
    if (answered.rowCount !== 0) {
      const open = (await loadTopics(thread, client)).topics.filter((t) => t.status === 'open')
      await client.query(
        `INSERT INTO topic_answers (topic_id, thread_id, latest_message_id, answered_by, answered_at)
              SELECT topic_id, $1, latest, $2, now()
                FROM unnest($3::integer[], $4::integer[]) AS t(topic_id, latest)
         ON CONFLICT (topic_id) DO UPDATE
                 SET thread_id         = EXCLUDED.thread_id,
                     latest_message_id = EXCLUDED.latest_message_id,
                     answered_by       = EXCLUDED.answered_by,
                     answered_at       = EXCLUDED.answered_at`,
        [
          thread.threadId,
          person,
          open.map((t) => t.topicId),
          open.map((t) => t.newestMessageId),
        ],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  if (answered.rowCount === 0) {
    const current = await readClaim(thread.threadId)
    // Telling the two refusals apart matters: "the customer wrote again" has a
    // way out (claim it again), "it is not yours" does not.
    const stale =
      current?.claimed_by === person && current.latest_message_id < thread.latestMessageId
    res.status(409).json({
      error: stale
        ? 'the customer has written again since you claimed this — claim it again, then mark it answered'
        : 'claim this thread first — only the person who claimed it can mark it answered',
      state: threadState(thread.latestMessageId, current),
    })
    return
  }

  res.json({ state: threadState(thread.latestMessageId, answered.rows[0]) })
})

/**
 * POST /api/threads/:threadId/release — hand a thread back.
 *
 * Only the person holding it, and only while it is unanswered: the row stays
 * but loses the name, so the thread is waiting again and the next colleague
 * can take it. One statement, so it cannot half-happen.
 */
claimsRouter.post('/:threadId/release', async (req, res) => {
  await handBack(req, res, {
    // No `latest_message_id` check: a thread stays yours when the customer
    // writes again, so you must still be able to hand that one back.
    sql: `UPDATE thread_claims
             SET claimed_by = NULL, claimed_at = NULL
           WHERE thread_id = $1
             AND claimed_by = $2
             AND answered_by IS NULL
       RETURNING ${CLAIM_COLUMNS}`,
    values: (threadId, person) => [threadId, person],
    refused: 'only the person who claimed this thread can hand it back',
  })
})

/**
 * POST /api/threads/:threadId/reopen — undo your own "answered" mark.
 *
 * Only the person who answered. The claim stays with them, so the thread
 * comes back as theirs to finish rather than as a free-for-all.
 */
claimsRouter.post('/:threadId/reopen', async (req, res) => {
  await handBack(req, res, {
    // `latest_message_id = $3` matters: if the customer has written since, the
    // thread is already waiting for everyone, and undoing a spent answer must
    // not quietly turn it back into one person's claim.
    //
    // The topic answers written in the same moment as the thread mark (same
    // `answered_at`) are taken back too, so the topics that closed the thread
    // are open again. Every sub-statement sees the row as it was before, so
    // `was.answered_at` is the old time even though the update clears it.
    sql: `WITH was AS (
            SELECT answered_at FROM thread_claims WHERE thread_id = $1
          ), undone AS (
            UPDATE thread_claims
               SET answered_by = NULL, answered_at = NULL
             WHERE thread_id = $1
               AND answered_by = $2
               AND latest_message_id = $3
         RETURNING ${CLAIM_COLUMNS}
          ), taken_back AS (
            DELETE FROM topic_answers
             WHERE thread_id = $1
               AND answered_at = (SELECT answered_at FROM was)
               AND EXISTS (SELECT 1 FROM undone)
          )
          SELECT ${CLAIM_COLUMNS} FROM undone`,
    values: (threadId, person, latestMessageId) => [threadId, person, latestMessageId],
    refused: 'only the person who answered this thread can undo it',
  })
})

/**
 * Shared shape of release and reopen: same checks, one different statement.
 * `sql` is always a constant written in this file — never anything a caller
 * sent — and every value still goes in as a bound parameter.
 */
async function handBack(
  req: Request,
  res: Response,
  {
    sql,
    values,
    refused,
  }: {
    sql: string
    values: (threadId: number, person: string, latestMessageId: number) => unknown[]
    refused: string
  },
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

  const thread = await findThread(threadId)
  if (!thread) {
    res.status(404).json({ error: 'unknown thread' })
    return
  }

  const changed = await pool.query<ClaimRow>(
    sql,
    values(thread.threadId, person, thread.latestMessageId),
  )
  if (changed.rowCount === 0) {
    const current = await readClaim(thread.threadId)
    const heldByOther = current?.claimed_by && current.claimed_by !== person
    res.status(409).json({
      error: heldByOther ? `${current.claimed_by} is taking care of this one now` : refused,
      state: threadState(thread.latestMessageId, current),
    })
    return
  }

  res.json({ state: threadState(thread.latestMessageId, changed.rows[0]) })
}

async function readClaim(threadId: number): Promise<ClaimRow | undefined> {
  const result = await pool.query<ClaimRow>(
    `SELECT ${CLAIM_COLUMNS} FROM thread_claims WHERE thread_id = $1`,
    [threadId],
  )
  return result.rows[0]
}

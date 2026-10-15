import type { PoolClient } from 'pg'
import { pool } from './db.ts'

export type ThreadRef = {
  /** `requests.id` of the customer's first message. */
  threadId: number
  customer: string
  /** `requests.id` of the customer's newest message right now. */
  latestMessageId: number
}

/** A thread id is a positive 32-bit integer and nothing else. */
export function asThreadId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value)) return null
  const id = Number(value)
  return id <= 2147483647 ? id : null
}

/**
 * Look up the thread a id belongs to, straight from the sample data.
 *
 * The id must be the customer's *first* message, which is what identifies a
 * thread. Any other message id is refused, so a caller cannot invent keys.
 */
export async function findThread(
  threadId: number,
  client: PoolClient | typeof pool = pool,
): Promise<ThreadRef | null> {
  const result = await client.query<{ thread_id: number; customer: string; latest: number }>(
    `SELECT min(id) AS thread_id,
            customer,
            (array_agg(id ORDER BY received_at DESC, id DESC))[1] AS latest
       FROM requests
      WHERE customer = (SELECT customer FROM requests WHERE id = $1)
      GROUP BY customer`,
    [threadId],
  )

  const row = result.rows[0]
  if (!row || row.thread_id !== threadId) return null
  return { threadId: row.thread_id, customer: row.customer, latestMessageId: row.latest }
}

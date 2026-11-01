import type { PoolClient } from 'pg'
import { pool } from './db.ts'
import type { ThreadRef } from './threadLookup.ts'
import {
  assignmentMap,
  toTopics,
  type Topic,
  type TopicAnswerRow,
  type TopicAssignmentRow,
  type TopicMessageRow,
} from '../lib/topics.ts'

export const TOPIC_ANSWER_COLUMNS = 'topic_id, latest_message_id, answered_by, answered_at'

/** A message id from a JSON body: a positive 32-bit integer and nothing else. */
export function asMessageId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647
    ? value
    : null
}

export type ThreadTopics = {
  rows: TopicMessageRow[]
  assigned: Map<number, number>
  topics: Topic[]
}

/**
 * One customer's topics as they stand right now, read from the sample data
 * and our own two tables. Pass the transaction's client when the answer has
 * to agree with what the same transaction writes next.
 */
export async function loadTopics(
  thread: ThreadRef,
  client: PoolClient | typeof pool = pool,
): Promise<ThreadTopics> {
  // One after the other: a transaction's client runs one query at a time.
  const messages = await client.query<TopicMessageRow>(
    `SELECT id, received_at, in_reply_to FROM requests WHERE customer = $1`,
    [thread.customer],
  )
  const answers = await client.query<TopicAnswerRow>(
    `SELECT ${TOPIC_ANSWER_COLUMNS} FROM topic_answers WHERE thread_id = $1`,
    [thread.threadId],
  )
  const moves = await client.query<TopicAssignmentRow>(
    `SELECT message_id, topic_id, assigned_at FROM message_topics WHERE thread_id = $1`,
    [thread.threadId],
  )
  return {
    rows: messages.rows,
    assigned: assignmentMap(moves.rows),
    topics: toTopics(messages.rows, answers.rows, moves.rows),
  }
}

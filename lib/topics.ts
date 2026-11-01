/**
 * Topics inside one customer thread, kept free of database and HTTP code.
 *
 * The customer stays the thread, with one owner, so two of us still never
 * reply to the same customer. But a customer often has several things going
 * at once — an invoice question and an outage — and one "answered" for the
 * whole customer closed both. So "answered" is recorded **per topic**.
 *
 * A **topic** is a reply chain: a message that answers nothing plus every
 * message hanging off it through `requests.in_reply_to` (the same chains the
 * thread screen draws as blocks, see lib/thread.ts). A message without a link
 * — "Any update?" — starts its own topic until a colleague moves it into the
 * topic it belongs to. Never automatically from the text: the text is
 * untrusted customer input, and a wrong guess could quietly hide a request.
 *
 * A topic is answered when its answer covers its newest message. When the
 * customer writes in it again, it is open again, and only the new messages
 * count as unanswered. A message moved into a topic by hand counts as
 * unanswered until the topic is answered *after* the move — otherwise moving
 * an open request into an answered topic would quietly hide it. Like the rest of the app, "newer" between two messages
 * of one customer means a higher `requests.id`.
 */
import { parentLinks } from './thread.ts'

/** The columns of the read-only `requests` table that topics need. */
export type TopicMessageRow = {
  id: number
  received_at: Date
  in_reply_to: number | null
}

/** One row of our own `topic_answers` table. */
export type TopicAnswerRow = {
  topic_id: number
  latest_message_id: number
  answered_by: string
  answered_at: Date
}

/** One row of our own `message_topics` table: a move made by hand. */
export type TopicAssignmentRow = {
  message_id: number
  topic_id: number
  assigned_at: Date
}

export type Topic = {
  /** `requests.id` of the topic's first message; the topic key. */
  topicId: number
  /** Every message of the topic, newest first. */
  messageIds: number[]
  newestMessageId: number
  lastMessageAt: string
  status: 'open' | 'answered'
  /** Who answered last, kept even after the customer wrote again. */
  answeredBy: string | null
  answeredAt: string | null
  /** Messages since the last answer: how many times the customer is waiting. */
  unansweredCount: number
  /** Arrival of the oldest unanswered message, or `null` when answered. */
  waitingSince: string | null
}

/** What the inbox list shows about a customer's topics. */
export type TopicWork = {
  topicCount: number
  openTopicCount: number
  unansweredCount: number
  /** Arrival of the oldest unanswered message in any topic. */
  waitingSince: string | null
}

export const NO_WORK: TopicWork = {
  topicCount: 0,
  openTopicCount: 0,
  unansweredCount: 0,
  waitingSince: null,
}

type Item = { id: number; inReplyTo: number | null; at: string }

/** Newer is a later time, or the same time and a higher id. */
function isNewer(a: Item, b: Item): boolean {
  return a.at === b.at ? a.id > b.id : a.at > b.at
}

/** The hand-made moves of one thread, as `parentLinks` wants them. */
export function assignmentMap(rows: readonly TopicAssignmentRow[]): Map<number, number> {
  return new Map(rows.map((row) => [row.message_id, row.topic_id]))
}

/**
 * Split one customer's messages into topics, newest topic first.
 *
 * Uses exactly the links the thread screen uses, so a topic is always one
 * block on that screen. Answers for a topic id that is no longer a topic (its
 * first message was moved into another one) are ignored, not lost: undoing
 * the move brings them back.
 */
export function toTopics(
  rows: readonly TopicMessageRow[],
  answers: readonly TopicAnswerRow[],
  moves: readonly TopicAssignmentRow[] = [],
): Topic[] {
  const assigned = assignmentMap(moves)
  const movedAt = new Map(moves.map((move) => [move.message_id, new Date(move.assigned_at)]))
  const items: Item[] = rows.map((row) => ({
    id: row.id,
    inReplyTo: row.in_reply_to,
    at: new Date(row.received_at).toISOString(),
  }))
  const parentOf = parentLinks(items, assigned)

  // parentLinks has already broken every loop, so walking up always ends.
  const rootOf = (id: number): number => {
    let at = id
    for (let up = parentOf.get(at); up !== undefined; up = parentOf.get(at)) at = up
    return at
  }

  const groups = new Map<number, Item[]>()
  for (const item of items) {
    const root = rootOf(item.id)
    const group = groups.get(root)
    if (group) group.push(item)
    else groups.set(root, [item])
  }

  const answerOf = new Map(answers.map((answer) => [answer.topic_id, answer]))
  const topics: Topic[] = []
  for (const [topicId, group] of groups) {
    group.sort((a, b) => (isNewer(a, b) ? -1 : 1))
    const newest = group[0]
    const answer = answerOf.get(topicId)
    const covered = (m: Item): boolean => {
      if (!answer || m.id > answer.latest_message_id) return false
      const moved = movedAt.get(m.id)
      return !moved || moved <= new Date(answer.answered_at)
    }
    const unanswered = group.filter((m) => !covered(m))
    topics.push({
      topicId,
      messageIds: group.map((m) => m.id),
      newestMessageId: newest.id,
      lastMessageAt: newest.at,
      status: unanswered.length === 0 ? 'answered' : 'open',
      answeredBy: answer?.answered_by ?? null,
      answeredAt: answer ? new Date(answer.answered_at).toISOString() : null,
      unansweredCount: unanswered.length,
      waitingSince: unanswered.length > 0 ? unanswered[unanswered.length - 1].at : null,
    })
  }

  return topics.sort((a, b) =>
    a.lastMessageAt === b.lastMessageAt
      ? b.newestMessageId - a.newestMessageId
      : a.lastMessageAt > b.lastMessageAt
        ? -1
        : 1,
  )
}

/** Fold one customer's topics into the few numbers the list shows. */
export function topicWork(topics: readonly Topic[]): TopicWork {
  let waitingSince: string | null = null
  let unansweredCount = 0
  let openTopicCount = 0
  for (const topic of topics) {
    if (topic.status !== 'open') continue
    openTopicCount += 1
    unansweredCount += topic.unansweredCount
    if (topic.waitingSince && (!waitingSince || topic.waitingSince < waitingSince)) {
      waitingSince = topic.waitingSince
    }
  }
  return { topicCount: topics.length, openTopicCount, unansweredCount, waitingSince }
}

/**
 * The list numbers for every customer at once, keyed by thread id (the
 * customer's first message). Answers and moves of other customers can be
 * passed in too: a topic or message id that is not this customer's never
 * matches, so nothing leaks from one customer into another.
 */
export function workByThread(
  rows: readonly (TopicMessageRow & { customer: string })[],
  answers: readonly TopicAnswerRow[],
  moves: readonly TopicAssignmentRow[] = [],
): Map<number, TopicWork> {
  const byCustomer = new Map<string, (TopicMessageRow & { customer: string })[]>()
  for (const row of rows) {
    const group = byCustomer.get(row.customer)
    if (group) group.push(row)
    else byCustomer.set(row.customer, [row])
  }

  const work = new Map<number, TopicWork>()
  for (const group of byCustomer.values()) {
    const threadId = Math.min(...group.map((row) => row.id))
    work.set(threadId, topicWork(toTopics(group, answers, moves)))
  }
  return work
}

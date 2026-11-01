/**
 * The conversation timeline: all of one customer's messages on email, chat and
 * call in the order a teammate reads them. Kept free of database and HTTP code
 * so it can be tested alone.
 *
 * **Newest message first.** The reply you have to answer is the first thing on
 * the screen, instead of four weeks of history above it (FRICTION.md, 14:44).
 *
 * ## How a reply chain appears
 *
 * `requests.in_reply_to` says which message a message answers. A *chain* is a
 * message that answers nothing plus everything hanging off it, however deep.
 * The rule, in three lines:
 *
 * 1. A chain stays in one block — no other message is ever shown inside it.
 * 2. Chains come newest first, judged by the newest message in the chain.
 * 3. Inside a chain a message always stands above the message it answers;
 *    where two messages answer the same one, the newer stands first.
 *
 * So the message a reply answers is always further down in the same block —
 * the thread screen points at it by name and time, so the reader never has to
 * guess what answers what. The newest message of the whole conversation is the
 * top one as long as no reply is older than the message it answers, which is
 * true of all 76 replies in the sample data. Equal timestamps are broken by the
 * higher id, as everywhere else in the app.
 *
 * Plain time order, newest first, was the alternative and was rejected: in the
 * sample data only 24 of the 76 replies follow the message they answer
 * directly in time, and up to nine other messages can sit in between, so a
 * question and its answer ended up far apart on the screen.
 */

/** The columns of the read-only `requests` table that one thread needs. */
export type TimelineRow = {
  id: number
  channel: string
  received_at: Date
  contact_name: string | null
  subject: string | null
  body: string
  in_reply_to: number | null
}

/** One message as the thread screen shows it. */
export type TimelineMessage = {
  id: number
  channel: string
  receivedAt: string
  contactName: string | null
  subject: string | null
  /** Untrusted customer text, passed through unchanged and shown as text. */
  body: string
  /** `requests.id` of the message this one answers, or `null`. */
  inReplyTo: number | null
  /**
   * The link the timeline actually used: the same as `inReplyTo` unless that
   * link had to be dropped (points outside the thread, at itself, or into a
   * loop). The screen must use this one, never `inReplyTo`, or it can claim a
   * message answers something that is not below it.
   */
  answersId: number | null
  /**
   * `requests.id` of the topic a colleague moved this message into by hand,
   * or `null`. Only messages without their own reply link can be moved, so
   * this and `inReplyTo` are never both set.
   */
  assignedTo: number | null
}

/** What a reply link is worked out from: the message and what it answers. */
export type Linkable = { id: number; inReplyTo: number | null }

/** Newer is a later time, or the same time and a higher id. */
function isNewer(a: TimelineMessage, b: TimelineMessage): boolean {
  return a.receivedAt === b.receivedAt ? a.id > b.id : a.receivedAt > b.receivedAt
}

function toMessage(row: TimelineRow): TimelineMessage {
  return {
    id: row.id,
    channel: row.channel,
    receivedAt: new Date(row.received_at).toISOString(),
    contactName: row.contact_name?.trim() || null,
    subject: row.subject?.trim() || null,
    body: row.body,
    inReplyTo: row.in_reply_to,
    answersId: null,
    assignedTo: null,
  }
}

/**
 * Which message each message answers, counting only links we can follow.
 *
 * `assigned` holds the topics colleagues picked by hand (message id → topic
 * id). It only counts for a message that has no reply link of its own: the
 * customer's own link always wins over our guess.
 *
 * A link is dropped when it points at a message that is not in this thread, at
 * the message itself, or back into a loop — the row is then its own chain, so
 * a strange link can hide nothing and cannot make the walk below spin.
 */
export function parentLinks(
  messages: readonly Linkable[],
  assigned: ReadonlyMap<number, number> = new Map(),
): Map<number, number> {
  const byId = new Map(messages.map((m) => [m.id, m]))
  const parentOf = new Map<number, number>()

  for (const message of messages) {
    const link = message.inReplyTo ?? assigned.get(message.id) ?? null
    const parent = link === null ? undefined : byId.get(link)
    if (parent && parent.id !== message.id) parentOf.set(message.id, parent.id)
  }

  for (const message of messages) {
    const seen = new Set([message.id])
    for (let up = parentOf.get(message.id); up !== undefined; up = parentOf.get(up)) {
      if (seen.has(up)) {
        parentOf.delete(message.id)
        break
      }
      seen.add(up)
    }
  }
  return parentOf
}

/**
 * Put one customer's messages in reading order: newest first, replies kept
 * with the message they answer (see the rule at the top of this file). A
 * message a colleague moved into a topic by hand counts as a reply to that
 * topic's first message, so it stands in the same block.
 *
 * The result never depends on the order the rows arrive in, so it cannot drift
 * when Postgres returns an unsorted scan — with one exception: if two messages
 * answered each other, the loop is broken at whichever of them is read first.
 * No message is ever lost or shown twice, and the walk cannot spin.
 */
export function toTimeline(
  rows: readonly TimelineRow[],
  assigned: ReadonlyMap<number, number> = new Map(),
): TimelineMessage[] {
  const messages = rows.map(toMessage)
  const parentOf = parentLinks(messages, assigned)
  for (const message of messages) {
    message.answersId = parentOf.get(message.id) ?? null
    // Only claim a hand-made move when the timeline really used it.
    if (message.inReplyTo === null && message.answersId !== null) {
      message.assignedTo = message.answersId
    }
  }

  const children = new Map<number, TimelineMessage[]>()
  const roots: TimelineMessage[] = []
  for (const message of messages) {
    const parent = parentOf.get(message.id)
    if (parent === undefined) {
      roots.push(message)
      continue
    }
    const siblings = children.get(parent)
    if (siblings) siblings.push(message)
    else children.set(parent, [message])
  }

  /** The newest message in a chain, which is what the chain is ranked by. */
  const newestIn = new Map<number, TimelineMessage>()
  function newest(message: TimelineMessage): TimelineMessage {
    const known = newestIn.get(message.id)
    if (known) return known
    let best = message
    for (const child of children.get(message.id) ?? []) {
      const childBest = newest(child)
      if (isNewer(childBest, best)) best = childBest
    }
    newestIn.set(message.id, best)
    return best
  }

  const newestFirst = (a: TimelineMessage, b: TimelineMessage) =>
    isNewer(newest(a), newest(b)) ? -1 : 1

  // Each message is written out after everything that answers it, so a reply
  // always stands above the message it answers.
  const timeline: TimelineMessage[] = []
  function write(message: TimelineMessage): void {
    for (const child of [...(children.get(message.id) ?? [])].sort(newestFirst)) write(child)
    timeline.push(message)
  }

  for (const root of [...roots].sort(newestFirst)) write(root)
  return timeline
}

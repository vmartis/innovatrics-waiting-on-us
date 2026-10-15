/**
 * Thread logic, kept free of database and HTTP code so it can be tested alone.
 *
 * A "thread" here is one customer: every message that customer sent on any
 * channel belongs to the same conversation (see PRODUCT_NOTE.md).
 *
 * The thread is identified by `threadId` — the lowest `requests.id` the
 * customer has, i.e. their first message. That id is stable and is not
 * personal data, so it can sit in a URL; the company name never has to.
 */

/** The columns of the read-only `requests` table that the list needs. */
export type RequestRow = {
  id: number
  customer: string
  contact_name: string | null
  channel: string
  received_at: Date
}

/** What the inbox list needs to show one line per customer. */
export type ThreadSummary = {
  /** `requests.id` of the customer's first message; the thread key. */
  threadId: number
  customer: string
  contactName: string | null
  messageCount: number
  channels: string[]
  lastMessageAt: string
  lastChannel: string
  /** `requests.id` of the newest message; what a claim points at. */
  latestMessageId: number
}

const CHANNEL_ORDER = ['email', 'chat', 'call']

function byChannelOrder(a: string, b: string): number {
  const ia = CHANNEL_ORDER.indexOf(a)
  const ib = CHANNEL_ORDER.indexOf(b)
  return (ia < 0 ? CHANNEL_ORDER.length : ia) - (ib < 0 ? CHANNEL_ORDER.length : ib)
}

/** True when (time, id) of `row` is after the newest seen so far. */
function isNewer(at: string, id: number, bestAt: string, bestId: number): boolean {
  return at > bestAt || (at === bestAt && id > bestId)
}

/**
 * Fold raw request rows into one summary per customer, newest thread first.
 *
 * The result never depends on the order the rows arrive in, so it cannot drift
 * when Postgres returns an unsorted scan. Message bodies and subjects are not
 * part of a summary: the list does not show them.
 */
export function toThreadSummaries(rows: readonly RequestRow[]): ThreadSummary[] {
  /** Per customer: the summary plus the time/id of the newest named contact. */
  const acc = new Map<string, { summary: ThreadSummary; contactAt: string; contactId: number }>()

  for (const row of rows) {
    const receivedAt = new Date(row.received_at).toISOString()
    const contactName = row.contact_name?.trim() || null
    const entry = acc.get(row.customer)

    if (!entry) {
      acc.set(row.customer, {
        summary: {
          threadId: row.id,
          customer: row.customer,
          contactName,
          messageCount: 1,
          channels: [row.channel],
          lastMessageAt: receivedAt,
          lastChannel: row.channel,
          latestMessageId: row.id,
        },
        contactAt: contactName ? receivedAt : '',
        contactId: contactName ? row.id : -1,
      })
      continue
    }

    const { summary } = entry
    summary.messageCount += 1
    if (!summary.channels.includes(row.channel)) summary.channels.push(row.channel)
    // The first message of the customer gives the thread its id.
    if (row.id < summary.threadId) summary.threadId = row.id

    if (isNewer(receivedAt, row.id, summary.lastMessageAt, summary.latestMessageId)) {
      summary.lastMessageAt = receivedAt
      summary.lastChannel = row.channel
      summary.latestMessageId = row.id
    }
    // Show the contact person from the newest message that names one; many
    // rows leave the field empty.
    if (contactName && isNewer(receivedAt, row.id, entry.contactAt, entry.contactId)) {
      summary.contactName = contactName
      entry.contactAt = receivedAt
      entry.contactId = row.id
    }
  }

  const summaries = [...acc.values()].map((entry) => entry.summary)
  for (const summary of summaries) summary.channels.sort(byChannelOrder)
  summaries.sort((a, b) =>
    a.lastMessageAt === b.lastMessageAt
      ? a.threadId - b.threadId
      : a.lastMessageAt < b.lastMessageAt
        ? 1
        : -1,
  )
  return summaries
}

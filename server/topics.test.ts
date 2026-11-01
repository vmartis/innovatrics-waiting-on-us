import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from './app.ts'
import { applySchema, pool } from './db.ts'
import { TEAM } from '../lib/team.ts'
import type { Topic } from '../lib/topics.ts'
import type { ThreadState } from '../lib/waiting.ts'

// Tests empty our own tables, so they must never run against the schema the
// deployed app uses. `npm test` sets APP_SCHEMA; a bare `node --test` stops here.
assert.notEqual(
  process.env.APP_SCHEMA ?? 'public',
  'public',
  'run the tests with `npm test` so they use their own schema',
)
await applySchema()

const server = createApp().listen(0)
const { port } = server.address() as AddressInfo
const base = `http://127.0.0.1:${port}`

const [ALEX, PRIYA] = TEAM
const CLEAR = 'DELETE FROM thread_claims; DELETE FROM topic_answers; DELETE FROM message_topics'

after(async () => {
  await pool.query(CLEAR)
  server.close()
  await pool.end()
})

// Our own tables only; the sample table `requests` is never written to.
beforeEach(async () => {
  await pool.query(CLEAR)
})

type Answer = { status: number; body: { error?: string; state?: ThreadState; topics?: Topic[] } }

async function post(path: string, body: unknown): Promise<Answer> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Answer['body'] }
}

type Detail = {
  thread: ThreadState & { openTopicCount: number; unansweredCount: number }
  messages: { id: number; inReplyTo: number | null; assignedTo: number | null }[]
  topics: Topic[]
}

async function detail(threadId: number): Promise<Detail> {
  const res = await fetch(`${base}/api/threads/${threadId}`)
  assert.equal(res.status, 200)
  return (await res.json()) as Detail
}

type ListItem = {
  threadId: number
  status: string
  topicCount: number
  openTopicCount: number
  unansweredCount: number
  messageCount: number
  waitingSince: string | null
  lastMessageAt: string
}

async function waitingList(): Promise<ListItem[]> {
  const res = await fetch(`${base}/api/threads`)
  return ((await res.json()) as { threads: ListItem[] }).threads
}

/**
 * A real customer with several topics and at least one message without a
 * reply link that is not the first of its customer — the case topics exist
 * for. Taken from the data, because which ids those are can shift.
 */
async function busyThreadId(): Promise<number> {
  const found = await pool.query<{ thread_id: number }>(
    `SELECT min(id) AS thread_id
       FROM requests
      GROUP BY customer
     HAVING count(*) FILTER (WHERE in_reply_to IS NULL) >= 3
        AND count(in_reply_to) >= 1
      ORDER BY min(id)
      LIMIT 1`,
  )
  assert.ok(found.rows[0], 'the sample data has a customer with several topics')
  return found.rows[0].thread_id
}

async function claimed(threadId: number, person = ALEX): Promise<Detail> {
  const claim = await post(`/api/threads/${threadId}/claim`, { person })
  assert.equal(claim.status, 200)
  return await detail(threadId)
}

function answerTopic(threadId: number, topic: Topic, person = ALEX): Promise<Answer> {
  return post(`/api/threads/${threadId}/topics/${topic.topicId}/answered`, {
    person,
    seenMessageId: topic.newestMessageId,
  })
}

test('a thread is split into topics, and every message sits in exactly one', async () => {
  const threadId = await busyThreadId()
  const { messages, topics, thread } = await detail(threadId)

  const inTopics = topics.flatMap((t) => t.messageIds).sort((a, b) => a - b)
  const all = messages.map((m) => m.id).sort((a, b) => a - b)
  assert.deepEqual(inTopics, all)
  assert.ok(topics.length >= 3)
  assert.equal(thread.openTopicCount, topics.length, 'nothing answered yet')
  assert.equal(thread.unansweredCount, messages.length)
})

test('answering one topic keeps the customer waiting, with one open topic fewer', async () => {
  const threadId = await busyThreadId()
  const { topics } = await claimed(threadId)

  const answered = await answerTopic(threadId, topics[0])
  assert.equal(answered.status, 200)
  assert.equal(answered.body.state?.status, 'claimed', 'still yours, still waiting')
  assert.equal(answered.body.topics?.find((t) => t.topicId === topics[0].topicId)?.status, 'answered')

  const line = (await waitingList()).find((t) => t.threadId === threadId)
  assert.equal(line?.openTopicCount, topics.length - 1)
  assert.equal(line?.topicCount, topics.length)
})

test('answering the last open topic answers the whole thread', async () => {
  const threadId = await busyThreadId()
  const { topics } = await claimed(threadId)

  let last: Answer | undefined
  for (const topic of topics) last = await answerTopic(threadId, topic)
  assert.equal(last?.body.state?.status, 'answered')
  assert.equal(last?.body.state?.answeredBy, ALEX)
  assert.equal(
    (await waitingList()).some((t) => t.threadId === threadId),
    false,
    'it left the waiting list',
  )
})

test('a topic can only be answered by the person holding the thread', async () => {
  const threadId = await busyThreadId()
  const { topics } = await detail(threadId)

  const unclaimed = await answerTopic(threadId, topics[0])
  assert.equal(unclaimed.status, 409)
  assert.match(unclaimed.body.error ?? '', /claim this thread first/)

  await claimed(threadId, ALEX)
  const notMine = await answerTopic(threadId, topics[0], PRIYA)
  assert.equal(notMine.status, 409)
  assert.match(notMine.body.error ?? '', /Alex Moore is taking care of this one now/)

  const stored = await pool.query('SELECT 1 FROM topic_answers')
  assert.equal(stored.rowCount, 0, 'nothing was stored')
})

test('a topic the customer wrote in since you looked cannot be marked answered', async () => {
  const threadId = await busyThreadId()
  const { topics } = await claimed(threadId)
  const topic = topics[0]

  for (const seenMessageId of [topic.newestMessageId - 1, undefined, '1', null]) {
    const stale = await post(`/api/threads/${threadId}/topics/${topic.topicId}/answered`, {
      person: ALEX,
      seenMessageId,
    })
    assert.equal(stale.status, 409, `refused: ${JSON.stringify(seenMessageId)}`)
    assert.match(stale.body.error ?? '', /written again in this topic/)
  }
})

test('an unknown topic or a topic of another customer is refused', async () => {
  const threadId = await busyThreadId()
  await claimed(threadId)
  const other = await pool.query<{ id: number }>(
    `SELECT id FROM requests
      WHERE customer <> (SELECT customer FROM requests WHERE id = $1)
      ORDER BY id LIMIT 1`,
    [threadId],
  )

  for (const topicId of [String(other.rows[0].id), '99999999', 'abc', '0']) {
    const answer = await post(`/api/threads/${threadId}/topics/${topicId}/answered`, {
      person: ALEX,
      seenMessageId: 1,
    })
    assert.equal(answer.status, 404, `refused: ${topicId}`)
  }
})

test('you can undo your own topic answer, and a thread it had closed comes back as yours', async () => {
  const threadId = await busyThreadId()
  const { topics } = await claimed(threadId)
  for (const topic of topics) await answerTopic(threadId, topic)

  const someoneElse = await post(`/api/threads/${threadId}/topics/${topics[0].topicId}/reopen`, {
    person: PRIYA,
  })
  assert.equal(someoneElse.status, 409)

  const undone = await post(`/api/threads/${threadId}/topics/${topics[0].topicId}/reopen`, {
    person: ALEX,
  })
  assert.equal(undone.status, 200)
  assert.equal(undone.body.state?.status, 'claimed')
  assert.equal(undone.body.state?.claimedBy, ALEX)
  assert.equal(undone.body.topics?.find((t) => t.topicId === topics[0].topicId)?.status, 'open')

  const line = (await waitingList()).find((t) => t.threadId === threadId)
  assert.equal(line?.openTopicCount, 1, 'back on the waiting list with one open topic')
})

test('marking the whole thread answered closes every topic, and undoing it opens them again', async () => {
  const threadId = await busyThreadId()
  const { topics } = await claimed(threadId)
  await answerTopic(threadId, topics[0])

  const all = await post(`/api/threads/${threadId}/answered`, { person: ALEX })
  assert.equal(all.status, 200)
  assert.ok((await detail(threadId)).topics.every((t) => t.status === 'answered'))

  const undone = await post(`/api/threads/${threadId}/reopen`, { person: ALEX })
  assert.equal(undone.status, 200)
  const after = await detail(threadId)
  assert.equal(after.thread.status, 'claimed')
  // Only what the thread mark closed is taken back; the earlier topic answer stays.
  assert.equal(after.topics.find((t) => t.topicId === topics[0].topicId)?.status, 'answered')
  assert.equal(after.thread.openTopicCount, topics.length - 1)
})

test('a message without a reply link can be moved into another topic, and back', async () => {
  const threadId = await busyThreadId()
  const { topics, messages } = await claimed(threadId)
  // A topic made of one unlinked message, moved into the newest other topic.
  const loose = topics.find((t) => t.messageIds.length === 1 && t.topicId !== topics[0].topicId)
  assert.ok(loose, 'the sample customer has a one-message topic')
  const target = topics[0]
  assert.equal(messages.find((m) => m.id === loose.topicId)?.inReplyTo, null)

  const moved = await post(`/api/threads/${threadId}/messages/${loose.topicId}/topic`, {
    person: ALEX,
    topicId: target.topicId,
  })
  assert.equal(moved.status, 200)
  assert.equal(moved.body.topics?.length, topics.length - 1)
  assert.ok(moved.body.topics?.find((t) => t.topicId === target.topicId)?.messageIds.includes(loose.topicId))
  const shown = (await detail(threadId)).messages.find((m) => m.id === loose.topicId)
  assert.equal(shown?.assignedTo, target.topicId, 'the thread screen says it was moved by hand')

  const back = await post(`/api/threads/${threadId}/messages/${loose.topicId}/topic`, {
    person: ALEX,
    topicId: null,
  })
  assert.equal(back.status, 200)
  assert.equal(back.body.topics?.length, topics.length)
})

test('moving is refused for linked messages, into its own topic, and without the claim', async () => {
  const threadId = await busyThreadId()
  const { topics, messages } = await detail(threadId)
  const loose = topics.find((t) => t.messageIds.length === 1 && t.topicId !== topics[0].topicId)
  assert.ok(loose)
  const moveLoose = (person: string, topicId: unknown) =>
    post(`/api/threads/${threadId}/messages/${loose.topicId}/topic`, { person, topicId })

  assert.equal((await moveLoose(ALEX, topics[0].topicId)).status, 409, 'nobody holds the thread')

  await claimed(threadId)
  assert.equal((await moveLoose(PRIYA, topics[0].topicId)).status, 409, 'not the holder')
  assert.equal((await moveLoose(ALEX, loose.topicId)).status, 409, 'into its own topic')
  assert.equal((await moveLoose(ALEX, 99999999)).status, 409, 'into no topic at all')
  assert.equal((await moveLoose(ALEX, 'abc')).status, 400)

  const linked = messages.find((m) => m.inReplyTo !== null)
  assert.ok(linked)
  const refused = await post(`/api/threads/${threadId}/messages/${linked.id}/topic`, {
    person: ALEX,
    topicId: loose.topicId,
  })
  assert.equal(refused.status, 409)
  assert.match(refused.body.error ?? '', /answers another one/)

  const stored = await pool.query('SELECT 1 FROM message_topics')
  assert.equal(stored.rowCount, 0, 'nothing was stored')
})

test('the list waits from the oldest unanswered message, not the newest one', async () => {
  const threadId = await busyThreadId()
  const before = (await waitingList()).find((t) => t.threadId === threadId)
  assert.ok(before?.waitingSince)
  assert.ok(before.waitingSince < before.lastMessageAt, 'older than the newest message')
  assert.equal(before.unansweredCount, before.messageCount, 'nothing answered yet')

  // Answer the topic that holds the oldest message: the wait now starts later.
  const { topics } = await claimed(threadId)
  const oldest = topics.find((t) => t.waitingSince === before.waitingSince)
  assert.ok(oldest)
  await answerTopic(threadId, oldest)

  const after = (await waitingList()).find((t) => t.threadId === threadId)
  assert.ok(after?.waitingSince && after.waitingSince > before.waitingSince)
  assert.equal(after.unansweredCount, before.unansweredCount - oldest.unansweredCount)
})

test('topic changes never write to the sample data', async () => {
  const count = async () =>
    (await pool.query<{ n: string }>('SELECT count(*) AS n FROM requests')).rows[0].n
  const before = await count()
  const threadId = await busyThreadId()
  const { topics } = await claimed(threadId)
  await answerTopic(threadId, topics[0])
  await post(`/api/threads/${threadId}/topics/${topics[0].topicId}/reopen`, { person: ALEX })
  await post(`/api/threads/${threadId}/messages/${topics[1].topicId}/topic`, {
    person: ALEX,
    topicId: topics[0].topicId,
  })

  assert.equal(await count(), before)
})

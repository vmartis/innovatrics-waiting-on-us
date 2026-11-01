import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assignmentMap,
  toTopics,
  topicWork,
  workByThread,
  type TopicAnswerRow,
  type TopicMessageRow,
} from './topics.ts'

function msg(id: number, day: number, inReplyTo: number | null = null): TopicMessageRow {
  return {
    id,
    received_at: new Date(`2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`),
    in_reply_to: inReplyTo,
  }
}

function answer(topicId: number, latest: number, by = 'Alex Moore'): TopicAnswerRow {
  return {
    topic_id: topicId,
    latest_message_id: latest,
    answered_by: by,
    answered_at: new Date('2026-10-20T12:00:00.000Z'),
  }
}

// Two things going at once: an invoice question (1 → 3) and an outage (2 → 4).
const TWO_TOPICS = [msg(1, 1), msg(2, 2), msg(3, 3, 1), msg(4, 4, 2)]

test('each reply chain is its own topic, newest topic first', () => {
  const topics = toTopics(TWO_TOPICS, [])

  assert.deepEqual(
    topics.map((t) => [t.topicId, t.messageIds]),
    [
      [2, [4, 2]],
      [1, [3, 1]],
    ],
  )
  assert.ok(topics.every((t) => t.status === 'open'))
})

test('answering one topic leaves the other one open', () => {
  const topics = toTopics(TWO_TOPICS, [answer(1, 3)])
  const byId = new Map(topics.map((t) => [t.topicId, t]))

  assert.equal(byId.get(1)?.status, 'answered')
  assert.equal(byId.get(1)?.answeredBy, 'Alex Moore')
  assert.equal(byId.get(1)?.unansweredCount, 0)
  assert.equal(byId.get(1)?.waitingSince, null)
  assert.equal(byId.get(2)?.status, 'open')
})

test('a new message in an answered topic opens it again, counting only the new one', () => {
  const rows = [...TWO_TOPICS, msg(5, 9, 3)]
  const invoice = toTopics(rows, [answer(1, 3)]).find((t) => t.topicId === 1)

  assert.equal(invoice?.status, 'open')
  assert.equal(invoice?.unansweredCount, 1)
  assert.equal(invoice?.waitingSince, '2026-10-09T10:00:00.000Z')
  assert.equal(invoice?.answeredBy, 'Alex Moore', 'who answered last stays visible')
})

test('a customer who chases three times has three unanswered messages, waiting since the first', () => {
  const rows = [msg(1, 1), msg(2, 5, 1), msg(3, 6, 1), msg(4, 7, 3)]
  const [topic] = toTopics(rows, [answer(1, 1)])

  assert.equal(topic.unansweredCount, 3)
  assert.equal(topic.waitingSince, '2026-10-05T10:00:00.000Z')
})

test('a message without a link starts its own topic until it is moved by hand', () => {
  // 5 is "Any update?" without a link; it really belongs to the outage.
  const rows = [...TWO_TOPICS, msg(5, 8)]
  assert.equal(toTopics(rows, []).length, 3)

  const moved = toTopics(rows, [], assignmentMap([{ message_id: 5, topic_id: 2 }]))
  assert.equal(moved.length, 2)
  assert.deepEqual(moved.find((t) => t.topicId === 2)?.messageIds, [5, 4, 2])
})

test('the customer own reply link always wins over a hand-made move', () => {
  const topics = toTopics(TWO_TOPICS, [], assignmentMap([{ message_id: 3, topic_id: 2 }]))
  assert.deepEqual(topics.find((t) => t.topicId === 1)?.messageIds, [3, 1])
})

test('moves that point outside the customer or into a loop are ignored, nothing is lost', () => {
  const rows = [msg(1, 1), msg(2, 2)]
  const loop = assignmentMap([
    { message_id: 1, topic_id: 2 },
    { message_id: 2, topic_id: 1 },
    { message_id: 1, topic_id: 999 },
  ])
  const topics = toTopics(rows, [], loop)

  const all = topics.flatMap((t) => t.messageIds).sort()
  assert.deepEqual(all, [1, 2])
})

test('the list numbers add up the open topics and start at the oldest unanswered message', () => {
  const rows = [...TWO_TOPICS, msg(5, 9, 3)]
  const work = topicWork(toTopics(rows, [answer(1, 3), answer(2, 4)]))

  assert.deepEqual(work, {
    topicCount: 2,
    openTopicCount: 1,
    unansweredCount: 1,
    waitingSince: '2026-10-09T10:00:00.000Z',
  })
})

test('with nothing answered the wait starts at the oldest message of any topic', () => {
  const work = topicWork(toTopics(TWO_TOPICS, []))
  assert.equal(work.waitingSince, '2026-10-01T10:00:00.000Z')
  assert.equal(work.unansweredCount, 4)
})

test('every customer gets its own numbers, keyed by the first message id', () => {
  const rows = [
    { ...msg(10, 1), customer: 'Acme' },
    { ...msg(11, 2, 10), customer: 'Acme' },
    { ...msg(12, 3), customer: 'Bolt' },
  ]
  const work = workByThread(rows, [answer(10, 11)])

  assert.equal(work.get(10)?.openTopicCount, 0)
  assert.equal(work.get(12)?.openTopicCount, 1)
  assert.equal(work.size, 2)
})

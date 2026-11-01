import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asThreadView,
  forView,
  onlyMine,
  isWaitingOnUs,
  threadState,
  waitingSince,
  withState,
  type ClaimRow,
} from './waiting.ts'
import type { ThreadSummary } from './threads.ts'
import type { TopicWork } from './topics.ts'

function claim(partial: Partial<ClaimRow> = {}): ClaimRow {
  return {
    thread_id: 1,
    latest_message_id: 50,
    claimed_by: null,
    claimed_at: null,
    answered_by: null,
    answered_at: null,
    ...partial,
  }
}

function summary(partial: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    threadId: 1,
    customer: 'Acme',
    contactName: null,
    messageCount: 2,
    channels: ['email'],
    lastMessageAt: '2026-10-10T10:00:00.000Z',
    lastChannel: 'email',
    latestMessageId: 50,
    ...partial,
  }
}

test('a thread nobody touched is waiting on us', () => {
  const state = threadState(50, undefined)
  assert.equal(state.status, 'waiting')
  assert.equal(state.claimedBy, null)
  assert.equal(isWaitingOnUs(state), true)
})

test('a claimed thread is still waiting, but carries the owner name', () => {
  const state = threadState(
    50,
    claim({ claimed_by: 'Alex Moore', claimed_at: new Date('2026-10-10T11:00:00Z') }),
  )

  assert.equal(state.status, 'claimed')
  assert.equal(state.claimedBy, 'Alex Moore')
  assert.equal(state.claimedAt, '2026-10-10T11:00:00.000Z')
  assert.equal(isWaitingOnUs(state), true)
})

test('an answered thread is not waiting and shows who answered', () => {
  const state = threadState(
    50,
    claim({
      claimed_by: 'Alex Moore',
      answered_by: 'Alex Moore',
      answered_at: new Date('2026-10-10T12:00:00Z'),
    }),
  )

  assert.equal(state.status, 'answered')
  assert.equal(state.answeredBy, 'Alex Moore')
  assert.equal(state.answeredAt, '2026-10-10T12:00:00.000Z')
  assert.equal(isWaitingOnUs(state), false)
})

test('a new customer message makes an answered thread wait again', () => {
  const answered = claim({
    latest_message_id: 50,
    claimed_by: 'Alex Moore',
    answered_by: 'Alex Moore',
    answered_at: new Date('2026-10-10T12:00:00Z'),
  })

  // The customer came back: message 77 arrived after we answered message 50.
  const state = threadState(77, answered)

  assert.equal(state.status, 'waiting')
  assert.equal(state.claimedBy, null, 'the finished claim no longer counts')
  assert.equal(state.answeredBy, null)
  assert.equal(isWaitingOnUs(state), true)
})

test('a new customer message does NOT free a claim nobody finished', () => {
  // Alex is mid-reply when the customer writes again. The thread stays Alex's,
  // otherwise a colleague could start the same reply.
  const state = threadState(77, claim({ latest_message_id: 50, claimed_by: 'Alex Moore' }))

  assert.equal(state.status, 'claimed')
  assert.equal(state.claimedBy, 'Alex Moore')
})

test('a row with no names left on it counts as waiting', () => {
  assert.equal(threadState(50, claim()).status, 'waiting')
})

test('withState joins each thread with its own row and leaves the rest waiting', () => {
  const items = withState(
    [
      summary({ threadId: 1, latestMessageId: 50 }),
      summary({ threadId: 2, latestMessageId: 60, customer: 'Globex' }),
      summary({ threadId: 3, latestMessageId: 70, customer: 'Initech' }),
    ],
    [
      claim({ thread_id: 2, latest_message_id: 60, claimed_by: 'Priya Shah' }),
      claim({
        thread_id: 3,
        latest_message_id: 70,
        claimed_by: 'Tom Becker',
        answered_by: 'Tom Becker',
        answered_at: new Date('2026-10-11T09:00:00Z'),
      }),
    ],
  )

  assert.deepEqual(
    items.map((i) => [i.customer, i.status, i.claimedBy]),
    [
      ['Acme', 'waiting', null],
      ['Globex', 'claimed', 'Priya Shah'],
      ['Initech', 'answered', 'Tom Becker'],
    ],
  )
  assert.deepEqual(
    items.filter((i) => isWaitingOnUs(i)).map((i) => i.customer),
    ['Acme', 'Globex'],
  )
})

test('a row for an unknown thread is ignored, not crashed on', () => {
  const items = withState([summary({ threadId: 1 })], [claim({ thread_id: 999 })])
  assert.equal(items.length, 1)
  assert.equal(items[0].status, 'waiting')
})

test('the waiting list shows everything that still needs a reply', () => {
  const items = withState(
    [
      summary({ threadId: 1, latestMessageId: 50 }),
      summary({ threadId: 2, latestMessageId: 60, customer: 'Globex' }),
      summary({ threadId: 3, latestMessageId: 70, customer: 'Initech' }),
    ],
    [
      claim({ thread_id: 2, latest_message_id: 60, claimed_by: 'Priya Shah' }),
      claim({
        thread_id: 3,
        latest_message_id: 70,
        claimed_by: 'Tom Becker',
        answered_by: 'Tom Becker',
        answered_at: new Date('2026-10-11T09:00:00Z'),
      }),
    ],
  )

  assert.deepEqual(
    forView(items, 'waiting').map((i) => i.customer),
    ['Acme', 'Globex'],
  )
})

test('the answered list shows who answered, most recent first', () => {
  const items = withState(
    [
      summary({ threadId: 1, latestMessageId: 50 }),
      summary({ threadId: 2, latestMessageId: 60, customer: 'Globex' }),
      summary({ threadId: 3, latestMessageId: 70, customer: 'Initech' }),
    ],
    [
      claim({
        thread_id: 1,
        latest_message_id: 50,
        claimed_by: 'Alex Moore',
        answered_by: 'Alex Moore',
        answered_at: new Date('2026-10-09T08:00:00Z'),
      }),
      claim({ thread_id: 2, latest_message_id: 60, claimed_by: 'Priya Shah' }),
      claim({
        thread_id: 3,
        latest_message_id: 70,
        claimed_by: 'Tom Becker',
        answered_by: 'Tom Becker',
        answered_at: new Date('2026-10-11T09:00:00Z'),
      }),
    ],
  )

  assert.deepEqual(
    forView(items, 'answered').map((i) => [i.customer, i.answeredBy]),
    [
      ['Initech', 'Tom Becker'],
      ['Acme', 'Alex Moore'],
    ],
  )
})

test('a thread is never in both lists at once', () => {
  const items = withState(
    [summary({ threadId: 1, latestMessageId: 50 })],
    [
      claim({
        thread_id: 1,
        latest_message_id: 50,
        claimed_by: 'Alex Moore',
        answered_by: 'Alex Moore',
        answered_at: new Date('2026-10-09T08:00:00Z'),
      }),
    ],
  )

  assert.equal(forView(items, 'waiting').length, 0)
  assert.equal(forView(items, 'answered').length, 1)
})

test('only a known view name is accepted; anything else is the waiting list', () => {
  assert.equal(asThreadView('answered'), 'answered')
  assert.equal(asThreadView('waiting'), 'waiting')
  for (const value of [undefined, null, '', 'ANSWERED', 'all', 42, ['answered'], { v: 'answered' }]) {
    assert.equal(asThreadView(value), 'waiting', `fell back for ${JSON.stringify(value)}`)
  }
})

test('a released claim puts the thread back in the waiting list with no name on it', () => {
  // What the release route leaves behind: our row stays, both names are gone.
  const released = claim({ thread_id: 1, latest_message_id: 50 })
  const state = threadState(50, released)

  assert.equal(state.status, 'waiting')
  assert.equal(state.claimedBy, null)
  assert.equal(isWaitingOnUs(state), true)
})

test('an undone answer leaves the thread claimed by the person who undid it', () => {
  // What the reopen route leaves behind: the answer is gone, the claim stays.
  const reopened = claim({ thread_id: 1, latest_message_id: 50, claimed_by: 'Alex Moore' })
  const state = threadState(50, reopened)

  assert.equal(state.status, 'claimed')
  assert.equal(state.claimedBy, 'Alex Moore')
  assert.equal(state.answeredBy, null)
})

test('the waiting list puts the longest wait first', () => {
  const items = withState(
    [
      summary({ threadId: 1, customer: 'Fresh', lastMessageAt: '2026-10-14T10:00:00.000Z' }),
      summary({ threadId: 2, customer: 'Ancient', lastMessageAt: '2026-09-01T10:00:00.000Z' }),
      summary({ threadId: 3, customer: 'Middling', lastMessageAt: '2026-10-05T10:00:00.000Z' }),
    ],
    [],
  )

  assert.deepEqual(
    forView(items, 'waiting').map((i) => i.customer),
    ['Ancient', 'Middling', 'Fresh'],
  )
})

test('a thread somebody claimed keeps its place by how long the customer waited', () => {
  const items = withState(
    [
      summary({ threadId: 1, customer: 'Fresh', lastMessageAt: '2026-10-14T10:00:00.000Z' }),
      summary({
        threadId: 2,
        customer: 'Ancient',
        lastMessageAt: '2026-09-01T10:00:00.000Z',
        latestMessageId: 60,
      }),
    ],
    [claim({ thread_id: 2, latest_message_id: 60, claimed_by: 'Alex Moore' })],
  )

  assert.deepEqual(
    forView(items, 'waiting').map((i) => [i.customer, i.status]),
    [
      ['Ancient', 'claimed'],
      ['Fresh', 'waiting'],
    ],
  )
})

test('two threads waiting equally long keep a stable order', () => {
  const sameTime = '2026-10-10T10:00:00.000Z'
  const items = withState(
    [
      summary({ threadId: 9, customer: 'Nine', lastMessageAt: sameTime }),
      summary({ threadId: 4, customer: 'Four', lastMessageAt: sameTime }),
    ],
    [],
  )

  assert.deepEqual(
    forView(items, 'waiting').map((i) => i.customer),
    ['Four', 'Nine'],
  )
})

test('my pile is the threads I have claimed and not yet answered', () => {
  const items = withState(
    [
      summary({ threadId: 1, customer: 'Mine', latestMessageId: 50 }),
      summary({ threadId: 2, customer: 'Theirs', latestMessageId: 60 }),
      summary({ threadId: 3, customer: 'Free', latestMessageId: 70 }),
      summary({ threadId: 4, customer: 'Done', latestMessageId: 80 }),
    ],
    [
      claim({ thread_id: 1, latest_message_id: 50, claimed_by: 'Alex Moore' }),
      claim({ thread_id: 2, latest_message_id: 60, claimed_by: 'Priya Shah' }),
      claim({
        thread_id: 4,
        latest_message_id: 80,
        claimed_by: 'Alex Moore',
        answered_by: 'Alex Moore',
        answered_at: new Date('2026-10-11T09:00:00Z'),
      }),
    ],
  )

  assert.deepEqual(
    onlyMine(items, 'Alex Moore').map((i) => i.customer),
    ['Mine'],
  )
})

test('with no name picked, my pile is empty rather than everybody else work', () => {
  const items = withState(
    [summary({ threadId: 1, latestMessageId: 50 })],
    [claim({ thread_id: 1, latest_message_id: 50, claimed_by: 'Alex Moore' })],
  )

  assert.deepEqual(onlyMine(items, null), [])
  assert.deepEqual(onlyMine(items, ''), [])
})

function work(partial: Partial<TopicWork> = {}): TopicWork {
  return { topicCount: 1, openTopicCount: 1, unansweredCount: 1, waitingSince: null, ...partial }
}

test('a customer who chases this morning keeps the place of their oldest unanswered message', () => {
  // Chaser waited since 1 October and wrote "Any update?" today; Calm wrote
  // once, on 10 October. Sorting by the newest message put Chaser last.
  const items = withState(
    [
      summary({ threadId: 1, customer: 'Chaser', lastMessageAt: '2026-10-15T08:00:00.000Z' }),
      summary({ threadId: 2, customer: 'Calm', lastMessageAt: '2026-10-10T10:00:00.000Z' }),
    ],
    [],
    new Map([
      [1, work({ waitingSince: '2026-10-01T10:00:00.000Z', unansweredCount: 3 })],
      [2, work({ waitingSince: '2026-10-10T10:00:00.000Z' })],
    ]),
  )

  assert.deepEqual(
    forView(items, 'waiting').map((i) => [i.customer, i.unansweredCount]),
    [
      ['Chaser', 3],
      ['Calm', 1],
    ],
  )
})

test('between two equally long waits, the customer who chased more often comes first', () => {
  const since = '2026-10-05T10:00:00.000Z'
  const items = withState(
    [summary({ threadId: 1, customer: 'Once' }), summary({ threadId: 2, customer: 'Thrice' })],
    [],
    new Map([
      [1, work({ waitingSince: since, unansweredCount: 1 })],
      [2, work({ waitingSince: since, unansweredCount: 3 })],
    ]),
  )

  assert.deepEqual(
    forView(items, 'waiting').map((i) => i.customer),
    ['Thrice', 'Once'],
  )
})

test('the wait is measured from the oldest unanswered message, the newest only as a fallback', () => {
  const [withWork, without] = withState(
    [summary({ threadId: 1 }), summary({ threadId: 2 })],
    [],
    new Map([[1, work({ waitingSince: '2026-10-01T10:00:00.000Z' })]]),
  )

  assert.equal(waitingSince(withWork), '2026-10-01T10:00:00.000Z')
  assert.equal(waitingSince(without), without.lastMessageAt)
  assert.equal(without.unansweredCount, 0, 'a thread with no topic numbers gets zeros')
})

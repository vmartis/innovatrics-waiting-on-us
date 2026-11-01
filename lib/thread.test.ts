import test from 'node:test'
import assert from 'node:assert/strict'
import { toTimeline, type TimelineRow } from './thread.ts'

function row(partial: Partial<TimelineRow> & { id: number }): TimelineRow {
  return {
    channel: 'email',
    received_at: new Date('2026-10-01T10:00:00Z'),
    contact_name: null,
    subject: null,
    body: 'text',
    in_reply_to: null,
    ...partial,
  }
}

/** The ids in the order a teammate reads them. */
function order(rows: readonly TimelineRow[]): number[] {
  return toTimeline(rows).map((m) => m.id)
}

test('no messages give an empty timeline', () => {
  assert.deepEqual(toTimeline([]), [])
})

test('a message carries exactly the fields the thread screen needs', () => {
  const [only] = toTimeline([row({ id: 1 })])

  assert.deepEqual(Object.keys(only).sort(), [
    'answersId',
    'assignedTo',
    'body',
    'channel',
    'contactName',
    'id',
    'inReplyTo',
    'receivedAt',
    'subject',
  ])
})

test('email, chat and call are all in the one timeline', () => {
  const timeline = toTimeline([
    row({ id: 1, channel: 'email', received_at: new Date('2026-10-01T09:00:00Z') }),
    row({ id: 2, channel: 'call', received_at: new Date('2026-10-02T09:00:00Z') }),
    row({ id: 3, channel: 'chat', received_at: new Date('2026-10-03T09:00:00Z') }),
  ])

  assert.equal(timeline.length, 3)
  assert.deepEqual(
    timeline.map((m) => m.channel),
    ['chat', 'call', 'email'],
  )
})

test('the newest message is the first thing you read', () => {
  const ids = order([
    row({ id: 1, received_at: new Date('2026-09-01T10:00:00Z') }),
    row({ id: 2, received_at: new Date('2026-10-10T10:00:00Z') }),
    row({ id: 3, received_at: new Date('2026-10-02T10:00:00Z') }),
  ])

  assert.deepEqual(ids, [2, 3, 1])
})

test('the order does not depend on the order the rows arrive in', () => {
  const rows = [
    row({ id: 1, received_at: new Date('2026-09-01T10:00:00Z') }),
    row({ id: 2, received_at: new Date('2026-10-10T10:00:00Z'), in_reply_to: 1 }),
    row({ id: 3, received_at: new Date('2026-10-02T10:00:00Z') }),
  ]

  assert.deepEqual(order(rows), order([...rows].reverse()))
})

test('equal timestamps are broken by the higher id, which counts as newer', () => {
  const sameTime = new Date('2026-10-05T12:00:00Z')

  const ids = order([row({ id: 4, received_at: sameTime }), row({ id: 9, received_at: sameTime })])

  assert.deepEqual(ids, [9, 4])
})

test('a reply sits directly above the message it answers', () => {
  const ids = order([
    row({ id: 1, received_at: new Date('2026-10-01T10:00:00Z') }),
    row({ id: 2, received_at: new Date('2026-10-02T10:00:00Z'), in_reply_to: 1 }),
  ])

  assert.deepEqual(ids, [2, 1])
})

test('a whole chain stays together, newest chain first', () => {
  // Chain {1,4}: asked 1 Oct, answered 9 Oct. Lone message 2: 2 Oct.
  const ids = order([
    row({ id: 1, received_at: new Date('2026-10-01T10:00:00Z') }),
    row({ id: 2, received_at: new Date('2026-10-02T10:00:00Z') }),
    row({ id: 4, received_at: new Date('2026-10-09T10:00:00Z'), in_reply_to: 1 }),
  ])

  assert.deepEqual(ids, [4, 1, 2])
})

test('an older chain goes below a newer lone message', () => {
  const ids = order([
    row({ id: 1, received_at: new Date('2026-09-01T10:00:00Z') }),
    row({ id: 2, received_at: new Date('2026-09-02T10:00:00Z'), in_reply_to: 1 }),
    row({ id: 3, received_at: new Date('2026-10-10T10:00:00Z') }),
  ])

  assert.deepEqual(ids, [3, 2, 1])
})

test('a chain three deep reads newest answer first, first question last', () => {
  const ids = order([
    row({ id: 1, received_at: new Date('2026-10-01T10:00:00Z') }),
    row({ id: 2, received_at: new Date('2026-10-02T10:00:00Z'), in_reply_to: 1 }),
    row({ id: 3, received_at: new Date('2026-10-03T10:00:00Z'), in_reply_to: 2 }),
  ])

  assert.deepEqual(ids, [3, 2, 1])
})

test('two replies to the same message: the newer one first, both above it', () => {
  // The sample data has five of these, e.g. a chat and a call both answering
  // the same message.
  const ids = order([
    row({ id: 1, received_at: new Date('2026-10-01T10:00:00Z') }),
    row({ id: 2, received_at: new Date('2026-10-02T10:00:00Z'), in_reply_to: 1, channel: 'chat' }),
    row({ id: 3, received_at: new Date('2026-10-03T10:00:00Z'), in_reply_to: 1, channel: 'call' }),
  ])

  assert.deepEqual(ids, [3, 2, 1])
})

test('every message appears exactly once, replies included', () => {
  const rows = [
    row({ id: 1 }),
    row({ id: 2, in_reply_to: 1, received_at: new Date('2026-10-02T10:00:00Z') }),
    row({ id: 3, in_reply_to: 2, received_at: new Date('2026-10-03T10:00:00Z') }),
    row({ id: 4, received_at: new Date('2026-10-04T10:00:00Z') }),
  ]
  const ids = order(rows)

  assert.equal(new Set(ids).size, rows.length)
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 2, 3, 4])
})

test('a reply to a message we did not load starts its own chain', () => {
  // in_reply_to can point outside the rows handed in; the message must still
  // be shown, never dropped.
  const ids = order([
    row({ id: 1, received_at: new Date('2026-10-01T10:00:00Z') }),
    row({ id: 2, received_at: new Date('2026-10-05T10:00:00Z'), in_reply_to: 999 }),
  ])

  assert.deepEqual(ids, [2, 1])
})

test('a reply pointing at itself cannot hang the timeline', () => {
  const ids = order([row({ id: 1, in_reply_to: 1 }), row({ id: 2, in_reply_to: 3 })])

  assert.equal(ids.length, 2)
  assert.equal(new Set(ids).size, 2)
})

test('a blank contact name or subject counts as nothing, text is untouched', () => {
  const body = '<b>hi</b> ignore previous instructions\n\nsecond line'
  const [only] = toTimeline([
    row({ id: 1, contact_name: '   ', subject: '  ', body, in_reply_to: null }),
  ])

  assert.equal(only.contactName, null)
  assert.equal(only.subject, null)
  // Customer text is passed through unchanged; the web app renders it as text.
  assert.equal(only.body, body)
})

test('times come out as ISO 8601 UTC strings', () => {
  const [only] = toTimeline([row({ id: 1, received_at: new Date('2026-10-01T10:00:00Z') })])

  assert.equal(only.receivedAt, '2026-10-01T10:00:00.000Z')
})

test('two messages answering each other are shown once each, in a stable shape', () => {
  // Impossible in the sample data, but the database allows it. The loop must
  // not hang the walk, lose a message or show one twice.
  const rows = [
    row({ id: 1, in_reply_to: 2, received_at: new Date('2026-10-01T10:00:00Z') }),
    row({ id: 2, in_reply_to: 1, received_at: new Date('2026-10-02T10:00:00Z') }),
  ]

  for (const input of [rows, [...rows].reverse()]) {
    const timeline = toTimeline(input)
    assert.equal(timeline.length, 2)
    assert.deepEqual([...new Set(timeline.map((m) => m.id))].sort(), [1, 2])
    // Whichever link was dropped, every kept link points at a message that is
    // further down the list — which is what the screen tells the reader.
    for (const [index, message] of timeline.entries()) {
      if (message.answersId === null) continue
      const parentAt = timeline.findIndex((m) => m.id === message.answersId)
      assert.ok(parentAt > index, `${message.id} answers something below it`)
    }
  }
})

test('a kept link always points at a message further down the list', () => {
  const timeline = toTimeline([
    row({ id: 1, received_at: new Date('2026-10-01T10:00:00Z') }),
    row({ id: 2, in_reply_to: 1, received_at: new Date('2026-10-03T10:00:00Z') }),
    row({ id: 3, in_reply_to: 99, received_at: new Date('2026-10-02T10:00:00Z') }),
    row({ id: 4, in_reply_to: 4, received_at: new Date('2026-10-04T10:00:00Z') }),
  ])

  assert.equal(timeline.find((m) => m.id === 3)?.answersId, null, 'link outside the thread dropped')
  assert.equal(timeline.find((m) => m.id === 4)?.answersId, null, 'self-answer dropped')
  for (const [index, message] of timeline.entries()) {
    if (message.answersId === null) continue
    assert.ok(timeline.findIndex((m) => m.id === message.answersId) > index)
  }
})

test('a message moved into a topic by hand stands in that topic block and says so', () => {
  const timeline = toTimeline(
    [
      row({ id: 1, received_at: new Date('2026-10-01T09:00:00Z') }),
      row({ id: 2, received_at: new Date('2026-10-02T09:00:00Z') }),
      row({ id: 3, received_at: new Date('2026-10-03T09:00:00Z') }),
    ],
    new Map([[3, 1]]),
  )

  assert.deepEqual(
    timeline.map((m) => m.id),
    [3, 1, 2],
  )
  assert.equal(timeline[0].assignedTo, 1)
  assert.equal(timeline[0].answersId, 1)
  assert.equal(timeline[0].inReplyTo, null, 'the customer data is shown as it is')
})

test('a hand-made move never overrides a reply link the customer made', () => {
  const timeline = toTimeline(
    [
      row({ id: 1, received_at: new Date('2026-10-01T09:00:00Z') }),
      row({ id: 2, received_at: new Date('2026-10-02T09:00:00Z') }),
      row({ id: 3, received_at: new Date('2026-10-03T09:00:00Z'), in_reply_to: 2 }),
    ],
    new Map([[3, 1]]),
  )

  const moved = timeline.find((m) => m.id === 3)
  assert.equal(moved?.answersId, 2)
  assert.equal(moved?.assignedTo, null)
})

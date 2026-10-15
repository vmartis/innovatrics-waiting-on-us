import test from 'node:test'
import assert from 'node:assert/strict'
import { toThreadSummaries, type RequestRow } from './threads.ts'

function row(partial: Partial<RequestRow> & { id: number; customer: string }): RequestRow {
  return {
    contact_name: null,
    channel: 'email',
    received_at: new Date('2026-10-01T10:00:00Z'),
    ...partial,
  }
}

test('no rows give no threads', () => {
  assert.deepEqual(toThreadSummaries([]), [])
})

test('one summary per customer with the message count', () => {
  const summaries = toThreadSummaries([
    row({ id: 1, customer: 'Acme' }),
    row({ id: 2, customer: 'Acme' }),
    row({ id: 3, customer: 'Globex' }),
  ])

  assert.equal(summaries.length, 2)
  assert.equal(summaries.find((s) => s.customer === 'Acme')?.messageCount, 2)
})

test('a summary carries exactly the fields the list needs', () => {
  const [acme] = toThreadSummaries([row({ id: 1, customer: 'Acme' })])

  assert.deepEqual(Object.keys(acme).sort(), [
    'channels',
    'contactName',
    'customer',
    'lastChannel',
    'lastMessageAt',
    'latestMessageId',
    'messageCount',
    'threadId',
  ])
})

test('the thread id is the customer first message and ignores row order', () => {
  const [acme] = toThreadSummaries([
    row({ id: 77, customer: 'Acme' }),
    row({ id: 12, customer: 'Acme' }),
    row({ id: 40, customer: 'Acme' }),
  ])

  assert.equal(acme.threadId, 12)
})

test('the newest message decides the thread time and channel', () => {
  const [acme] = toThreadSummaries([
    row({
      id: 1,
      customer: 'Acme',
      channel: 'email',
      received_at: new Date('2026-10-01T10:00:00Z'),
    }),
    row({
      id: 2,
      customer: 'Acme',
      channel: 'chat',
      received_at: new Date('2026-10-03T08:30:00Z'),
    }),
  ])

  assert.equal(acme.latestMessageId, 2)
  assert.equal(acme.lastChannel, 'chat')
  assert.equal(acme.lastMessageAt, '2026-10-03T08:30:00.000Z')
})

test('all channels used by a customer are listed in a stable order', () => {
  const [acme] = toThreadSummaries([
    row({ id: 1, customer: 'Acme', channel: 'call' }),
    row({ id: 2, customer: 'Acme', channel: 'email' }),
    row({ id: 3, customer: 'Acme', channel: 'chat' }),
    row({ id: 4, customer: 'Acme', channel: 'chat' }),
  ])

  assert.deepEqual(acme.channels, ['email', 'chat', 'call'])
})

test('threads come back newest first', () => {
  const summaries = toThreadSummaries([
    row({ id: 1, customer: 'Old', received_at: new Date('2026-09-01T10:00:00Z') }),
    row({ id: 2, customer: 'New', received_at: new Date('2026-10-10T10:00:00Z') }),
    row({ id: 3, customer: 'Middle', received_at: new Date('2026-10-02T10:00:00Z') }),
  ])

  assert.deepEqual(
    summaries.map((s) => s.customer),
    ['New', 'Middle', 'Old'],
  )
})

test('the contact shown is the one who wrote the newest named message', () => {
  const [acme] = toThreadSummaries([
    row({
      id: 1,
      customer: 'Acme',
      contact_name: 'Old Colleague',
      received_at: new Date('2026-10-01T10:00:00Z'),
    }),
    row({
      id: 2,
      customer: 'Acme',
      contact_name: 'Dana Fox',
      received_at: new Date('2026-10-05T10:00:00Z'),
    }),
    row({
      id: 3,
      customer: 'Acme',
      contact_name: null,
      received_at: new Date('2026-10-09T10:00:00Z'),
    }),
  ])

  assert.equal(acme.contactName, 'Dana Fox')
})

test('the contact name does not depend on the order rows arrive in', () => {
  const rows = [
    row({ id: 1, customer: 'Acme', contact_name: 'Old Colleague' }),
    row({
      id: 2,
      customer: 'Acme',
      contact_name: 'Dana Fox',
      received_at: new Date('2026-10-05T10:00:00Z'),
    }),
  ]
  const forwards = toThreadSummaries(rows)[0]
  const backwards = toThreadSummaries([...rows].reverse())[0]

  assert.equal(forwards.contactName, 'Dana Fox')
  assert.deepEqual(forwards, backwards)
})

test('an empty or blank contact name counts as no name', () => {
  const [acme] = toThreadSummaries([
    row({ id: 1, customer: 'Acme', contact_name: 'Dana Fox' }),
    row({
      id: 2,
      customer: 'Acme',
      contact_name: '   ',
      received_at: new Date('2026-10-05T10:00:00Z'),
    }),
  ])

  assert.equal(acme.contactName, 'Dana Fox')
})

test('equal timestamps are broken by the higher id, not by input order', () => {
  const sameTime = new Date('2026-10-05T12:00:00Z')
  const [acme] = toThreadSummaries([
    row({ id: 9, customer: 'Acme', channel: 'chat', received_at: sameTime }),
    row({ id: 4, customer: 'Acme', channel: 'call', received_at: sameTime }),
  ])

  assert.equal(acme.latestMessageId, 9)
  assert.equal(acme.lastChannel, 'chat')
})

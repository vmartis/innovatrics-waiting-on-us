import test from 'node:test'
import assert from 'node:assert/strict'
import { isLongWait, waitedFor, waitedMs } from './elapsed.ts'

const NOW = new Date('2026-10-15T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

test('a fresh message reads as just now', () => {
  assert.equal(waitedFor(ago(0), NOW), 'just now')
  assert.equal(waitedFor(ago(4 * MINUTE), NOW), 'just now')
})

test('minutes, then hours, then days', () => {
  assert.equal(waitedFor(ago(40 * MINUTE), NOW), '40 minutes')
  assert.equal(waitedFor(ago(3 * HOUR), NOW), '3 hours')
  assert.equal(waitedFor(ago(9 * DAY), NOW), '9 days')
})

test('one of something is not plural', () => {
  assert.equal(waitedFor(ago(HOUR), NOW), '1 hour')
  assert.equal(waitedFor(ago(DAY), NOW), '1 day')
})

test('it rounds down, so a wait is never overstated', () => {
  assert.equal(waitedFor(ago(DAY + 23 * HOUR), NOW), '1 day')
  assert.equal(waitedFor(ago(2 * DAY - 1), NOW), '1 day')
})

test('a clock skewed into the future reads as just now, never negative', () => {
  const future = new Date(NOW.getTime() + 5 * DAY).toISOString()
  assert.equal(waitedMs(future, NOW), 0)
  assert.equal(waitedFor(future, NOW), 'just now')
})

test('a timestamp that is not a date does not produce nonsense', () => {
  assert.equal(waitedMs('not a date', NOW), 0)
  assert.equal(waitedFor('not a date', NOW), 'just now')
})

test('three days is the point where a wait is worth pointing at', () => {
  assert.equal(isLongWait(ago(3 * DAY - MINUTE), NOW), false)
  assert.equal(isLongWait(ago(3 * DAY), NOW), true)
  assert.equal(isLongWait(ago(30 * DAY), NOW), true)
})

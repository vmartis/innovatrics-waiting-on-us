import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from './app.ts'
import { applySchema, pool } from './db.ts'

// Tests empty our own table, so they must never run against the schema the
// deployed app uses. `npm test` sets APP_SCHEMA; a bare `node --test` stops here.
assert.notEqual(
  process.env.APP_SCHEMA ?? 'public',
  'public',
  'run the tests with `npm test` so they use their own schema',
)
// Create our table in the test schema before anything reads or empties it.
await applySchema()

/** Start the real app on a free port and return its base URL. */
const server = createApp().listen(0)
const { port } = server.address() as AddressInfo
const base = `http://127.0.0.1:${port}`

after(async () => {
  server.close()
  await pool.end()
})

type ThreadBody = { threads: Record<string, unknown>[] }

test('GET /api/health answers', async () => {
  const res = await fetch(`${base}/api/health`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test('GET /api/threads returns the real customers from Postgres', async () => {
  const res = await fetch(`${base}/api/threads`)
  assert.equal(res.status, 200)

  const body = (await res.json()) as ThreadBody
  assert.ok(Array.isArray(body.threads))
  assert.ok(body.threads.length > 0, 'the sample data has waiting threads')

  const [first] = body.threads
  assert.deepEqual(Object.keys(first).sort(), [
    'answeredAt',
    'answeredBy',
    'channels',
    'claimedAt',
    'claimedBy',
    'contactName',
    'customer',
    'lastChannel',
    'lastMessageAt',
    'latestMessageId',
    'messageCount',
    'status',
    'threadId',
  ])
  assert.equal(typeof first.customer, 'string')
  assert.ok((first.messageCount as number) >= 1)
})

test('with nothing answered, the list covers every customer and message', async () => {
  // Our own table only; the sample table `requests` is never written to.
  await pool.query('DELETE FROM thread_claims')

  const res = await fetch(`${base}/api/threads`)
  const body = (await res.json()) as { threads: { messageCount: number }[] }

  assert.equal(body.threads.length, 22, 'the sample data has 22 customers')
  const total = body.threads.reduce((sum, t) => sum + t.messageCount, 0)
  assert.equal(total, 340, 'the sample data has 340 messages')
})

test('every thread id is unique and points at a real message', async () => {
  const res = await fetch(`${base}/api/threads`)
  const body = (await res.json()) as { threads: { threadId: number }[] }
  const ids = body.threads.map((t) => t.threadId)

  assert.equal(new Set(ids).size, ids.length, 'thread ids are unique')
  const found = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM requests WHERE id = ANY($1::int[])',
    [ids],
  )
  assert.equal(Number(found.rows[0].n), ids.length)
})

test('the API never ships message bodies or subjects', async () => {
  const res = await fetch(`${base}/api/threads`)
  const text = await res.text()
  const body = JSON.parse(text) as ThreadBody

  for (const thread of body.threads) {
    assert.equal(Object.hasOwn(thread, 'body'), false)
    assert.equal(Object.hasOwn(thread, 'subject'), false)
    assert.equal(Object.hasOwn(thread, 'lastSubject'), false)
  }
  // A body would be unmissable: the sample messages are long prose.
  assert.equal(text.includes('Best regards'), false)
})

test('answers under /api are never cached', async () => {
  const res = await fetch(`${base}/api/threads`)
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

test('an unknown /api path is a 404 in JSON, not the SPA', async () => {
  const res = await fetch(`${base}/api/nope`)
  assert.equal(res.status, 404)
  assert.equal(res.headers.get('content-type')?.startsWith('application/json'), true)
})

test('a deep link falls back to the single-page app', async () => {
  const res = await fetch(`${base}/thread/12`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type')?.startsWith('text/html'), true)
  assert.match(await res.text(), /<div id="root">/)
})

test('a broken request body is a client error, not a server fault', async () => {
  const res = await fetch(`${base}/api/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"broken":',
  })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'bad request' })
})

test('our own table never constrains the read-only sample table', async () => {
  const constraints = await pool.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint
      WHERE confrelid = 'requests'::regclass AND conrelid <> 'requests'::regclass`,
  )
  assert.deepEqual(
    constraints.rows,
    [],
    'a foreign key onto requests would stop reset-data.sh dropping it',
  )
})

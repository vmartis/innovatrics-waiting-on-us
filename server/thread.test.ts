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
await applySchema()

const server = createApp().listen(0)
const { port } = server.address() as AddressInfo
const base = `http://127.0.0.1:${port}`

after(async () => {
  server.close()
  await pool.end()
})

type Detail = {
  thread: { customer: string; messageCount: number; channels: string[] }
  messages: {
    id: number
    channel: string
    receivedAt: string
    contactName: string | null
    subject: string | null
    body: string
    inReplyTo: number | null
  }[]
}

/**
 * The thread of a real customer who used all three channels and has replies —
 * the hardest case the sample data offers. The read is read-only and touches
 * only the sample table.
 */
async function hardestThreadId(): Promise<number> {
  const found = await pool.query<{ thread_id: number }>(
    `SELECT min(id) AS thread_id
       FROM requests
      GROUP BY customer
     HAVING count(DISTINCT channel) = 3 AND count(in_reply_to) > 0
      ORDER BY count(in_reply_to) DESC, min(id)
      LIMIT 1`,
  )
  const row = found.rows[0]
  assert.ok(row, 'the sample data has a customer on all three channels with replies')
  return row.thread_id
}

async function detail(threadId: number): Promise<Detail> {
  const res = await fetch(`${base}/api/threads/${threadId}`)
  assert.equal(res.status, 200)
  return (await res.json()) as Detail
}

test('a thread brings back every message of that customer, on all three channels', async () => {
  const body = await detail(await hardestThreadId())

  assert.equal(body.messages.length, body.thread.messageCount)
  assert.deepEqual([...new Set(body.messages.map((m) => m.channel))].sort(), [
    'call',
    'chat',
    'email',
  ])
  assert.ok(
    body.messages.every((m) => typeof m.body === 'string' && m.body.length > 0),
    'every message carries its own text',
  )
  assert.ok(
    body.messages.some((m) => m.channel === 'email' && m.subject),
    'emails come with their subject',
  )
  assert.ok(
    body.messages.some((m) => m.contactName),
    'the timeline says who wrote',
  )
})

test('a message carries exactly the fields the thread screen needs', async () => {
  const body = await detail(await hardestThreadId())

  assert.deepEqual(Object.keys(body.messages[0]).sort(), [
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

test('the newest message is at the top, so you read the latest reply first', async () => {
  const body = await detail(await hardestThreadId())
  const times = body.messages.map((m) => m.receivedAt)

  assert.equal(times[0], [...times].sort().at(-1), 'the first message is the newest one')
})

test('every reply stands above the message it answers', async () => {
  const body = await detail(await hardestThreadId())
  const positionOf = new Map(body.messages.map((m, index) => [m.id, index]))
  const replies = body.messages.filter((m) => m.inReplyTo !== null)

  assert.ok(replies.length > 0, 'this thread has reply chains')
  for (const reply of replies) {
    const answered = positionOf.get(reply.inReplyTo as number)
    assert.ok(answered !== undefined, 'the message a reply answers is in the same thread')
    assert.ok(
      (positionOf.get(reply.id) as number) < answered,
      'a reply is shown above the message it answers',
    )
  }
})

test('every customer thread holds together: nothing lost, nothing doubled', async () => {
  const threads = await pool.query<{ thread_id: number; n: string }>(
    `SELECT min(id) AS thread_id, count(*) AS n FROM requests GROUP BY customer ORDER BY 1`,
  )

  for (const thread of threads.rows) {
    const body = await detail(thread.thread_id)
    const ids = body.messages.map((m) => m.id)

    assert.equal(ids.length, Number(thread.n), `thread ${thread.thread_id} shows every message`)
    assert.equal(new Set(ids).size, ids.length, `thread ${thread.thread_id} shows none twice`)
    const times = body.messages.map((m) => m.receivedAt)
    assert.equal(times[0], [...times].sort().at(-1), `thread ${thread.thread_id} is newest first`)
  }
})

test('the conversation is served as JSON and never cached', async () => {
  // Whether the *screen* escapes the text is a property of MessageList, not of
  // this response; PLAN.md checks that on the live URL.
  const res = await fetch(`${base}/api/threads/${await hardestThreadId()}`)

  assert.equal(res.headers.get('content-type')?.startsWith('application/json'), true)
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

test('every reply link the screen is told to follow points further down', async () => {
  const res = await fetch(`${base}/api/threads/${await hardestThreadId()}`)
  const body = (await res.json()) as { messages: { id: number; answersId: number | null }[] }

  for (const [index, message] of body.messages.entries()) {
    if (message.answersId === null) continue
    const parentAt = body.messages.findIndex((m) => m.id === message.answersId)
    assert.ok(parentAt > index, `message ${message.id} answers something above it`)
  }
})

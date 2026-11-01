import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from './app.ts'
import { applySchema, pool } from './db.ts'
import { TEAM } from '../lib/team.ts'
import type { ThreadState } from '../lib/waiting.ts'

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

const [ALEX, PRIYA] = TEAM

after(async () => {
  await pool.query('DELETE FROM thread_claims; DELETE FROM topic_answers; DELETE FROM message_topics')
  server.close()
  await pool.end()
})

// Our own tables only; the sample table `requests` is never written to.
beforeEach(async () => {
  await pool.query('DELETE FROM thread_claims; DELETE FROM topic_answers; DELETE FROM message_topics')
})

type Answer = { status: number; body: { error?: string; state?: ThreadState } }

async function post(path: string, body: unknown): Promise<Answer> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Answer['body'] }
}

async function waitingList(): Promise<{ threadId: number; customer: string; status: string }[]> {
  const res = await fetch(`${base}/api/threads`)
  const body = (await res.json()) as {
    threads: { threadId: number; customer: string; status: string }[]
  }
  return body.threads
}

/** A real thread id: the first message of the first customer in the list. */
async function someThreadId(): Promise<number> {
  const [first] = await waitingList()
  return first.threadId
}

test('GET /api/team offers the names a teammate can pick', async () => {
  const res = await fetch(`${base}/api/team`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { team: [...TEAM] })
})

test('every thread starts out waiting on us', async () => {
  const threads = await waitingList()
  assert.equal(threads.length, 22)
  assert.ok(threads.every((t) => t.status === 'waiting'))
})

test('claiming a thread puts my name on it and keeps it in the list', async () => {
  const threadId = await someThreadId()
  const claimed = await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  assert.equal(claimed.status, 200)
  assert.equal(claimed.body.state?.status, 'claimed')
  assert.equal(claimed.body.state?.claimedBy, ALEX)

  const mine = (await waitingList()).find((t) => t.threadId === threadId)
  assert.equal(mine?.status, 'claimed')
})

test('a second person claiming the same thread is refused', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  const second = await post(`/api/threads/${threadId}/claim`, { person: PRIYA })
  assert.equal(second.status, 409)
  assert.equal(second.body.state?.claimedBy, ALEX, 'the first owner keeps the thread')
})

test('two people clicking at the same moment: exactly one wins', async () => {
  const threadId = await someThreadId()

  const answers = await Promise.all([
    post(`/api/threads/${threadId}/claim`, { person: ALEX }),
    post(`/api/threads/${threadId}/claim`, { person: PRIYA }),
    post(`/api/threads/${threadId}/claim`, { person: ALEX }),
    post(`/api/threads/${threadId}/claim`, { person: PRIYA }),
  ])

  assert.equal(answers.filter((a) => a.status === 200).length, 1, 'exactly one claim succeeds')
  assert.equal(answers.filter((a) => a.status === 409).length, 3)

  const stored = await pool.query<{ claimed_by: string }>(
    'SELECT claimed_by FROM thread_claims WHERE thread_id = $1',
    [threadId],
  )
  assert.equal(stored.rowCount, 1, 'one row, one owner')
})

test('claiming again as the same person is still refused, so nothing is overwritten', async () => {
  const threadId = await someThreadId()
  const first = await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  const again = await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  assert.equal(again.status, 409)
  assert.equal(again.body.state?.claimedAt, first.body.state?.claimedAt)
})

test('marking answered removes the thread from the waiting list', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  const answered = await post(`/api/threads/${threadId}/answered`, { person: ALEX })
  assert.equal(answered.status, 200)
  assert.equal(answered.body.state?.status, 'answered')
  assert.equal(answered.body.state?.answeredBy, ALEX)

  const threads = await waitingList()
  assert.equal(threads.length, 21)
  assert.equal(
    threads.some((t) => t.threadId === threadId),
    false,
  )
})

test('the state survives a reload: it is read back from the database', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: PRIYA })

  const res = await fetch(`${base}/api/threads/${threadId}`)
  const body = (await res.json()) as { thread: ThreadState }
  assert.equal(body.thread.status, 'claimed')
  assert.equal(body.thread.claimedBy, PRIYA)
})

test('only the person holding the claim can mark it answered', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  const notMine = await post(`/api/threads/${threadId}/answered`, { person: PRIYA })
  assert.equal(notMine.status, 409)
  assert.equal(notMine.body.state?.status, 'claimed')
  assert.equal((await waitingList()).length, 22, 'nothing left the list')
})

test('an unclaimed thread cannot be marked answered', async () => {
  const threadId = await someThreadId()
  const answered = await post(`/api/threads/${threadId}/answered`, { person: ALEX })

  assert.equal(answered.status, 409)
  assert.match(answered.body.error ?? '', /claim this thread first/)
})

test('a name that is not on the team is refused', async () => {
  const threadId = await someThreadId()

  for (const person of ['Mallory', '', 'alex moore', 42, null, { name: ALEX }]) {
    const answer = await post(`/api/threads/${threadId}/claim`, { person })
    assert.equal(answer.status, 400, `refused: ${JSON.stringify(person)}`)
  }
  const stored = await pool.query('SELECT 1 FROM thread_claims')
  assert.equal(stored.rowCount, 0, 'nothing was stored')
})

test('a thread id that is not a first message is refused', async () => {
  // A real requests.id that is not its customer's first message, so it is not
  // a thread key. Taken from the data, because which ids those are can shift.
  const later = await pool.query<{ id: number }>(
    `SELECT id FROM requests r
      WHERE id > (SELECT min(id) FROM requests r2 WHERE r2.customer = r.customer)
      ORDER BY id LIMIT 1`,
  )
  assert.ok(later.rows[0], 'the sample data has customers with more than one message')

  const notAThread = await post(`/api/threads/${later.rows[0].id}/claim`, { person: ALEX })
  assert.equal(notAThread.status, 404)

  for (const id of ['0', '-1', 'abc', '1e3', '99999999', '1; DROP TABLE thread_claims']) {
    const answer = await post(`/api/threads/${encodeURIComponent(id)}/claim`, { person: ALEX })
    assert.ok(answer.status === 400 || answer.status === 404, `refused: ${id}`)
  }

  const table = await pool.query("SELECT to_regclass('thread_claims') AS t")
  assert.ok(table.rows[0].t, 'the table still exists')
})

test('a new customer message cannot be used to steal an unfinished claim', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  // Pretend the customer wrote again after Alex claimed it: our row now
  // points at an older message than the thread's newest one.
  await pool.query(
    'UPDATE thread_claims SET latest_message_id = latest_message_id - 1 WHERE thread_id = $1',
    [threadId],
  )

  const steal = await post(`/api/threads/${threadId}/claim`, { person: PRIYA })
  assert.equal(steal.status, 409)
  assert.equal(steal.body.state?.claimedBy, ALEX, 'Alex keeps the thread')
})

test('a thread answered before the newest message can be claimed again', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/answered`, { person: ALEX })

  // The customer comes back after Alex answered.
  await pool.query(
    'UPDATE thread_claims SET latest_message_id = latest_message_id - 1 WHERE thread_id = $1',
    [threadId],
  )

  assert.equal(
    (await waitingList()).some((t) => t.threadId === threadId),
    true,
    'it is waiting on us again',
  )

  const again = await post(`/api/threads/${threadId}/claim`, { person: PRIYA })
  assert.equal(again.status, 200)
  assert.equal(again.body.state?.claimedBy, PRIYA)
  assert.equal(again.body.state?.status, 'claimed')
})

test('claiming a thread you already hold says so plainly', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  const again = await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  assert.equal(again.status, 409)
  assert.match(again.body.error ?? '', /you already have this one/)
})

test('a claim never writes to the sample data', async () => {
  const before = await pool.query<{ n: string }>('SELECT count(*) AS n FROM requests')
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/answered`, { person: ALEX })
  const after = await pool.query<{ n: string }>('SELECT count(*) AS n FROM requests')

  assert.equal(after.rows[0].n, before.rows[0].n)
})

test('opening a thread returns the whole conversation, newest message first', async () => {
  const threadId = await someThreadId()
  const res = await fetch(`${base}/api/threads/${threadId}`)
  assert.equal(res.status, 200)

  const body = (await res.json()) as {
    thread: { customer: string; messageCount: number }
    messages: { id: number; receivedAt: string; body: string; channel: string }[]
  }

  assert.ok(body.messages.length > 1)
  assert.equal(body.messages.length, body.thread.messageCount)
  // S3 turned the timeline around: the latest reply is the first thing you
  // read, and replies hang under the message they answer (lib/thread.ts).
  const times = body.messages.map((m) => m.receivedAt)
  assert.equal(times[0], [...times].sort().at(-1), 'newest first')
  assert.ok(
    body.messages.every((m) => typeof m.body === 'string' && m.body.length > 0),
    'every message has its text',
  )
  assert.ok(['email', 'chat', 'call'].includes(body.messages[0].channel))
})

test('releasing a thread puts it back in the waiting list with no name on it', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  const released = await post(`/api/threads/${threadId}/release`, { person: ALEX })
  assert.equal(released.status, 200)
  assert.equal(released.body.state?.status, 'waiting')
  assert.equal(released.body.state?.claimedBy, null)

  const back = (await waitingList()).find((t) => t.threadId === threadId)
  assert.equal(back?.status, 'waiting')
})

test('after a release a colleague can take the thread', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/release`, { person: ALEX })

  const taken = await post(`/api/threads/${threadId}/claim`, { person: PRIYA })
  assert.equal(taken.status, 200)
  assert.equal(taken.body.state?.claimedBy, PRIYA)
})

test('only the person holding a thread can hand it back', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  const notMine = await post(`/api/threads/${threadId}/release`, { person: PRIYA })
  assert.equal(notMine.status, 409)
  assert.equal(notMine.body.state?.claimedBy, ALEX, 'Alex still has it')
})

test('a thread nobody claimed cannot be handed back', async () => {
  const threadId = await someThreadId()
  const released = await post(`/api/threads/${threadId}/release`, { person: ALEX })

  assert.equal(released.status, 409)
  assert.match(released.body.error ?? '', /only the person who claimed/)
})

test('an answered thread cannot be released, only undone', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/answered`, { person: ALEX })

  const released = await post(`/api/threads/${threadId}/release`, { person: ALEX })
  assert.equal(released.status, 409)
  assert.equal(released.body.state?.status, 'answered')
})

test('the person who answered can undo it, and the thread is theirs again', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/answered`, { person: ALEX })

  const undone = await post(`/api/threads/${threadId}/reopen`, { person: ALEX })
  assert.equal(undone.status, 200)
  assert.equal(undone.body.state?.status, 'claimed')
  assert.equal(undone.body.state?.claimedBy, ALEX)
  assert.equal(undone.body.state?.answeredBy, null)

  assert.equal(
    (await waitingList()).some((t) => t.threadId === threadId),
    true,
    'it is back in the waiting list',
  )
})

test('somebody else cannot undo an answer', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/answered`, { person: ALEX })

  const undone = await post(`/api/threads/${threadId}/reopen`, { person: PRIYA })
  assert.equal(undone.status, 409)
  assert.equal(undone.body.state?.status, 'answered')
  assert.equal(undone.body.state?.answeredBy, ALEX)
})

test('an unanswered thread cannot be undone', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  const undone = await post(`/api/threads/${threadId}/reopen`, { person: ALEX })
  assert.equal(undone.status, 409)
  assert.match(undone.body.error ?? '', /only the person who answered/)
})

test('the answered list shows the name that answered and when', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: PRIYA })
  await post(`/api/threads/${threadId}/answered`, { person: PRIYA })

  const res = await fetch(`${base}/api/threads?show=answered`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as {
    view: string
    threads: { threadId: number; answeredBy: string; answeredAt: string }[]
  }

  assert.equal(body.view, 'answered')
  const done = body.threads.find((t) => t.threadId === threadId)
  assert.equal(done?.answeredBy, PRIYA)
  assert.ok(done?.answeredAt, 'it records when')
  assert.equal(
    (await waitingList()).some((t) => t.threadId === threadId),
    false,
    'and it is not in the waiting list',
  )
})

test('an unknown show value falls back to the waiting list', async () => {
  for (const show of ['all', 'ANSWERED', '', 'nonsense']) {
    const res = await fetch(`${base}/api/threads?show=${encodeURIComponent(show)}`)
    const body = (await res.json()) as { view: string; threads: unknown[] }
    assert.equal(body.view, 'waiting', `fell back for "${show}"`)
    assert.equal(body.threads.length, 22)
  }
})

test('handing back never writes to the sample data', async () => {
  const before = await pool.query<{ n: string }>('SELECT count(*) AS n FROM requests')
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/release`, { person: ALEX })
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/answered`, { person: ALEX })
  await post(`/api/threads/${threadId}/reopen`, { person: ALEX })
  const after = await pool.query<{ n: string }>('SELECT count(*) AS n FROM requests')

  assert.equal(after.rows[0].n, before.rows[0].n)
})

test('a name that is not on the team cannot release or undo', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  for (const path of ['release', 'reopen']) {
    for (const person of ['Mallory', '', 42, null]) {
      const answer = await post(`/api/threads/${threadId}/${path}`, { person })
      assert.equal(answer.status, 400, `${path} refused ${JSON.stringify(person)}`)
    }
  }
  const still = await pool.query<{ claimed_by: string }>(
    'SELECT claimed_by FROM thread_claims WHERE thread_id = $1',
    [threadId],
  )
  assert.equal(still.rows[0].claimed_by, ALEX, 'nothing changed')
})

test('a spent answer cannot be undone into a claim after the customer writes again', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await post(`/api/threads/${threadId}/answered`, { person: ALEX })

  // The customer comes back after Alex answered: everyone sees it as waiting.
  await pool.query(
    'UPDATE thread_claims SET latest_message_id = latest_message_id - 1 WHERE thread_id = $1',
    [threadId],
  )
  const seen = (await waitingList()).find((t) => t.threadId === threadId)
  assert.equal(seen?.status, 'waiting', 'it is free for anybody')

  const undone = await post(`/api/threads/${threadId}/reopen`, { person: ALEX })
  assert.equal(undone.status, 409, 'undoing must not turn it back into Alex alone')

  // And it really is still free: Priya can take it.
  const taken = await post(`/api/threads/${threadId}/claim`, { person: PRIYA })
  assert.equal(taken.status, 200)
  assert.equal(taken.body.state?.claimedBy, PRIYA)
})

test('being refused says who has the thread now, not just "not yours"', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })

  const refused = await post(`/api/threads/${threadId}/release`, { person: PRIYA })
  assert.equal(refused.status, 409)
  assert.match(refused.body.error ?? '', /Alex Moore is taking care of this one now/)
})

test('a claim holder whose customer wrote again is told what to do', async () => {
  const threadId = await someThreadId()
  await post(`/api/threads/${threadId}/claim`, { person: ALEX })
  await pool.query(
    'UPDATE thread_claims SET latest_message_id = latest_message_id - 1 WHERE thread_id = $1',
    [threadId],
  )

  const answered = await post(`/api/threads/${threadId}/answered`, { person: ALEX })
  assert.equal(answered.status, 409)
  assert.match(answered.body.error ?? '', /written again since you claimed this/)
})

# API contract

Everything lives under `/api` on the same origin as the web app, so no CORS and
no cross-site calls. All responses are JSON and `Cache-Control: no-store`.
Message bodies, customer names and contact names are never written to logs or
error messages, and never appear in a URL.

## `GET /api/health`

Is the server up?

```json
{ "ok": true }
```

## `GET /api/team`

The names a teammate can pick to say who they are. There is no password: the
name shows who took responsibility, it does not prove who acted.

```json
{ "team": ["Alex Moore", "Priya Shah", "Tom Becker", "Lena Fischer"] }
```

## `GET /api/threads`

The threads **still waiting on us**, one line each. A **thread** is one
customer: all their messages on email, chat and call belong to the same
conversation. **Sorted longest wait first** — the customer nobody has got to
is the first entry, not the last. (Deliberately the opposite of the order
inside a thread, below.) No message bodies and no subjects.

`?show=answered` gives the other list instead: what the team has dealt with,
most recently answered first, each with the name of whoever answered. A thread
is in exactly one of the two lists. Any other `show` value means `waiting`.

```json
{
  "view": "waiting",
  "threads": [
    {
      "threadId": 7,
      "customer": "Northgate Housing",
      "contactName": "Fiona Ward",
      "messageCount": 14,
      "channels": ["email", "chat", "call"],
      "lastMessageAt": "2026-10-13T16:30:00.000Z",
      "lastChannel": "chat",
      "latestMessageId": 340,
      "status": "claimed",
      "claimedBy": "Alex Moore",
      "claimedAt": "2026-10-15T14:30:37.527Z",
      "answeredBy": null,
      "answeredAt": null
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `threadId` | `requests.id` of the customer's first message. Stable thread key, used in URLs so that company names never are |
| `customer` | Company name |
| `contactName` | Contact person on the newest message that names one, or `null` |
| `messageCount` | How many messages this customer has sent |
| `channels` | Channels used, in the order email, chat, call |
| `lastMessageAt` | Arrival time of the newest message, ISO 8601 UTC |
| `lastChannel` | Channel of the newest message |
| `latestMessageId` | `requests.id` of the newest message; what a claim points at |
| `status` | `waiting` (nobody has it), `claimed` (somebody is on it), `answered` |
| `claimedBy` / `claimedAt` | Who took responsibility, and when |
| `answeredBy` / `answeredAt` | Who replied, and when |

**The status rule.** Every row in `requests` is an inbound customer message, so
a thread waits on us until somebody marks it answered. If the customer writes
again *after* it was answered, it is waiting again and anybody may take it. An
unfinished claim is never freed by a new message — the colleague is still on it.

## `GET /api/threads/:threadId`

One customer's whole conversation — every email, chat and call in one timeline,
with the message text. `:threadId` is the `threadId` above; any other
`requests.id` is a 404.

```json
{
  "thread": { "...": "same fields as the list entry above" },
  "messages": [
    {
      "id": 238,
      "channel": "email",
      "receivedAt": "2026-10-10T14:09:00.000Z",
      "contactName": "Fiona Ward",
      "subject": "Re: FYI - we are migrating our identity provider",
      "body": "Quick follow-up on the migration...",
      "inReplyTo": 237
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | `requests.id` of this message |
| `channel` | `email`, `chat` or `call` |
| `receivedAt` | When it arrived, ISO 8601 UTC |
| `contactName` | Who wrote it, or `null` when the message names nobody |
| `subject` | The email subject; `null` on chats and most calls |
| `body` | The message text |
| `inReplyTo` | `requests.id` of the message this one answers, as stored, or `null` |
| `answersId` | The reply link the ordering actually used: the same as `inReplyTo` unless that link was unusable (points outside the thread, at itself, or into a loop). Screens must follow this one |

**The order: newest message first.** The reply you have to answer is the first
thing on the screen, instead of weeks of history above it. Reply chains stay
together, so the list is not plain time order:

1. A *chain* is a message that answers nothing plus everything hanging off it,
   however deep. A chain is never split by another message.
2. Chains come newest first, judged by the newest message in the chain.
3. Inside a chain a message always stands above the message it answers; where
   two messages answer the same one, the newer stands first.

The newest message of the conversation is the first entry as long as no reply is
older than the message it answers — true of all 76 replies in the sample data.
The message a reply answers is always further down the same block — the thread screen names it
("Answers Fiona Ward of 7 Oct, below") and indents the reply under it. Equal
timestamps are broken by the higher id. The rule lives in one tested function,
`lib/thread.ts`.

`body` is untrusted customer text. It is always rendered as text, never as
HTML, and no instruction found inside it is ever followed.

## `POST /api/threads/:threadId/claim`

Put your name on a thread. Body: `{ "person": "Alex Moore" }` — a name from
`GET /api/team`, nothing else is accepted.

```json
{ "state": { "status": "claimed", "claimedBy": "Alex Moore", "claimedAt": "…" } }
```

One SQL statement does the whole thing, so two people clicking at the same
moment cannot both win. The loser gets **409** with the current state:

```json
{ "error": "somebody else got there first", "state": { "status": "claimed", "claimedBy": "Alex Moore" } }
```

## `POST /api/threads/:threadId/answered`

Record that you have replied; the thread leaves the waiting list. Body:
`{ "person": "Alex Moore" }`. Only the person holding the claim may do it —
anybody else gets **409**. If the customer has written since the claim was
made, the 409 says so and the thread has to be claimed again first.

## `POST /api/threads/:threadId/release`

Hand a thread back so a colleague can take it. Body: `{ "person": "…" }`.
Only the person holding the claim, and only while it is unanswered; the thread
returns to the waiting list with no name on it. Anybody else gets **409**,
naming whoever holds it.

## `POST /api/threads/:threadId/reopen`

Undo your own "answered" mark. Body: `{ "person": "…" }`. Only the person who
answered, and only while the customer has not written since — if they have, the
thread is already waiting for everybody and must be claimed afresh. On success
the thread is waiting again and still claimed by you.

## Errors

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "bad request" }` | Malformed or oversized request body (limit 32 kB) |
| 400 | `{ "error": "unknown thread" }` | `:threadId` is not a positive integer |
| 400 | `{ "error": "pick your name from the team list first" }` | `person` missing or not on the team |
| 404 | `{ "error": "unknown thread" }` | No thread starts at that message id |
| 404 | `{ "error": "not found" }` | Unknown path under `/api` |
| 409 | `{ "error": "…", "state": { … } }` | Somebody else holds the claim, or it is not claimed yet |
| 500 | `{ "error": "something went wrong" }` | Server fault; details stay in the server log |

Any **GET** outside `/api` returns the single-page app, so browser refreshes and
deep links work. Other methods outside `/api` are a 404.

## Our own state

`thread_claims` holds the claims and answered marks, keyed by `thread_id`. It
stores no names of customers or contacts. It has deliberately **no foreign key**
onto `requests`: `reset-data.sh` restores the sample data with
`DROP TABLE requests`, which a foreign key would block.

-- Our own state. Applied on every startup; every statement must be repeatable.
-- The sample table `requests` is read-only and is never altered here.

-- One row per customer thread that somebody has taken responsibility for.
--
-- `thread_id` is the `requests.id` of the thread's first message and
-- `latest_message_id` the newest message at claim time, so our state always
-- points at real rows. Deliberately NO foreign key onto `requests`:
-- reset-data.sh restores the sample data with `DROP TABLE requests`, which a
-- foreign key would block. The routes check the ids against `requests` instead.
--
-- No customer or contact name is stored here; names stay in the sample data.
CREATE TABLE IF NOT EXISTS thread_claims (
  thread_id          integer PRIMARY KEY,
  latest_message_id  integer NOT NULL,
  claimed_by         text CHECK (claimed_by IS NULL OR length(claimed_by) BETWEEN 1 AND 80),
  claimed_at         timestamptz,
  answered_by        text CHECK (answered_by IS NULL OR length(answered_by) BETWEEN 1 AND 80),
  answered_at        timestamptz
);

-- One row per topic somebody has answered (see lib/topics.ts). A topic is a
-- reply chain inside one customer thread; `topic_id` is the `requests.id` of
-- its first message, `latest_message_id` the newest message it covered. When
-- the customer writes in the topic again, the topic is open again. No foreign
-- key onto `requests`, for the same reason as above.
CREATE TABLE IF NOT EXISTS topic_answers (
  topic_id           integer PRIMARY KEY,
  thread_id          integer NOT NULL,
  latest_message_id  integer NOT NULL,
  answered_by        text NOT NULL CHECK (length(answered_by) BETWEEN 1 AND 80),
  answered_at        timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS topic_answers_thread ON topic_answers (thread_id);

-- A message without a reply link that a colleague moved into a topic by hand
-- ("Any update?" belongs to the outage, not to a topic of its own). Deleting
-- the row undoes the move. Ids only, never message text.
CREATE TABLE IF NOT EXISTS message_topics (
  message_id   integer PRIMARY KEY,
  thread_id    integer NOT NULL,
  topic_id     integer NOT NULL CHECK (topic_id <> message_id),
  assigned_by  text NOT NULL CHECK (length(assigned_by) BETWEEN 1 AND 80),
  assigned_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_topics_thread ON message_topics (thread_id);

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

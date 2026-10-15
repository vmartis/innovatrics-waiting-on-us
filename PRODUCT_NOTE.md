# USERS

**Primary user: the teammate who answers customers.** They are the main user of
the application — the person who actually opens it to do their work.

**Their job:** find a customer request that is still waiting on us, take
responsibility for it, reply, and record that it has been answered.

**How they do it today:** they ask the triager what needs a reply. The triager
reads email, chat and call notes and copies the important ones into a
spreadsheet by hand.

**What it costs:** "the team still asks me what needs a reply and customers
sometimes hear from two of us." Every Monday the triager spends an hour working
out what is waiting.

**Other users not in focus:**
- *The triager* (the person speaking in README.md) — they read the same waiting
  list as everyone else, but get no screen of their own.
- *The team as an anonymous group* — there is no nameless shared board; every
  claimed item carries a person's name.

**Assumption:** a customer thread is "waiting on us" when the newest message in
it came from the customer. README.md leaves this to us; it is a guess about the
data and it is the main thing that could be wrong.

**Assumption:** all 22 customers and 340 messages are one shared team inbox —
there are no separate teams or tenants whose data must be kept apart.

**Decided (14:26):** a teammate identifies themselves by picking their name
from a short list — no password. That is enough to stop two people replying to
the same customer, which is the pain in README.md. It is not proof of who
acted: anybody using the app can pick any name. A real login is optional item
N8 in PLAN.md and is not built.

# WHAT WE ARE GOING TO BUILD

One screen where a teammate sees every customer thread still waiting on us, puts
their name on one so nobody doubles up, and reads the whole conversation across
email, chat and call before replying.

1. **Open the waiting list** and see which customer threads still need a reply.
2. **Claim one** — your name goes on it, so no colleague starts the same reply.
3. **Open the thread**, read every message from that customer across all three
   channels in time order, then mark it answered once you have replied.

**Works with:** the Postgres database `app`, table `requests` — 340 real inbound
messages, 22 customers, three channels (`email`, `chat`, `call`), reply chains
via `in_reply_to` — read only, never changed. Our own tables hold the claims and
the answered marks and point at `requests.id`. Sensitive data is protected by
keeping it inside the app: customer names, contact names and message bodies never
go into logs or error messages, message text is always shown as plain text and
never as HTML, and the screens show only the fields this workflow needs.

**How we will know it helps:** a teammate can go from opening the app to having
their name on a waiting thread in under a minute without asking anyone, and no
thread ever shows two owners.

# WHAT IS DELIBERATELY OMITTED

- **A triager-only screen.** We build for the teammate who replies; the triager
  reads the same waiting list, so a second screen earns little in this timebox.
- **An anonymous shared board.** Without a name on each item we would bring back
  the exact pain in README.md — "customers sometimes hear from two of us".
- **Auto-hiding non-requests.** Roughly a third of the 340 rows are "got it,
  cheers" or internal call notes, but silently hiding things loses things, and we
  would be trusting a guess nobody can see or correct.
- **Changing the sample data.** The `requests` table is the assignment's real
  inbox data and is restored by `reset-data.sh`, so our own state lives in
  separate tables that point at it.
- **Writing customer messages into the database.** The app never inserts, edits
  or imports rows of customer data; it only reads the inbox it is given and
  writes its own claims and answered marks. Feeding new messages in is outside
  the scope of the assignment.
- **Reports and charts.** Volume by channel and response-time graphs look
  impressive but do not help a teammate reply to the customer in front of them.

# OTHER CONSIDERED APPROACH

**Use an existing issue-tracking system such as Jira and customise it through
configuration or plugins**, instead of building anything.

**Why not:** README.md rules it out directly — "I do not want another
project-management system that everybody has to maintain."

**When it would be better:** if the team already worked in such a tool every day,
or if this work grew past "reply to a customer" into multi-step projects that
genuinely need workflows, permissions and an audit trail.

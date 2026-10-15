# Your assignment

> "Customer requests arrive through email, chat and calls. I copy the important
> ones into a spreadsheet, but the team still asks me what needs a reply and
> customers sometimes hear from two of us. Every Monday I spend an hour working
> out what is waiting on us. I want the team to see what needs attention and for
> one person to take responsibility for the next step. I do not want another
> project-management system that everybody has to maintain."

## What you have

**Postgres**, database `app`, table `requests` — 80 real inbound messages from
three channels. Connect with `psql app`.

| Column | |
|---|---|
| `id` | |
| `customer` | company name |
| `contact_name` | may be empty |
| `channel` | `email`, `chat` or `call` |
| `received_at` | when it arrived |
| `subject` | emails only |
| `body` | the message |
| `in_reply_to` | set when this message follows an earlier one |

There is deliberately **no status, owner or priority column**. What states exist,
and whether they exist at all, is your decision.

The data is real inbox data: some messages are vague, some customers appear
twice through different channels, some threads are being chased, and some
messages are not requests at all.

## Working here

Open a terminal (it opens by itself, or press Ctrl+`) and type **`claude`** to
start Claude Code. That is your coding agent for this exercise — it runs here,
on this machine, with access to this repo and the sample data.

- `claude` — start Claude Code in the terminal.
- `./deploy.sh` — deploy your app. Run it as often as you like.
- `start.sh` — how your app starts. Any language or framework; just listen on
  port 3000 and stay in the foreground.
- `reset-data.sh` — restore the sample data. Your code is never touched.

Claude Code will not stop to ask you to approve each file it opens or command it
runs. This machine is yours and it is disposable, so the approving is not the
work. Read what it did.

Your work is auto-committed every three minutes.

## Deliverables

A live URL, this repo, a one-page product note, and a one-page written close.

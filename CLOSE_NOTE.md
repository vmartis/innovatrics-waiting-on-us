# WHAT A USER CAN DO NOW

Live at **https://hiring-viktormartis-app.biometricshouse.com**. Everything below was run against it at 16:20.

- **See what is waiting on us.** 22 customer threads, **longest wait at the top** — Copperfield Legal at "5 days" in red, Northgate Housing at "23 hours" at the bottom. Each row shows the channels used, how many messages, and the status.
- **Say who you are.** Pick your name from the team list in the header (Alex Moore, Priya Shah, Tom Becker, Lena Fischer). No password.
- **See the size of the job at a glance.** The header says how many threads are waiting, on every screen.
- **Find one customer by typing.** "meri" → the two Meridians, "LEGAL" → both legal firms, "novotna" → Consolidated Rail. Case, accents and word order do not matter; the contact person is searchable too.
- **Show only your own pile.** One toggle narrows the list to the threads you have claimed.
- **Claim a thread so nobody doubles up.** Your name goes on it; a colleague trying the same one is refused (409) and told who has it. You can claim straight from the list row and land in the messages in one click, or click anywhere in a row to just read it.
- **Read the whole customer story.** Every email, chat and call in one timeline — Northgate Housing shows 14 messages across all three channels — **newest message first**, with replies kept next to the message they answer (4 of those 14).
- **Hand work back.** Release a thread you cannot finish and a colleague can take it (tested: release 200 → colleague claims 200).
- **Mark it answered, and undo if you were wrong.** Answered threads leave the waiting list. A second list shows what the team answered and by whom ("Northgate Housing by Priya Shah"). Only the person who answered can undo it — anyone else gets refused.

The sample data is never written to: `requests` still holds its 340 rows after all of the above.

# WHAT I CHANGED AFTER TRYING IT MYSELF

- **Reading a thread.** Before: oldest message first, so on a 14-message customer you scrolled past weeks of history to find what they just asked. After: newest first. You read the question you owe an answer to immediately. *(You asked for this at 14:44.)*
- **Marking answered.** Before: one click took a thread off the whole team's list with no way back — a misclick meant a customer silently never got a reply. After: it asks "Have you replied to X?", and you can undo your own mark.
- **Opening a thread.** Before: only the customer name was clickable, so you had to aim at a short piece of text. After: clicking anywhere in the row opens it, and the name is still a real link so middle-click still opens a new tab. *(You asked for this at 15:05.)*
- **The order of the list.** Before: newest first, so the customer who had waited longest sat at the bottom and was easiest to keep ignoring. After: longest wait at the top, with the wait in plain words. *(You asked for this at 15:12.)*

# WHAT IS STILL ROUGH

- **No login, and that now costs more than it did.** A name shows who took a thread; it does not prove it. Since the hand-back feature, anyone who can reach the app can strip a colleague's claim or erase an answered record. The app also listens on all network interfaces — I tried loopback only and the live URL immediately returned 502, because the tunnel reaches this container from outside. Both are recorded (DECISIONS.md 15:33, 14:50). The fix is PLAN.md – N8.
- **Nobody has ever clicked this app.** There is no browser on this machine. The rules are covered by 124 passing tests and I ran them against the live data, but the clicking itself — the search box, the toggles, the claim button, toasts — was checked by rendering components off-screen and by reading the code. One pass in a real browser is the most valuable thing left.
- **Search misses a second contact.** It only matches the contact shown on a row. Consolidated Rail has written as both Eva Novotná and Piotr Zieliński, so "zielinski" finds nothing. Open in FRICTION.md (16:01).
- **No history behind a claim.** Release and undo overwrite the single row we keep, so "who answered this customer last week" can be lost. Accepted for this timebox.
- **Small things accepted from reviews.** The waiting time does not tick while a tab sits open; "Only mine" and a typed search reset when you come back from a thread; the timeline walk is recursive (safe at 21 messages, with a 500-message guard on the query).
- **Nothing is half-done.** The working tree is clean and all work is on `main`. **Nothing is pushed anywhere — this repo has no git remote.**

# WHAT IT COULD DO NEXT (WITH ONE MORE HOUR)

No MVP slices are left; all five are ticked. From the "If time allows" table, by priority:

- **N14** – a properly responsive, better-looking app, so it works on a phone, not just a laptop. 25 min. *(PLAN.md – N14, needs your OK and a word on which screen sizes matter.)*
- **N6** – warn when the same customer has also written on another channel. 15 min. *(PLAN.md – N6)*
- **N7** – mark a message "not a request" by hand, so "got it, cheers" stops cluttering the list. 12 min. *(PLAN.md – N7, needs your OK.)*
- **N11** – write down what you actually replied and how. 20 min. *(PLAN.md – N11, needs your OK.)*
- **N8** – sign in with a user name and password, so a name is proof. 35 min. *(PLAN.md – N8, needs your OK.)*
- **N9, N13, N12, N10** – roles, then a manager who can reply, filter every request, and see per-person numbers. 15 + 8 + 20 + 20 min, in that order; each needs the one before it. *(PLAN.md – N9, N13, N12, N10, all need your OK.)*
- **P1 and P2** – no user value: splitting the inbox page and the schema file so several of the above can be built at the same time. 18 min together, worth it only before building three or more of them. *(PLAN.md – P1, P2)*

**Fits in one hour:** N8 (35 min) plus N6 (15 min) — the security gap and the last workflow gap. Or N14 plus N6 (40 min) if you would rather have the visual pass. The manager chain (N9 → N13 → N12 → N10) is 63 minutes and does not fit.

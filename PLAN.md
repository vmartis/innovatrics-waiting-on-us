# PLAN

Now: – wrapped up at 16:16. Nothing in progress, working tree clean, 124/124 tests green, deployed and checked. · Next: **P9, the close note** · Elapsed: 2:37 of 3:00 (start 13:39 UTC)

**Done:** the whole MVP (S1–S5) plus five optional items (N5, N2, N3, N1, N4) and both friction fixes that were still open at the time (F1, F2). The main workflow was walked once on the live URL at 16:16: 22 waiting, longest wait first → claim as Alex → a colleague refused (409) → 11 messages across all three channels, newest first → marked answered → 21 waiting and the answered list names Alex. `requests` still holds its 340 rows.

**Not done, and why:** the two enabling refactors P1 and P2 (no user value; only worth paying for before building three or more list items). N6 (cross-channel warning, 15 min) — ran out of window. N14 (responsive/visual pass) — needs you to say which screen sizes matter. N7 and N8–N13 all need your OK, because they sit outside PRODUCT_NOTE.md.

**Known gaps, written down rather than hidden:** no login, so a name shows who took a thread but does not prove it — and since S5 anyone who can reach the app can strip a colleague's claim (DECISIONS.md 15:33, fixed by N8). One open friction: search only matches the contact shown on a row, so a second contact at the same company is not findable. And no part of the browser behaviour was ever clicked by a human or a machine — there is no browser on this box; the shared rules are unit-tested and were run against live data, the wiring was reviewed by reading.

Milestones: product note +0:20 (13:59) · main workflow live +1:30 (**15:09**) · N-items stop +2:35 (16:14) · close note +3:00 (16:39)

## MVP

| # | Wave | Slice (what the user can do after it) | Depends on | Touches (files/areas) | Done when (check) | Min | ✓ |
|---|---|---|---|---|---|---|---|
| S1 | W0 | Open the live URL and see the app shell with a header and one page listing real customers read from Postgres | – | `package.json` (root, postinstall), `start.sh`, `server/index.ts`, `server/db.ts`, `server/schema.sql`, `web/` (Vite+shadcn init, `App.tsx`, shell, `pages/InboxPage.tsx` stub), `API.md` contract | `npm install && npm run build` succeeds, `./deploy.sh` prints "deployed", `curl /api/threads` returns JSON from `requests`, and the live URL shows the shell with real customer names | 25 | ☑ |
| S2 | W0 | Do the whole job, ugly: see threads waiting on us, say who you are, claim one, open it to read all its messages, mark it answered | S1 | `lib/waiting.ts`, `server/routes/threads.ts`, `server/routes/claims.ts`, `server/schema.sql` (claims table), `web/pages/InboxPage.tsx`, `web/pages/ThreadPage.tsx`, `web/lib/api.ts` | tests for the waiting rule and claim-once pass; on the live URL a claim shows my name, a second claim is refused, "answered" removes it from the list, and a reload keeps all of it | 25 | ☑ |
| S3 | W1 | Read the full customer story properly: every email, chat and call in one timeline with channel badges, subjects and who wrote when | S2 | `lib/thread.ts`, `web/pages/ThreadPage.tsx`, `web/components/MessageList.tsx` | test: messages from all three channels for one customer come back in time order with replies attached; on the live URL a thread shows all channels with badges and nothing rendered as HTML | 20 | ☑ |
| S4 | W1 | Trust the list: proper table with status badges, skeleton while loading, friendly empty state, visible errors, toast on claim | S2 | `web/pages/InboxPage.tsx`, `web/components/` (Skeleton/EmptyState/ErrorState) | on the live URL: loading shows skeletons, an empty list shows a friendly message, a forced API failure shows an error not a blank page, and claiming shows a toast | 15 | ☑ |
| S5 | W2 | Hand work back: release a claim you cannot finish, and see who answered a thread and when | S3, S4 | `server/routes/claims.ts`, `web/pages/ThreadPage.tsx`, `web/pages/InboxPage.tsx` | test: release puts the thread back in the waiting list; on the live URL I claim, release, and a colleague's name can then take it; answered threads show the name that answered | 15 | ☑ |

Budget 100 min · W0 sequential 50 min · W1 in parallel 20 min · W2 15 min → main workflow live after S2 at about **14:45**, 24 min before the +1:30 deadline.

Parallel saves: about 15 min (S3 and S4 together take 20 min instead of 35).

## If time allows (after MVP)

Grouped into **waves**. Everything in one wave can be built at the same time — the items do not depend on each other and **no two of them touch the same file**, schema file, route file, `package.json`, `start.sh` or build file. So `/slice N5 N2 N3` is safe; mixing waves is not.

| Wave | Prio | # | Item (what the user gains) | Why not now | Depends on | Touches (files/areas) | Min | ✓ |
|---|---|---|---|---|---|---|---|---|
| – | – | F1 | Read a customer's conversation newest message first, so the reply you owe is the first thing on screen *(FRICTION.md 14:44)* | — already built | S3 | `lib/thread.ts`, `web/components/MessageList.tsx` | 0 | ☑ done in S3 |
| – | – | F2 | Undo a wrong "answered" mark instead of needing SQL *(FRICTION.md 14:44)* | — already built, with limits: only the person who answered, and not once the customer has written again | S5 | `server/routes/claims.ts`, `web/pages/ThreadPage.tsx` | 0 | ☑ done in S5 |
| W3 | – | P1 | *(no user value — an enabling step)* Split `InboxPage.tsx` into `components/inbox/ThreadTable.tsx`, `InboxToolbar.tsx`, `InboxStates.tsx`. Behaviour identical | Five list items below all edit `InboxPage.tsx` today, so they can only be built one at a time | S5 | `web/pages/InboxPage.tsx`, `web/components/inbox/` (new) | 10 | ☐ |
| W3 | – | P2 | *(no user value — an enabling step)* Replace `server/schema.sql` with `server/schema/001_claims.sql`, `002_…` applied in order on startup | Four items below all add to `schema.sql`, so they serialise on one file. Numbered files let each add its own | S5 | `server/schema.sql` → `server/schema/`, `server/db.ts` | 8 | ☐ |
| W4 | ☑ | N5 | Take a thread with one click straight from the table row, and land on the message list right away. **The whole row is the target**, not just the customer name; the name stays a real link so middle-click still opens a new tab *(covers FRICTION.md 15:05)* | The slow path works, so this is speed, not a new ability | S5 | built without P1, so: `web/pages/InboxPage.tsx`, `web/App.tsx` (passes the picked name in) | 10 | ☑ done 15:44 |
| W4 | ☑ | N2 | Find one customer fast by typing their name instead of scanning 22 of them. Case, accents and word order do not matter; the contact person shown on the row is searchable too | Scanning is bearable at this size; search is pure convenience | S5 | built without P1, so: `lib/search.ts` (the tested rule), `web/pages/InboxPage.tsx`, `web/vite.config.ts` + `web/tsconfig.app.json` (the `@shared` alias) | 5 | ☑ done 16:02 |
| W4 | ☑ | N3 | See the number waiting in the header, so you know if the team is on top of it without reading the list | Decoration, not the job | S5 | `web/components/AppShell.tsx`, `web/components/WaitingCount.tsx` | 5 | ☑ done 15:44 |
| W10 | 4 | N14 | **Alone in its wave:** a visual pass touches every screen, so nothing can run beside it. A better-looking, properly responsive app: works on a phone and a narrow window as well as a laptop (the thread table has five columns and will squash), consistent spacing and type scale, and a visual pass over the screens so it reads as one product rather than assembled parts *(not in the note – needs my OK)* | You asked for it. Nothing here is broken — the screens already use one component kit and look tidy on a laptop, which is what PRODUCT_NOTE.md needs — so this is polish, and polish has no end unless we agree where it stops. Tell me the screen sizes you care about and I will scope it | S5 | `web/components/inbox/ThreadTable.tsx` (card layout under `sm`), `web/components/AppShell.tsx`, `web/pages/ThreadPage.tsx`, `web/index.css` | 25 | ☐ |
| W5 | ☑ | N1 | See how long each thread has been waiting ("5 days", red past three days) and the list sorted **longest wait at the top** *(covers FRICTION.md 15:12 and 14:44)* | Deliberately the opposite of the order inside a thread (F1): the list is "who has waited longest", a thread is "what did they just say" | S5 | built without P1, so: `lib/elapsed.ts` (new, tested), `lib/waiting.ts`, `web/pages/InboxPage.tsx` | 8 | ☑ done 16:10 |
| W5 | ☑ | N4 | Show only what I claimed, so I can work my own pile without distraction | Needs claiming to exist and be trusted first | S5 | built without P1, so: `lib/waiting.ts` (`onlyMine`), `web/pages/InboxPage.tsx` | 8 | ☑ done 16:10 |
| W5 | 5 | N6 | Be warned when the same customer has also written on another channel, so two of us do not reply to one problem | The real fix is one named owner, which S2 already gives; this catches the leftover case | S5 | `lib/thread.ts`, `web/pages/ThreadPage.tsx` | 15 | ☐ |
| W6 | 6 | N7 | Mark a message "not a request" by hand, so "got it, cheers" stops cluttering the list — visible and undoable, never automatic *(omitted in note – needs my OK)* | The note omits auto-hiding because it loses things; a manual, reversible mark is a different thing and needs your yes | S5, P1, P2 | `server/schema/003_not_a_request.sql`, `server/routes/notes.ts` (new), `web/components/inbox/ThreadTable.tsx` | 12 | ☐ |
| W6 | 7 | N11 | Write down what you actually replied and how you sent it, so the next person sees the answer and not just the word "answered". The app sends nothing itself *(not in the note – needs my OK)* | The note leaves sending replies out because this machine has no mail or chat connection; our own log is a different thing, and it stores new customer data | S5, P2 | `server/schema/004_replies.sql`, `server/routes/replies.ts` (new), `lib/replies.ts`, `web/pages/ThreadPage.tsx` | 20 | ☐ |
| W7 | 8 | N8 | Sign in with a user name and password, so a name on a thread is proof of who took it and not just a label anyone can pick *(not in the note – needs my OK)* | **Alone in its wave on purpose:** it changes the security model, `web/lib/api.ts` and every write path, so nothing may run beside it. Today anyone who reaches the app can strip a colleague's claim (DECISIONS.md 15:33) | S5, P2 | `server/schema/005_users.sql`, `server/routes/auth.ts`, `server/currentPerson.ts`, `lib/team.ts`, `web/pages/LoginPage.tsx`, `web/lib/api.ts` | 35 | ☐ |
| W8 | 9 | N9 | Say which role a person has — team member or manager — so later screens can show each role only what it needs *(not in the note – needs my OK)* | Alone in its wave: it adds a column every later item reads. PRODUCT_NOTE.md has one kind of user, so the note would have to change first | N8 | `server/schema/006_roles.sql`, `server/routes/people.ts`, `web/components/AppShell.tsx` | 15 | ☐ |
| W9 | 10 | N13 | Let a manager do the teammate's job too: claim, read, answer, hand back and undo, exactly as a team member can *(not in the note – needs my OK)* | Only real work once roles start restricting things | N9 | `server/currentPerson.ts`, `server/routes/claims.ts`, `web/pages/ThreadPage.tsx` | 8 | ☐ |
| W9 | 11 | N12 | Let a manager look at every request, waiting or answered, and narrow it down by date, status and who replied *(not in the note – needs my OK)* | A manager screen is exactly the second screen the note decided not to build | N9 | `lib/filters.ts`, `server/routes/managerThreads.ts` (new — **not** `routes/threads.ts`, so it does not collide), `web/pages/ManagerPage.tsx` | 20 | ☐ |
| W9 | 12 | N10 | Let a manager see how each team member is doing: threads claimed, threads answered, how long customers waited *(not in the note – needs my OK)* | The note omits reports, and this measures teammates rather than helping one reply | N9 | `lib/stats.ts`, `server/routes/stats.ts`, `web/pages/StatsPage.tsx` | 20 | ☐ |

**How to run a wave.** Give `/slice` the ids of one wave, e.g. `/slice N5 N2 N3` (W4, ~10 min instead of 20) or `/slice N13 N12 N10` (W9, ~20 min instead of 48). Mixing waves breaks the no-shared-file promise.

**The one seam the waves cannot avoid.** A new router has to be mounted in `server/app.ts`, and a new page in `web/src/App.tsx` — one line each, in files every item would otherwise share. Those two lines are **added when the branches are merged, not by the parallel workers**, so the workers never touch either file. Affects N7, N11, N12, N10.

**The two enabling steps are a bet, not a feature.** P1 and P2 cost 18 minutes and give the user nothing. They pay for themselves from roughly the third item onwards. **Building fewer than three more items? Skip them** and take items one at a time in priority order — each still works alone, it just touches `InboxPage.tsx` or `schema.sql` directly and cannot share a wave.

**Every FRICTION.md note is in this table.** Five notes — but three already had a row here, and in each case that row was higher up, so it kept the work and took on the friction wording rather than being listed twice:

| FRICTION.md note | Row here |
|---|---|
| 14:44 conversation newest first | F1 — built in S3 |
| 14:44 undo a wrong "answered" | F2 — built in S5 |
| 15:05 click anywhere in the row | **N5** |
| 15:12 list oldest first, longest wait on top | **N1** |
| 14:44 show how long each thread has waited | **N1** — the same item; it says both |

**Rule:** an N-item starts only when the whole MVP table is ticked, there are no open fixes in FRICTION.md with higher value, and there are at least (item minutes + 10) minutes left before +2:35 (16:14).

## Not now

From PRODUCT_NOTE.md, not built at all: a triager-only screen · an anonymous shared board with no names · automatic hiding of non-requests · any change to the `requests` sample data · reports and charts. Also out: sending replies from the app (this machine has no outbound mail or chat connection).

Identity is decided (S2, 14:26): a teammate picks their name from a short list, no password. It stops two people replying to the same customer; it does not stop anyone picking a colleague's name. A real login is optional item N8.

Login (N8), roles (N9), manager statistics (N10), the reply log (N11), the manager's filtered list (N12) and manager-can-also-reply (N13) are optional proposals only. All six are outside PRODUCT_NOTE.md, so none gets built before you say yes; N10 and N12 would need a line in the note first, because a manager screen is one of the things the note decided against.

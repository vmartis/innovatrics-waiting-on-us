---
name: slice
description: Build one slice (or a wave of independent slices in parallel) from PLAN.md end-to-end – tests, code, deploy, check, review, commit. Use as /slice (next one), /slice S2 or /slice S3 S4.
disable-model-invocation: true
---
Build the slice(s) named at the start of $ARGUMENTS (e.g. "S2" or "S3 S4") from PLAN.md, and only those.
Any text after the slice ids is my extra instruction or decision: follow it and record it in DECISIONS.md with my reason.
NO SLICE ID GIVEN (empty $ARGUMENTS, or it starts with text instead of an id): pick the next step yourself, the same way /status does –
read PLAN.md (status line, unticked slices, waves, dependencies), git log and git status. The next step is the first unticked slice
whose dependencies are done; if it is in a wave with other unticked, independent slices, take the whole wave (parallel mode).
If a slice is half-done ("Now:" set but not ticked), continue that one first. Tell me in one line which slice(s) you picked and why,
then go on without waiting. When the MVP table is fully ticked, look at the "If time allows" table: take the highest-priority
unticked N-item only if the rule under that table holds (no higher-value open fix in FRICTION.md, enough minutes left before +2:35);
items marked "needs my OK" – ask me first. If the rule does not hold or nothing is left, say so and suggest the top FRICTION.md fix,
/wrap-up, or improving the product (P6) instead. N-items are built exactly like slices (same steps 1–8).
PARALLEL MODE (more than one slice id): first check in PLAN.md that they are in the same wave, don't depend on each other
and don't touch the same files, model, schema, security config, package.json, start.sh or build files. If any check fails, say why
and build them one after another instead. Otherwise start one subagent per slice IN THE SAME MESSAGE, each in its own git
worktree and branch slice-<id> (use subagent worktree isolation if available, else `git worktree add`). Each subagent does
steps 1, 3 and 7 below for its slice only (no deploy, no PLAN.md/DECISIONS.md edits, no fixed host ports), and reports
branch, commit and test result. Then you merge the branches one at a time (`git merge --no-ff`), run all tests after each
merge (on a conflict or red test stop and ask me), remove the worktrees, and continue with steps 4–8 once for all slices together.
1) Restate in 2 plain sentences what the user can do after this slice and how we will check it ("Done when" in PLAN.md).
   If the slice is unclear or bigger than ~25 minutes, stop and propose how to split it.
2) Update the PLAN.md status line to "Now: <slice ids> (started HH:MM)".
3) Tests first for the logic, then the code. Run the tests and show the real result. Never skip or weaken a test.
4) Run ./deploy.sh and check the slice on the deployed app; show the request/URL and the response.
5) Use the reviewer agent on this slice's diff; fix every BLOCKER or MAJOR, re-run tests and deploy if you changed code.
   If the slice touched auth, input handling, data access or personal data, also use the security-reviewer agent.
6) Tick the slice in PLAN.md and update the status line (Now / Next / Elapsed). Add a DECISIONS.md row for any choice
   I should know about and explain it in one plain sentence.
7) Commit with a Conventional Commit (e.g. "feat(queue): sort pending cases by sla time left") and push it immediately with `git push`
   (`git push -u origin <branch>` if there is no upstream yet). Do not ask me – pushing is always part of a slice. If the repo has no
   remote, say so once and continue without pushing. If the push fails, show the error and the fix; never force push.
8) Report in plain English: what changed for the user, test and deploy result, review verdict, commit hash and push result,
   and in 2–3 sentences how I can try it myself now. Then stop and wait.
If stuck after 3 attempts: stop changing code and tell me what you tried, the exact error, your top 3 causes
and the cheapest check to tell them apart.

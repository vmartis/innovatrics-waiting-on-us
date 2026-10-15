---
name: wrap-up
description: Final 15–20 minutes – make the deployed state clean and true before the close note.
disable-model-invocation: true
---
1) Start nothing new. Run all tests; if something is red, show it and ask me (fix only if it takes < 5 min, otherwise revert that change with git revert).
2) Commit and push everything that works. Unfinished work goes to a separate branch (push it too), never into the main branch.
3) Run ./deploy.sh and check the main workflow once on the deployed app; show the result.
4) Update PLAN.md status: what is done, what is not.
5) Tell me the last completed step (last ticked slice or N-item, committed and deployed) and that the next prompt is P9 (close note).
   Do not write CLOSE_NOTE.md here.

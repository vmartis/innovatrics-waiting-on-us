#!/usr/bin/env bash
# PreToolUse guard without jq: blocks skipping/disabling tests and destructive git. Exit 2 = block.
input=$(cat)
if echo "$input" | grep -Eq '"file_path" *: *"[^"]*\.md"'; then exit 0; fi
if echo "$input" | grep -Eq -- '-x test|skipTests|--no-verify|push (--force|-f)|reset --hard|rm -rf /|@Disabled|@Ignore|\b(it|describe|test)\.skip\(|\bxit\('; then
  echo "Blocked by guard.sh: do not skip/disable tests or rewrite history. Fix the cause or ask the human." >&2
  exit 2
fi
exit 0

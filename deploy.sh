#!/bin/bash
# Deploy the app. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")"
[ -f package.json ] && command -v npm >/dev/null && npm install --silent || true
sudo /usr/bin/systemctl restart candidate-app
sleep 1
if curl -fsS -o /dev/null http://127.0.0.1:3000/; then
  echo "deployed: app is responding on port 3000"
else
  echo "deploy FAILED -- recent logs:" >&2
  sudo /usr/bin/journalctl -u candidate-app -n 20 --no-pager >&2
  exit 1
fi

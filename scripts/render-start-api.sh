#!/usr/bin/env bash
# Start API + co-located worker. Render injects PORT; map it to API_PORT.
# Do not invoke pnpm here — free instances OOM if node_modules is reinstalled at boot.
set -euo pipefail
export PATH="${PWD}/node_modules/.bin:${PATH}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=192}"
export API_PORT="${PORT:-4000}"
export API_HOST="${API_HOST:-0.0.0.0}"

node --enable-source-maps apps/worker-node/dist/main.js &
WORKER_PID=$!

cleanup() {
  kill "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT TERM INT

node --enable-source-maps apps/api-node/dist/main.js &
API_PID=$!

wait -n "$API_PID" "$WORKER_PID"
STATUS=$?
cleanup
exit "$STATUS"

#!/usr/bin/env bash
# Next.js must bind to Render's PORT and run from apps/web (where .next lives).
set -euo pipefail
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=256}"
cd apps/web
NEXT_BIN="$(ls node_modules/.bin/next ../../node_modules/.bin/next 2>/dev/null | head -1 || true)"
if [[ -z "${NEXT_BIN}" ]]; then
  NEXT_BIN="$(find . ../../node_modules -path '*/.bin/next' 2>/dev/null | head -1 || true)"
fi
if [[ -z "${NEXT_BIN}" ]]; then
  echo "next binary not found in node_modules" >&2
  exit 1
fi
exec "${NEXT_BIN}" start -H 0.0.0.0 -p "${PORT:-3000}"

#!/usr/bin/env bash
# Run Prisma migrations before the API starts serving traffic.
set -euo pipefail
PRISMA_BIN="$(ls packages/db/node_modules/.bin/prisma node_modules/.bin/prisma 2>/dev/null | head -1 || true)"
if [[ -z "${PRISMA_BIN}" ]]; then
  PRISMA_BIN="$(find node_modules packages/db/node_modules -path '*/.bin/prisma' 2>/dev/null | head -1 || true)"
fi
if [[ -z "${PRISMA_BIN}" ]]; then
  echo "prisma binary not found in node_modules" >&2
  exit 1
fi
"${PRISMA_BIN}" migrate deploy --schema=packages/db/prisma/schema.prisma

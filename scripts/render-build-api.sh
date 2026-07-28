#!/usr/bin/env bash
# Build the Node API + worker for Render free web service.
set -euo pipefail
# Avoid corepack + packageManager(pnpm@11) on older Node images.
# Hoisted linker so Render uploads a real node_modules tree (not pnpm store symlinks).
# Render sets NODE_ENV=production which would skip prisma/typescript otherwise.
npm install -g pnpm@9.12.0
printf 'node-linker=hoisted\n' > .npmrc
pnpm install --frozen-lockfile --prod=false
pnpm db:generate
pnpm --filter @akp/api-node... build
pnpm --filter @akp/worker-node... build

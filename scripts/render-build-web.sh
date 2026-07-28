#!/usr/bin/env bash
# Build the Next.js web app for Render free web service.
set -euo pipefail
# Avoid corepack + packageManager(pnpm@11) on older Node images.
# Hoisted linker so Render uploads a real node_modules tree (not pnpm store symlinks).
npm install -g pnpm@9.12.0
printf 'node-linker=hoisted\n' > .npmrc
pnpm install --frozen-lockfile --prod=false
pnpm --filter @akp/web... build

#!/usr/bin/env bash
# Expose the local web app on a free public HTTPS URL (Cloudflare Quick Tunnel).
# Prerequisites: API on :4000, web on :3000, Postgres + Redis running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${ROOT}/.tools/cloudflared"

mkdir -p "${ROOT}/.tools"
if [[ ! -x "$BIN" ]]; then
  echo "Downloading cloudflared…"
  curl -fsSL -o "$BIN" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$BIN"
fi

echo "Starting tunnel → http://localhost:3000"
echo "Keep this terminal open. The public URL will appear below."
echo
exec "$BIN" tunnel --url http://localhost:3000 --protocol http2

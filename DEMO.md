# Live recruiter demo

**Public URL (Cloudflare Quick Tunnel):**  
https://red-launches-projectors-lid.trycloudflare.com

This is a free HTTPS tunnel to the app running on this machine (Next.js `:3000` → Fastify `:4000` → Postgres/Redis). Recruiters open the link in a browser — they do **not** install anything.

## Demo logins (seeded)

| Email | Password |
|--------|----------|
| `owner@acme.test` | `Password123!` |
| `member@acme.test` | `Password123!` |

Email/password works over the public link immediately.

## Google sign-in over the tunnel

Add these to the same Google OAuth client (Console → Credentials):

- **Authorized JavaScript origin:** `https://red-launches-projectors-lid.trycloudflare.com`
- **Authorized redirect URI:** `https://red-launches-projectors-lid.trycloudflare.com/api/auth/google/callback`

(Quick tunnels get a **new** hostname each restart — update Console when the URL changes.)

## Keep the demo online

Leave these running on this machine:

1. `pnpm docker:up` (Postgres + Redis)
2. `pnpm dev:api` (Fastify)
3. `pnpm dev:web` (Next.js)
4. Cloudflare tunnel (`./scripts/demo-tunnel.sh` or the running cloudflared process)

Sleeping the laptop or killing the tunnel takes the link offline.

## Restart a fresh public link

```bash
pnpm docker:up
pnpm dev:api    # terminal 1
pnpm dev:web    # terminal 2
./scripts/demo-tunnel.sh   # terminal 3 — copy the printed https://….trycloudflare.com URL
```

Then set `WEB_PUBLIC_URL` and add that origin to `CORS_ORIGINS` in `.env`, restart the API, and update Google Console if you need Google login on the new host.

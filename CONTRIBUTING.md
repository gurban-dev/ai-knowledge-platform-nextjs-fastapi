# Contributing

## Prerequisites
- Node.js ≥ 20.11
- pnpm ≥ 9
- Python ≥ 3.12 + [uv](https://docs.astral.sh/uv/)
- Docker (Postgres + Redis)

## Local setup
```bash
corepack enable
pnpm install
uv sync --all-packages
cp .env.example .env
pnpm docker:up
pnpm db:generate && pnpm db:deploy && pnpm db:seed   # Prisma (Node path / shared DB)
```

## Quality gates
```bash
# TypeScript
pnpm typecheck && pnpm lint && pnpm test

# Python
pnpm py:lint && pnpm py:typecheck && pnpm py:test

pnpm test:integration   # Node contract tests; requires TEST_DATABASE_URL
```

## Architecture rules
- Feature modules: `routes → services → repositories`
- Python composition root: FastAPI lifespan / `app.state.container`
- Node reference composition root: `apps/api-node/src/container.ts`
- HTTP contract (paths, bodies, `{ error: { code, message, statusCode, ... } }`) must stay identical
- Never store secrets in plaintext; use field encryption helpers
- Every tenant query must scope by `organizationId`

## Apps
| App | Command |
| --- | --- |
| API (Fastify — use for Google OAuth today) | `pnpm dev:api` |
| Web | `pnpm dev:web` |
| Worker (BullMQ) | `pnpm dev:worker` |
| Full local stack (Postgres/Redis + Fastify + web + worker) | `pnpm dev:stack` |
| API (Python / FastAPI — email-password ready; Google pending) | `pnpm py:api` |
| Worker (Python / arq) | `pnpm py:worker` |
| MCP | `pnpm --filter @akp/mcp dev` |

### Local Google sign-in

1. Google Cloud OAuth client: JS origin `http://localhost:3000`, redirect `http://localhost:3000/api/auth/google/callback`
2. Root `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WEB_PUBLIC_URL=http://localhost:3000`, `CORS_ORIGINS` includes that origin, `NEXT_PUBLIC_API_URL=http://localhost:4000`
3. Run Fastify (not FastAPI): `pnpm docker:up` then `pnpm dev:api` and `pnpm dev:web`

Migration details: `MIGRATION_NOTES.md`.

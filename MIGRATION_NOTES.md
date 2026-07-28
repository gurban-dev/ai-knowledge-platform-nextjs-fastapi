# Fastify → FastAPI migration notes
#
# Status: Phases 0–1 complete. Phase 2 in progress (email/password auth live).
# Node implementations preserved at apps/api-node and apps/worker-node as the
# contract source of truth until Python parity is verified.

## Layout

| Path | Role |
|------|------|
| `apps/api` | FastAPI (Python) — active target |
| `apps/worker` | arq worker (Python) — active target |
| `apps/api-node` | Former Fastify API — contract reference |
| `apps/worker-node` | Former BullMQ worker — contract reference |
| `packages/akp-*` | Shared Python packages (core, config, db, observability) |
| `packages/{core,config,db,...}` | Existing TypeScript packages (still used by web/mcp/node) |

## Queue choice: arq (not Celery)

We use **arq** with Redis as broker:

1. Fully async — matches FastAPI + async SQLAlchemy (no Celery prefork/gevent bridge).
2. Redis-native job model closest in spirit to BullMQ.
3. Lighter ops footprint for this monorepo’s three queues (ingest, webhook, maintenance).
4. Retry/backoff and concurrency map cleanly onto BullMQ’s `attempts` + exponential delay.

Celery remains a viable alternative if we later need multi-broker fan-out or a large
existing Celery ops footprint; for this migration, arq is the better default.

## Known deliberate deviations

None yet for Phase 0. Contract parity work starts in Phase 2 (routes/auth).

## Phase checklist

- [x] Phase 0 — Python project foundation
- [x] Phase 1 — Data model (SQLAlchemy + Alembic baseline from Prisma SQL)
- [ ] Phase 2 — API core (email/password auth ✅; Google OAuth / MFA / orgs / API keys pending)
- [ ] Phase 3 — Web integration check
- [ ] Phase 4 — Ingestion workers
- [ ] Phase 5 — Retrieval and chat
- [ ] Phase 6 — Evaluations, usage, cost
- [ ] Phase 7 — MCP, webhooks, teams, ACLs
- [ ] Phase 8 — Infra + docs cutover

## Phase 1 notes

- SQLAlchemy models live in `packages/akp-db` (34 tables, 25 enums).
- Alembic revision `0001_baseline` executes the concatenated Prisma migration SQL
  (`_baseline_prisma.sql`) for exact index/extension parity (HNSW + trigram GIN).
- Existing databases already migrated by Prisma should use `pnpm py:db:stamp`
  rather than `upgrade` to avoid re-running CREATE statements.

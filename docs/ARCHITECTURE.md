# Architecture

This document describes the system design, the reasoning behind key decisions, and the
conventions every contributor is expected to follow.

## Goals & non-functional requirements

- **Production-ready, not a prototype.** Every feature ships with UI/API, persistence,
  validation, tests, docs, error handling, logging, and monitoring.
- **Secure by default.** OWASP-aligned auth, MFA, least-privilege RBAC, document ACLs,
  tenant isolation (repository scoping + Postgres RLS), field encryption, prompt-injection
  guards, PII redaction, full audit trails (append-only).
- **Observable.** Structured logs, Prometheus metrics (HTTP + AI), distributed tracing,
  health probes, and SLO definitions.
- **Scalable & maintainable.** Stateless API, Redis-backed queues/rate limits, feature-based
  modules, provider failover, plan quotas and spend budgets.

## High-level topology

> **Migration in progress:** `apps/api` and `apps/worker` are being rebuilt in Python
> (FastAPI + arq). The Next.js web app is unchanged and continues to call the same HTTP
> contract. See `MIGRATION_NOTES.md`. Node reference implementations live at
> `apps/api-node` and `apps/worker-node` until cutover.

```
          ┌───────────┐        ┌──────────────────┐
Browser ─▶ │  Next.js  │ ─────▶ │  FastAPI  API    │ ─┬─▶ PostgreSQL + pgvector (+ RLS)
          │  (web)    │  REST  │  (apps/api)      │  │
          └───────────┘  /SSE  └──────────────────┘  ├─▶ Redis (cache, rate limit, arq)
                                        │             │
AI agents ─── MCP / API key ────────────┤             └─▶ arq workers (apps/worker)
                                        │                     │
                                   apps/mcp                   ├─ ingest / embed
                                                              ├─ webhook delivery
                                                              └─ retention sweep
                                              OpenAI / Anthropic / Fake (failover registry)
                                              Local FS or GCS object storage
```

### Background jobs: why arq (not Celery)

BullMQ is Redis-backed and async-friendly. **arq** was chosen over Celery because:

1. **Async-native** — workers use `async def` end-to-end, matching FastAPI + async SQLAlchemy.
2. **Redis-first** — same broker already required for rate limits/cache; no AMQP detour.
3. **Closer to BullMQ** — job retries, deferred execution, and named queues map cleanly.
4. **Lower ops surface** for three queues (ingest, webhook, maintenance).

Celery would be reconsidered only if we needed multi-broker topologies or an existing
Celery operations footprint.

## Packages

### TypeScript (web, MCP, Node reference)

- `@akp/core` — errors, Result, ids, RBAC, scopes, redaction, encryption, PII, prompt-guard
- `@akp/config` — Zod-validated env → typed `AppConfig`
- `@akp/observability` — pino, OTEL preload, Prometheus `AppMetrics`
- `@akp/db` — Prisma schema/migrations/client, vector helpers
- `@akp/ai` — providers, registry/failover, chunking, RRF fusion, grounding, prompts, pricing
- `@akp/storage` — local + GCS object storage adapters

### Python (API + worker)

- `akp-core` — error codes/envelope types, prefixed IDs (contract-compatible with `@akp/core`)
- `akp-config` — Pydantic Settings env validation (same variables as `@akp/config`)
- `akp-db` — SQLAlchemy 2.0 async + Alembic (+ pgvector)
- `akp-observability` — structlog (+ metrics in later phases)
- Managed with **uv** workspaces (`pyproject.toml` at repo root)

## API layering

```
routes (HTTP + Pydantic) → services (use-cases) → repositories (SQLAlchemy only)
```

Composition root: FastAPI lifespan / `app.state.container` (Python). Node reference:
`apps/api-node/src/container.ts`.

> During migration, treat `apps/api-node` Fastify route modules + Zod schemas as the
> HTTP contract source of truth. Python must match paths, bodies, status codes, and the
> `{ error: { code, message, statusCode, details?, requestId } }` envelope.

## AuthN / AuthZ

- Passwords: Argon2id
- Access JWT (15m) + opaque refresh with rotation + reuse detection
- MFA (TOTP, encrypted secret, recovery codes)
- API keys: hashed, scoped, optional IP allowlist + per-key rate limit
- Document ACLs at retrieval time (USER/TEAM/ROLE subjects)
- Postgres RLS via `SET LOCAL app.current_org_id`

## RAG pipeline

1. Embed query
2. Hybrid retrieve (pgvector ANN + trigram) → Reciprocal Rank Fusion
3. Filter by document ACL
4. Cross-encoder/lexical rerank
5. Grounding check + abstention threshold
6. Prompt-injection scan on user question
7. Generate with versioned prompt; store citations + provenance metadata

## Multi-tenancy & billing

Shared schema + `organizationId`. Entitlements via `subscriptions` (docs/members/keys).
Monthly spend tracked in `budget_periods` with hard-stop enforcement.

## Testing

- Unit: Vitest (services, ACL, crypto, AI helpers)
- Integration: Fastify `inject()` + real Postgres/Redis
- Web E2E: Playwright smoke

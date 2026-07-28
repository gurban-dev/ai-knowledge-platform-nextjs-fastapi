# AI Knowledge Automation Platform

## In plain English

Companies have lots of internal documents: policies, manuals, wikis, notes.
People waste time searching for answers, and generic AI chatbots often guess
wrong because they do not know that private content.

**This project is a secure workplace AI assistant for organizations.**

1. A team uploads their documents into the product.
2. The system learns from those documents (without exposing them publicly).
3. Employees ask questions in chat and get answers based on the company’s own
   knowledge, with citations back to the source.
4. Admins can see whether answers are trustworthy, how fast they are, and how
   much they cost.

Think of it as **ChatGPT for your company’s private knowledge**, but built
like real B2B software: logins, organizations, permissions, audit trails, and
monitoring, not a one-off demo.

### What you can do in the app

- Create an organization and sign in (email/password or Google)
- Upload documents into a knowledge library
- Search and chat over that knowledge with citations
- Review usage, cost, and quality signals

### Built with

- **Web (unchanged):** Next.js
- **API / Worker (migrating):** FastAPI + arq (Python); Node reference at `apps/api-node`, `apps/worker-node`
- **Data:** PostgreSQL + pgvector, Redis

## Status

| Phase | Scope | State |
|------:|-------|:-----:|
| 0–8 | Original TypeScript platform | ✅ Done |
| **P0** | Python foundation (uv, FastAPI, arq, compose, CI) | ✅ Done |
| **P1** | SQLAlchemy + Alembic = Prisma schema parity | ✅ Done |
| P2–P8 | FastAPI/arq feature parity + infra cutover | Pending |

See `MIGRATION_NOTES.md`.

---

# Applications

| Application | Path | Default Port | Description |

|-------------|------|--------------|-------------|

| API | `apps/api` | **4000** | REST API and business logic |

| Worker | `apps/worker` | — | arq background workers |

| Web | `apps/web` | **3000** | Next.js frontend |

| MCP *(optional)* | `apps/mcp` | **4100** | Model Context Protocol server |

---

# Getting Started

## Prerequisites

- Node.js 20+

- pnpm 9+

- Docker & Docker Compose

- PostgreSQL (or Docker)

- Redis (or Docker)

## Share a live demo (free public link)

**Current live URL:** [https://calculators-prepaid-around-gorgeous.trycloudflare.com](https://calculators-prepaid-around-gorgeous.trycloudflare.com)

With the app already running locally (`pnpm docker:up`, API on `:4000`, web on `:3000`),
you can publish a free HTTPS URL that recruiters can open in a browser:

```bash
./scripts/demo-tunnel.sh
```

The script prints a `https://….trycloudflare.com` link. Keep that terminal (and your
machine) running while people use the demo. Stopping the tunnel or sleeping the
computer takes the link offline, and restarting creates a new URL.

See `DEMO.md` for seeded login credentials and Google OAuth console values for the current host.

## Initial Setup

Run the following commands from the repository root:

```bash

corepack enable

pnpm install

cp .env.example .env

pnpm docker:up

pnpm db:generate

pnpm db:deploy

pnpm db:seed

```

### Seeded Development Credentials

| Email | Password |

|--------|----------|

| `owner@acme.test` | `Password123!` |

| `member@acme.test` | `Password123!` |

### Sign in with Google (optional)

Users can register and sign in with a Google account in addition to email + password.
The flow is disabled by default until credentials are configured.

**Security (production):** Authorization Code + PKCE (S256) for the redirect
callback path, plus Google Identity Services (GIS) button credentials verified
via JWKS. OAuth state is HMAC-signed and bound to the exact callback URL. MFA is
enforced for accounts that have it enabled.

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type **Web application**.

2. Add origins and redirect URIs for your environment:

| Environment | Authorized JavaScript origins | Authorized redirect URI |
|-------------|-------------------------------|-------------------------|
| Local | `http://localhost:3000` | `http://localhost:3000/api/auth/google/callback` |
| Production | `https://your-web-domain` | `https://your-web-domain/api/auth/google/callback` |

3. Ensure `WEB_PUBLIC_URL` (and the browser origin) match that web domain exactly —
   the API allowlists only `{WEB_PUBLIC_URL}/api/auth/google/callback`.

4. Put the values in your `.env` (then restart `pnpm dev` / redeploy):

```bash
WEB_PUBLIC_URL=http://localhost:3000   # or https://your-web-domain in production
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

5. Open `/login` or `/register` and click **Continue with Google** /
   **Sign up with Google**. An in-page modal opens with Google's account button;
   choosing an account creates (or signs into) your organization.

Without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, the button still opens the
modal and shows a clear configuration error. With credentials set, first-time
Google users get a new organization provisioned automatically; returning users
are signed straight in. A first Google sign-in for an email that already has a
password account links the two (Google must report the email as verified).
Accounts with MFA enabled are challenged after Google before a session is issued.

---

# Running the Development Environment

Start the complete development environment with a single command:

```bash

pnpm dev

```

This launches all development services concurrently using Turborepo.

Once the development environment has started successfully, the following services will be available:

| Service | URL |

|---------|-----|

| Web Application | [http://localhost:3000](http://localhost:3000) |

| REST API | [http://localhost:4000](http://localhost:4000) |

| API Documentation (Swagger) | [http://localhost:4000/docs](http://localhost:4000/docs) |

| MCP Server *(optional)* | [http://localhost:4100](http://localhost:4100) |

| BullMQ Worker | Background process (no HTTP endpoint) |

To stop all services, press:

```text

Ctrl+C

```

---

# Running Individual Services

If you only need to work on a single component, each application can be started independently.

| Service | Command |
|---------|---------|
| API (Python) | `pnpm py:api` |
| Worker (Python) | `pnpm py:worker` |
| API (Node reference) | `pnpm --filter @akp/api-node dev` |
| Worker (Node reference) | `pnpm --filter @akp/worker-node dev` |
| Web | `pnpm --filter @akp/web dev` |
| MCP *(optional)* | `pnpm --filter @akp/mcp dev` |

---

# Quality Gates

Before opening a pull request, run the project's quality checks.

```bash

pnpm typecheck

pnpm lint

pnpm test

pnpm test:integration

```

---

# License

See the [LICENSE](LICENSE) file.
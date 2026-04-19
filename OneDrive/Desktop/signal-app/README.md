# SIGNAL

Professional Intelligence Platform — a curated daily feed of professional news for AI, Finance, and Semiconductor professionals, with personalized "why it matters to you" insights based on the reader's role.

## Monorepo layout

```
signal-app/
├── frontend/   # Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
├── backend/    # Express + TypeScript + Drizzle ORM (PostgreSQL) + Redis
└── package.json  # npm workspaces
```

## Prerequisites

- Node.js >= 20
- npm >= 10
- (Later phases) PostgreSQL 15+, Redis 7+

## Setup

```bash
# Install all workspace deps
npm install

# Copy env files
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

## Development

Run both servers in parallel from the repo root:

```bash
npm run dev
```

- Frontend → http://localhost:3000
- Backend  → http://localhost:3001 (health: `GET /health`)

Or run individually:

```bash
npm run dev:frontend
npm run dev:backend
```

## Scripts (root)

| Script | Description |
| --- | --- |
| `npm run dev` | Start both dev servers in parallel |
| `npm run build` | Build both workspaces for production |
| `npm run lint` | Lint both workspaces |
| `npm run type-check` | TypeScript type-check both workspaces |

## Project overview

See [CLAUDE.md](./CLAUDE.md) for the authoritative project spec, tech stack, coding standards, and phase plan.

---

## Deployment

Production topology (Phase 8):

| Piece            | Host                      | Notes                                                       |
| ---------------- | ------------------------- | ----------------------------------------------------------- |
| Frontend         | Vercel                    | Root = `OneDrive/Desktop/signal-app/frontend`.              |
| Backend          | Railway                   | Built from `backend/Dockerfile`, port 3001, healthcheck `/health`. |
| PostgreSQL       | Railway                   | `DATABASE_URL` linked via Railway reference.                |
| Redis            | Railway                   | `REDIS_URL` linked via Railway reference.                   |
| Error monitoring | Sentry                    | `@sentry/node` (backend), `@sentry/nextjs` (frontend).      |
| Uptime           | UptimeRobot / BetterStack | Hits `GET /health` every 1–5 min. (deferred)                |
| Email            | SendGrid                  | (deferred — no domain yet)                                  |

### Environments

- `main` → production (Vercel production + Railway production service).
- PR branches → Vercel preview URLs.

### Deploy flow

```
PR → CI green → merge to main → Vercel + Railway auto-deploy → run smoke tests
```

```bash
SMOKE_BASE_URL=https://signal-app-production-cd33.up.railway.app \
  npm run smoke --workspace=backend
```

### Rollback

- **Frontend (Vercel):** Deployments → pick the last known-good deploy → Promote to Production. No rebuild required.
- **Backend (Railway):** Deployments → Redeploy the last green image, or push a revert commit to `main`.
- **Database:** use Railway's point-in-time restore to a new DB, verify, then swap `DATABASE_URL`. Never run destructive migrations without a fresh backup taken within the hour.
- **Emails:** unset `SENDGRID_API_KEY` on Railway to disable outbound delivery without redeploying code — the email queue fails soft (Phase 7 graceful degradation).

### Environment variable reference

**Frontend (Vercel project env)**

| Variable                         | Required | Notes                                          |
| -------------------------------- | -------- | ---------------------------------------------- |
| `NEXT_PUBLIC_API_URL`            | yes      | Backend base URL, e.g. the Railway public URL. No trailing slash. |
| `NEXT_PUBLIC_APP_URL`            | no       | Self URL, for email links and og:url.          |
| `NEXT_PUBLIC_SENTRY_DSN`         | no       | Enables Sentry in the browser + server bundle. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | no       | Defaults to `NODE_ENV`.                        |
| `SENTRY_ORG` / `SENTRY_PROJECT`  | no       | Only needed for source-map upload.             |
| `SENTRY_AUTH_TOKEN`              | no       | Source-map upload (build-time only).           |

`NEXT_PUBLIC_*` vars are baked in at **build time** — changing them in Vercel requires a redeploy.

**Backend (Railway service env)**

| Variable                    | Required | Notes                                                                   |
| --------------------------- | -------- | ----------------------------------------------------------------------- |
| `NODE_ENV`                  | yes      | `production` in prod.                                                   |
| `PORT`                      | no       | Defaults to `3001`.                                                     |
| `DATABASE_URL`              | yes      | Postgres connection string.                                             |
| `REDIS_URL`                 | no       | BullMQ + rate-limit backing. Unset = in-process sync email fallback.    |
| `JWT_SECRET`                | yes      | 64+ random chars.                                                       |
| `JWT_EXPIRES_IN`            | no       | Defaults to `7d`.                                                       |
| `FRONTEND_URL`              | yes      | Single origin fallback when `ALLOWED_ORIGINS` is unset.                 |
| `ALLOWED_ORIGINS`           | no       | Comma-separated allow-list. Takes precedence over `FRONTEND_URL`.       |
| `TRUST_PROXY`               | no       | Defaults to `1` (trust first proxy hop). Needed for correct client IPs. |
| `SENDGRID_API_KEY`          | no       | Unset = log-only email delivery (graceful degradation).                 |
| `SENDER_EMAIL`              | yes\*    | Required when SendGrid is enabled.                                      |
| `UNSUBSCRIBE_SECRET`        | yes      | HMAC key for unsubscribe tokens.                                        |
| `DISABLE_EMAIL_SCHEDULER`   | no       | `1` disables the weekly cron.                                           |
| `RATE_LIMIT_API`            | no       | Per-minute cap on `/api/*`. Default `300`.                              |
| `RATE_LIMIT_AUTH`           | no       | Per-15-minutes cap on `/api/v1/auth/*`. Default `20`.                   |
| `RATE_LIMIT_EMAIL`          | no       | Per-minute cap on `/api/v1/emails/*`. Default `30`.                     |
| `SENTRY_DSN`                | no       | Enables backend error reporting.                                        |
| `SENTRY_ENVIRONMENT`        | no       | Defaults to `NODE_ENV`.                                                 |
| `SENTRY_TRACES_SAMPLE_RATE` | no       | `0.0`–`1.0`. Default `0.1`.                                             |

### Security posture

- `helmet()` enabled (default CSP / HSTS / nosniff headers).
- CORS is an explicit allow-list (`ALLOWED_ORIGINS` → `FRONTEND_URL` fallback). Credentialed requests only from listed origins.
- `express-rate-limit` is layered: generic `/api`, tighter `/api/v1/auth`, tight `/api/v1/emails`. Skipped under `NODE_ENV=test`.
- JWTs sent via `Authorization: Bearer`. If cookies are adopted later, set `Secure`, `HttpOnly`, `SameSite=Lax` in production.
- HTTPS is terminated by Vercel and Railway at the edge — do not add a self-rolled HTTP→HTTPS redirect.

### Post-deployment smoke tests

```bash
SMOKE_BASE_URL=https://signal-app-production-cd33.up.railway.app \
  npm run smoke --workspace=backend
```

Checks: `GET /health`, CORS preflight, signup, login, feed, `GET /api/v1/auth/me`. Exits non-zero on any failure so you can gate deploy hooks on it.


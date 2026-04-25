# CLAUDE.md — SIGNAL

This is the master instruction file for Claude Code on the SIGNAL repo. It supersedes `README.md` for anything that isn't a human-onboarding tutorial.

Source of truth for schema, endpoints, and jobs lives in code — when this doc and the code disagree, code wins. Open a PR against this doc rather than letting it drift.

---

## 1. PRODUCT

**SIGNAL** is a ranked-feed intelligence product for professionals following **AI**, **Finance**, and **Semiconductors**. Three sectors, full stop — not a generic news aggregator and not a CMS. The pitch is "the 10 stories per day that matter, with role-aware commentary on why each one matters to you."

**Surfaces shipped today:**
- Web app (Next.js 14) — feed, story detail, search, saves, settings, team dashboards.
- Weekly digest email (SendGrid) — role-neutral fallback commentary.
- Public Intelligence API (`/api/v2/*`) — API-key authenticated, rate-limited.

**Delivery model:**
- Stories are hand-curated (Phase 4.5 seeded 20 stories; the `seed-data/stories.json` file is the content-source-of-truth). A content pipeline ingesting from raw sources is not in scope for the 12-series.
- Commentary ("why it matters") is authored / generated with three **depth variants** per story — `accessible` (plain-English), `standard` (working-professional, free-tier default), `technical` (insider). See §9.
- Personalization in 12b+ layers on top of depth variants — the pipeline is depth → role → (optional) company.

**Pricing (post-12 launch):**

| tier     | price        | consumption cap        | depth access                   |
|----------|--------------|------------------------|--------------------------------|
| Free     | $0           | **10 stories / day**   | `standard` only                |
| Standard | **$10 / mo** | **100 stories / day**  | caller picks any of 3 depths   |
| Premium  | **$30 / mo** | unlimited              | all depths + Phase 12 extras   |

Paywall gating is enforced at the API boundary. Specifics (which endpoints count toward the cap, how resets work, how depth access is signaled) are being designed as part of the 12-series — see §16.

**NOT in the product:**
- **Learning paths are dead.** The Phase 10 checkbox-tracker concept was abandoned. Do not add learning-path code, routes, UI, or references. Some orphan tables exist in the Drizzle schema from an earlier phase — leave them; a future cleanup migration drops them.
- **Other sectors** (biotech, energy, etc.) — hard-rejected at the API boundary. `VALID_SECTORS = ["ai", "finance", "semiconductors"]` in code; changing it is a product decision, not a code tidy-up.
- **User-generated stories / submissions** — stories are editorial-curated only.

---

## 2. REPO PATH QUIRK (READ THIS BEFORE ANY FILE OPERATION)

All 211 tracked files on `origin/main` live under the prefix:

```
OneDrive/Desktop/signal-app/
```

…inside the repo root. That is **not** a worktree bug, an OneDrive sync artifact, or something to "clean up." `git ls-tree -r origin/main --name-only | head` confirms every path starts with `OneDrive/Desktop/signal-app/`. The `CLAUDE.md` you are reading, for example, is tracked as `OneDrive/Desktop/signal-app/CLAUDE.md`.

**Rules:**
1. Before any mass `git mv`, rename, or "let me flatten this" refactor, run `git ls-tree -r origin/main --name-only | head -20` and cite the output.
2. The flatten is tracked in `docs/ROADMAP.md` as a deferred infra item (#18). Do it as a dedicated, coordinated session — not incidentally.
3. When you `cd backend`, you're at `OneDrive/Desktop/signal-app/backend`, not the worktree root.

---

## 3. TECH STACK (AUTHORITATIVE)

Deviation requires an explicit decision recorded somewhere durable (commit message, ROADMAP, a follow-up issue).

### Frontend

- **Next.js 14** (App Router) + **React 18** + TypeScript strict
- **Tailwind CSS** + **shadcn/ui** + **lucide-react**
- **Zustand** for client state (auth, teams cache)
- **TanStack Query** for server state / fetching
- **react-hook-form** + **zod** for forms
- **axios** for HTTP
- **recharts** for dashboards
- **@sentry/nextjs** for error tracking
- **vitest** for unit tests

### Backend

- **Express 4** + TypeScript strict on **Node 20+**
- **Drizzle ORM** on **PostgreSQL** (`pg` driver). **NOT Prisma** — do not introduce a second ORM.
- **ioredis** for Redis (rate limits, BullMQ backing store). Fail-open pattern is intentional: a Redis outage degrades gracefully rather than taking the API down.
- **BullMQ** for durable queues (emails, aggregation rollups).
- **node-cron** for in-process scheduling (the weekly-digest trigger lives here).
- **jsonwebtoken** + **bcryptjs** for user auth.
- **@anthropic-ai/sdk** — Claude Haiku for commentary generation. Two call sites, two model pins: the Phase 12a offline depth-variant regeneration script uses the alias `claude-haiku-4-5` (via `DEPTH_VARIANT_MODEL` in `services/depthVariantGenerator.ts`); the Phase 12c per-user, per-story commentary path uses the **dated** string **`claude-haiku-4-5-20251001`** (via `COMMENTARY_MODEL` in `services/haikuCommentaryClient.ts`). The dated pin is deliberate — request-path behavior must not shift silently when Anthropic advances the alias.
- **@sendgrid/mail** for transactional email.
- **zod** for every external input (bodies, queries, headers, seed JSON, cursor payloads).
- **helmet** + **express-rate-limit** + custom per-API-key limiter.
- **@sentry/node** for error tracking.
- **jest** + **supertest** for tests (jest, not vitest — frontend and backend deliberately differ).

### Ops

- **Railway** hosts backend + Postgres + Redis.
- **Vercel** hosts frontend.
- **SendGrid** for email send.
- **GitHub** for source control. CI is not wired yet; gates run locally.

---

## 4. MONOREPO LAYOUT

npm workspaces rooted at the repo root. All workspace scripts dispatch via `npm-run-all` from the root `package.json`.

```
signal-app/
├── CLAUDE.md
├── README.md
├── package.json                 # workspaces: ["frontend", "backend"]
├── backend/
│   ├── package.json
│   ├── seed-data/
│   │   └── stories.json         # hand-curated content, 20 stories
│   ├── src/
│   │   ├── app.ts               # Express factory + router mounts
│   │   ├── server.ts            # boot: Sentry, env-check, workers, schedulers, listen
│   │   ├── controllers/
│   │   │   ├── authController.ts
│   │   │   ├── userController.ts
│   │   │   ├── storyController.ts
│   │   │   ├── commentController.ts
│   │   │   ├── emailController.ts
│   │   │   ├── teamController.ts
│   │   │   ├── apiKeyController.ts
│   │   │   └── v2/
│   │   │       ├── storiesController.ts
│   │   │       └── trendsController.ts
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── users.ts
│   │   │   ├── stories.ts
│   │   │   ├── comments.ts
│   │   │   ├── emails.ts
│   │   │   ├── teams.ts
│   │   │   ├── apiKeys.ts
│   │   │   ├── health.ts
│   │   │   └── v2/
│   │   │       ├── index.ts
│   │   │       ├── stories.ts
│   │   │       └── trends.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts          # JWT requireAuth
│   │   │   ├── apiKeyAuth.ts    # X-API-Key validation
│   │   │   ├── apiKeyRateLimit.ts
│   │   │   ├── rateLimiter.ts   # apiLimiter, authLimiter, emailLimiter
│   │   │   ├── errorHandler.ts
│   │   │   └── notFoundHandler.ts
│   │   ├── services/
│   │   │   ├── authService.ts
│   │   │   ├── apiKeyService.ts
│   │   │   ├── emailService.ts
│   │   │   ├── digestService.ts
│   │   │   ├── personalizationService.ts
│   │   │   ├── teamInviteService.ts
│   │   │   ├── unsubscribeService.ts
│   │   │   └── depthVariantGenerator.ts   # Anthropic Haiku client
│   │   ├── jobs/
│   │   │   ├── emailQueue.ts
│   │   │   ├── emailWorker.ts
│   │   │   ├── emailScheduler.ts          # node-cron
│   │   │   ├── aggregationQueue.ts
│   │   │   ├── aggregationJob.ts
│   │   │   └── aggregationWorker.ts
│   │   ├── scripts/
│   │   │   ├── seedStories.ts
│   │   │   ├── regenerateDepthVariants.ts # Phase 12a one-time batch
│   │   │   ├── runAggregation.ts
│   │   │   ├── sendDigestNow.ts
│   │   │   └── smokeTest.ts
│   │   ├── db/
│   │   │   ├── index.ts                   # pg Pool + drizzle instance
│   │   │   ├── schema.ts                  # SOURCE OF TRUTH
│   │   │   ├── migrate.ts                 # homegrown runner; runs via Dockerfile CMD
│   │   │   ├── migrations/
│   │   │   │   ├── 0000_dashing_colleen_wing.sql
│   │   │   │   ├── 0001_phase6_search_index.sql
│   │   │   │   ├── 0002_phase9a_teams.sql
│   │   │   │   ├── 0003_phase9b_team_settings.sql
│   │   │   │   ├── 0004_phase9_invite_revoked_at.sql
│   │   │   │   ├── 0005_phase11_api_keys.sql
│   │   │   │   ├── 0006_phase11c5_story_aggregates.sql
│   │   │   │   ├── 0007_phase12a_depth_variants.sql
│   │   │   │   ├── 0008_phase12b_onboarding.sql
│   │   │   │   ├── 0009_phase12c_commentary_cache.sql
│   │   │   │   ├── 0010_phase12d_expandable_commentary.sql
│   │   │   │   ├── 0011_drop_phase12b_helper.sql
│   │   │   │   └── 0012_deprecate_drizzle_migrations_table.sql
│   │   │   ├── seed.ts
│   │   │   ├── helpers.ts
│   │   │   └── verify.ts
│   │   ├── emails/
│   │   │   ├── layout.ts
│   │   │   ├── welcomeEmail.ts
│   │   │   ├── passwordResetEmail.ts
│   │   │   ├── teamInviteEmail.ts
│   │   │   └── weeklyDigestEmail.ts
│   │   ├── lib/
│   │   │   ├── redis.ts
│   │   │   ├── sentry.ts
│   │   │   └── envCheck.ts
│   │   └── utils/
│   │       └── depthVariants.ts           # Zod schema + parse/assert
│   └── tests/                             # jest + supertest, 31+ suites
├── frontend/
│   ├── package.json
│   └── src/
│       ├── app/                           # Next App Router
│       │   ├── (app)/                     # authed layout
│       │   │   ├── feed/page.tsx
│       │   │   ├── saved/page.tsx
│       │   │   ├── search/page.tsx
│       │   │   ├── settings/page.tsx
│       │   │   ├── stories/[id]/page.tsx
│       │   │   └── teams/…
│       │   ├── (auth)/                    # login, signup
│       │   ├── onboarding/page.tsx
│       │   ├── teams/join/page.tsx        # invite-accept (unauth)
│       │   └── unsubscribe/page.tsx
│       ├── components/
│       │   ├── ui/                        # shadcn primitives
│       │   ├── feed/
│       │   ├── stories/
│       │   ├── comments/
│       │   ├── search/
│       │   ├── teams/
│       │   ├── layout/
│       │   └── providers/
│       ├── hooks/                         # useAuth, useStories, useTeams, …
│       ├── lib/                           # api.ts (axios), utils, timeAgo
│       ├── store/                         # authStore, teamsStore (zustand)
│       └── types/
└── docs/
    ├── API.md                             # public v2 reference
    ├── SCHEMA.md                          # content tables + seeding guide
    ├── DEPLOYMENT.md                      # Railway + Vercel runbooks
    ├── ROADMAP.md                         # in-flight / deferred / abandoned
    ├── PHASE_9_CLOSEOUT.md
    └── SMOKE_TEST_TEAMS.md
```

---

## 5. BACKEND ARCHITECTURE

### Boot sequence (`server.ts`)

1. `dotenv/config`
2. `initSentry()` — Sentry is a no-op if `SENTRY_DSN` is unset
3. `runStartupEnvCheck()` — fails fast on missing required vars
4. `createApp()` (see below)
5. `app.listen(PORT)`
6. In parallel:
   - `startEmailWorker()` — BullMQ consumer for `signal-email`
   - `startEmailScheduler()` — node-cron (default `0 8 * * 1`, Monday 08:00 UTC)
   - `startAggregationWorker()` — BullMQ consumer for `signal-aggregation`
   - `scheduleAggregationRepeatable()` — enqueues daily rollup at `0 2 * * *` UTC

Every Redis-dependent subsystem **degrades gracefully** when `REDIS_URL` is unset: workers log-and-noop, rate limiters fail-open, CLIs that talk directly to Postgres still work. Do not change this invariant without an ADR-style note in the commit.

### Middleware stack (`app.ts`), in order

1. `helmet()`
2. `cors(buildCorsOptions())` — allowlist from `ALLOWED_ORIGINS` + regex from `ALLOWED_ORIGIN_PATTERNS`. Missing Origin = allowed (fail-open for server-to-server).
3. `express.json({ limit: "1mb" })`
4. `express.urlencoded({ extended: true })`
5. Routers (see §6), each with its own rate limiter layer.
6. Sentry error handler
7. `notFoundHandler` → `errorHandler`

### Error envelope — always this shape

```json
{ "error": { "code": "INVALID_QUERY", "message": "...", "details": {} } }
```

Throw `AppError(code, message, httpStatus, details?)` from anywhere; `errorHandler` maps it. Zod errors auto-convert to `INVALID_QUERY` / `INVALID_BODY`. **Never** `res.status(500).send(err)` directly.

---

## 6. ROUTES

### v1 (`/api/v1/*`, JWT-authenticated)

Routers mounted in `app.ts`:

| base path              | auth        | purpose                                  |
|------------------------|-------------|------------------------------------------|
| `/api/v1/auth`         | none + `authLimiter` | signup, login, me, logout                |
| `/api/v1/users`        | JWT         | profile read/write                       |
| `/api/v1/me/api-keys`  | JWT         | self-service API-key CRUD (v2 keys)      |
| `/api/v1/stories`      | JWT         | feed, search, detail, save/unsave, related, comments-on-story |
| `/api/v1/comments`     | JWT         | comment CRUD (replies, update, delete)   |
| `/api/v1/teams`        | JWT + public invite endpoints | team CRUD + members + invites + dashboard + team feed |
| `/api/v1/emails`       | public + `emailLimiter` | unsubscribe (GET + POST), preferences (JWT) |
| `/health`              | none        | liveness                                 |

### v2 (`/api/v2/*`, API-key-authenticated) — the public Intelligence API

Mounted under `v2Router` with `apiKeyAuth` → `apiKeyRateLimit` (60 req/min per key, Redis-backed, fail-open).

| method | path                      | handler                              |
|--------|---------------------------|--------------------------------------|
| GET    | `/api/v2/stories`         | `storiesController.listStoriesV2`    |
| GET    | `/api/v2/trends/:sector`  | `trendsController.getSectorTrends`   |

API keys have the prefix **`sgnl_live_`** (not `sk_live_` — that prefix triggers GitHub secret-scanner false positives). Keys are HMAC-SHA256'd at rest (not bcrypt — bcrypt is for user passwords, HMAC for server-verifiable tokens).

Full API reference: **`docs/API.md`**. Keep it in sync when you touch v2.

---

## 7. DATA LAYER

### Source of truth

`backend/src/db/schema.ts` — **every** pgTable, enum, and exported type. If you're writing a query and need to know the column name, read the schema, not this doc.

### Tables currently used in code

- `users`, `userProfiles` — account + onboarding sectors/role
- `writers` — story author metadata (no slug, no `updated_at`)
- `stories` — content. Commentary columns: `whyItMatters` (TEXT, role-neutral fallback) + `whyItMattersTemplate` (TEXT holding JSON-stringified `{accessible, standard, technical}` — see §9)
- `storyAggregates` — weekly rollup per `(sector, period)`; populated by the aggregation job; read by `/api/v2/trends/:sector`
- `userSaves` — N:M user↔story
- `comments` — threaded, nullable `parentCommentId`; `teamId` nullable for team-scoped comments
- `teams`, `teamMembers`, `teamInvites` — enterprise (Phase 9). Invites use `used_at` + `revoked_at`; **there is no `accepted_at` column** — acceptance writes `used_at`. Derived status: `revoked > used > expired > pending`.
- `emailQueue` — Postgres-backed email outbox; BullMQ is the delivery mechanism.
- `apiKeys` — self-service v2 keys. Columns: `userId`, `label`, `keyPrefix`, `keyHash` (unique), `lastUsedAt`, `revokedAt`. Unique-if-active on `(userId, label)` where `revokedAt IS NULL`.

### Dormant tables

A few tables from an abandoned earlier phase still exist in `schema.ts`. They have no controllers, no routes, no UI, no seed data. **Ignore them.** A future cleanup migration will drop them. Do not add code that reads or writes them, and do not link them from new features.

### Migrations — hand-written SQL via homegrown runner

Migrations are hand-written `.sql` files applied by `backend/src/db/migrate.ts` — a homegrown runner that replaced `drizzle-kit migrate`. Drizzle ORM still owns runtime queries; only the schema-migration path swapped.

**Workflow**
1. Create `backend/src/db/migrations/NNNN_phaseXY_slug.sql` by hand. Plain SQL, one up-only file. No down migrations.
2. Update `schema.ts` so types stay in sync with the DB.
3. If the migration changes anything an existing test touches, update fixtures in the same commit.
4. Run `npm run db:migrate --workspace=backend` locally to apply against dev. `--dry-run` validates without writing.
5. Commit. On deploy, the Dockerfile CMD runs the runner against prod before binding the server port (see `docs/DEPLOYMENT.md`).

`drizzle-kit migrate` and `drizzle-kit generate` are retired — the corresponding npm scripts are gone. `drizzle-kit` stays in `devDependencies` only for `db:studio` (DB browser).

**schema_migrations table**

The runner's bookkeeping — the source of truth for whether a given migration has been applied. DDL:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by TEXT
);
```

- `filename` — migration filename (e.g. `0012_deprecate_drizzle_migrations_table.sql`); PK.
- `content_hash` — SHA-256 hex digest of the migration's normalized content. Spec: hash the UTF-8 file bytes after (1) stripping a leading U+FEFF BOM if present, then (2) replacing every `\r\n` sequence with `\n`. Bare `\r` is not normalized. Output is the lowercase hex digest. This spec is stable across Windows CRLF and Linux LF line endings. Reproducible from any tool with SHA-256: read file bytes, strip a leading U+FEFF if present, replace `\r\n` with `\n`, take SHA-256, output as lowercase hex. The runner exports `lfNormalize(buf)` and `sha256Hex(s)` for in-repo callers.
- `applied_at` — apply timestamp, default `now()`.
- `applied_by` — identifier for who applied the migration; resolved as `process.env.GIT_COMMIT_SHA ?? process.env.USER ?? process.env.USERNAME ?? null`.

The table is auto-bootstrapped: the runner runs `CREATE TABLE IF NOT EXISTS schema_migrations (...)` before reading applied rows on every run. A fresh database needs no manual setup; an existing database with the table is unaffected.

**Failure modes**

The runner refuses to proceed in two cases. Both are hard errors with no auto-recovery — the emitted message includes the row's `applied_at` and `applied_by` so you can find the offending commit.

*content_hash mismatch* — the file on disk hashes to a different value than what was recorded when the migration was applied (i.e. the file was edited post-apply). Detection exists because applied migrations are immutable history; without it, the runner couldn't distinguish "already applied" from "applied a different version that is now this." **Recovery: revert the edit and create a new corrective migration. Never edit an applied file.** The terminal message:

> `content_hash mismatch for "<filename>": disk=<disk-hash> db=<db-hash> (applied_at=<iso>, applied_by=<user|null>). Recovery: revert the file edit (migrations are immutable once applied), or if the edit is intentional, manually UPDATE schema_migrations.content_hash after confirming the change is a no-op against current schema.`

*missing file* — `schema_migrations` has a row whose `filename` does not exist on disk. Detection exists because the codebase no longer matches the database's recorded history; silently skipping would let drift accumulate. **Recovery: restore the file from git. Never delete the `schema_migrations` row.** The terminal message:

> `applied migration "<filename>" (db=<hash>, applied_at=<iso>, applied_by=<user|null>) has no corresponding file on disk. Recovery: restore the file from git history or, if intentionally removed, DELETE the row from schema_migrations after confirming the schema state.`

The runner's own recovery hints describe escape hatches (`UPDATE schema_migrations.content_hash` for hash drift, `DELETE` of the row for missing file). These exist for narrow intentional cases — e.g. a comment-only fix to an applied file. Default to creating a corrective migration for hash drift, and restoring from git for missing files; reach for the escape hatches only after confirming the live schema state and only with a clear reason.

**Authoring rules**

**Schema-qualification.** The runner doesn't `SET search_path`; the session inherits whatever the database role's default is. A migration touching an object outside the default search_path — e.g. `drizzle.__drizzle_migrations` — must spell the schema explicitly: `COMMENT ON TABLE drizzle.__drizzle_migrations …`, not the bare table name.

**Session state.** All pending migrations in one run share a single client. A non-`LOCAL` `SET` (`statement_timeout`, `role`, `search_path`, …) persists past the migration's `COMMIT` and leaks into every subsequent migration in that run. If a migration legitimately needs session state, use `SET LOCAL` so it expires at transaction end. This is an authoring rule, not a runner bug — the shared-client design is intentional, and it's the same reason "just `SET search_path` at the top of the file" is the wrong answer to the rule above.

**Comment-only migrations.** When metadata is the only change and no DDL is needed, a one-line `COMMENT ON TABLE` / `COMMENT ON COLUMN` is the canonical form. See `0007_phase12a_depth_variants.sql` and `0012_deprecate_drizzle_migrations_table.sql` for reference patterns.

**Manual prod SQL**

**Default path.** State changes go through migrations, not `psql`. The runner is the canonical way to write to prod — every change has a filename, a hash, and a row in `schema_migrations`. Read-only operations (introspection, `EXPLAIN`, sampling) are fine; the convention is about writes.

**Emergency override.** If a manual write is genuinely necessary — incident response where the deploy cycle is too slow — it has to be a conscious decision, and the exact SQL must be captured in a follow-up idempotent migration committed before the next deploy. Idempotent because dev/staging won't have the manual change applied; running the same SQL there must be a clean no-op (`CREATE … IF NOT EXISTS`, `DROP … IF EXISTS`, guarded `INSERT … ON CONFLICT`, etc.). Document the action somewhere recoverable — commit message, GitHub issue, or session note — so a future reader can reconstruct what happened and when.

**Why this exists.** `0011_drop_phase12b_helper.sql` is a corrective migration for a stray `_phase12b_jsonb_to_text_array` function found on prod that no migration ever created — origin: manual SQL during `0008`'s development that never made it into a committed file. The function existed on prod but not dev; the convention exists because that gap is exactly what migrations are supposed to prevent.

**Deprecation**

**Deleted: `meta/_journal.json`.** drizzle-kit's old per-folder bookkeeping. The new runner tracks state in `schema_migrations` and doesn't read or write the journal, so the file (and the now-empty `meta/` directory) was removed.

**Retained read-only: `drizzle.__drizzle_migrations`.** drizzle-kit's pre-runner migration log. Migration `0012_deprecate_drizzle_migrations_table.sql` applies a deprecation comment to the table; the table itself is kept as historical audit of what drizzle-kit thought it had applied before the cutover. The comment is queryable — `SELECT obj_description('drizzle.__drizzle_migrations'::regclass);` returns the deprecation string. Don't write to the table; the runner's source of truth is `schema_migrations`.

**0001 hash artifact**

`0001_phase6_search_index.sql`'s hash in `schema_migrations` differs from the value drizzle-kit recorded in `__drizzle_migrations` for the same file. This is a benign quirk in drizzle-kit's old hash function — the file is byte-identical since creation, and the new runner's hash is the source of truth going forward. For context: 8 of the 10 hashes drizzle-kit recorded did match the runner's recomputation, so 0001 is an outlier, not the pattern.

### Invariants

- UUID primary keys (`defaultRandom()`), never autoincrement integers.
- `createdAt` on every table; `updatedAt` where mutations happen.
- Index every FK + every column in a `WHERE`/`ORDER BY` of a hot query.
- Use transactions for multi-table writes. Drizzle's `db.transaction(async (tx) => …)` is the idiom.
- **Boundary validation**: every external input goes through Zod. Seed JSON, request bodies, query params, cursor payloads — all of it.

---

## 8. JOBS & SCHEDULERS

Two BullMQ queues, both backed by the shared Redis connection:

| queue                | producer                          | worker                  | cadence                  |
|----------------------|-----------------------------------|-------------------------|--------------------------|
| `signal-email`       | `emailQueue.enqueue()`            | `emailWorker`           | on-demand + weekly trigger |
| `signal-aggregation` | `scheduleAggregationRepeatable()` | `aggregationWorker`     | `0 2 * * *` UTC, configurable via `AGGREGATION_CRON` |

Plus one **in-process** scheduler:

- `emailScheduler` — node-cron, default `0 8 * * 1` (Monday 08:00 UTC), overridable via `WEEKLY_DIGEST_CRON`; disable with `DISABLE_EMAIL_SCHEDULER=1` for local dev.

Manual triggers for ops:

- `npm run send-digest-now --workspace=backend` — run the weekly digest immediately
- `npm run run-aggregation --workspace=backend [-- --period=2026-W17]` — one-off rollup
- `npm run regenerate-depth-variants --workspace=backend` — Phase 12a one-time batch (see §9)

---

## 9. DEPTH-VARIANT COMMENTARY (Phase 12a)

### The shape

Every story has a `why_it_matters_template` payload with exactly three depth keys:

| key          | audience framing                                                  |
|--------------|-------------------------------------------------------------------|
| `accessible` | plain-English, no jargon — a curious non-expert                   |
| `standard`   | working professional in an adjacent field — **free-tier default** |
| `technical`  | insider/expert — assumes sector vocabulary                        |

The pre-12a sector-variant shape (`{ai, finance, semiconductors}`) is dead. Zod's `.strict()` rejects it.

### Where the invariants live

- `backend/src/db/schema.ts` exports `DEPTH_LEVELS` (tuple) and `WhyItMattersTemplate` (type).
- `backend/src/utils/depthVariants.ts` exports:
  - `WhyItMattersTemplateSchema` — `.strict()`, `min(1)` per field
  - `parseWhyItMattersTemplate(raw)` — **lenient-on-read**, returns `null` on null / empty / invalid JSON / legacy shape (never throws). Used by the v2 stories controller so the endpoint stays live during the regeneration window.
  - `assertWhyItMattersTemplate(value)` — **strict**, throws. Used at the regeneration boundary where garbage must not be written.
- `backend/src/services/depthVariantGenerator.ts` — Anthropic Haiku (`claude-haiku-4-5` alias, exported as `DEPTH_VARIANT_MODEL`) client for the offline regeneration path. Deps are injectable so tests run offline.
- `backend/src/services/haikuCommentaryClient.ts` — Phase 12c per-user, per-story commentary client. Uses the dated model string **`claude-haiku-4-5-20251001`** (exported as `COMMENTARY_MODEL`), 10s `AbortController` timeout, zero retries, fail-fast to the template scrub path on any error. Deliberately separate from the 12a client — the request path must not inherit a silent model-alias advance.

### Storage

The column is **TEXT**, not JSONB. It has been TEXT since migration 0000; Phase 4.5 started storing JSON-stringified payloads there. Phase 12a only changed the **shape inside the string**, which is why `0007_phase12a_depth_variants.sql` is `COMMENT ON COLUMN` rather than an `ALTER TYPE`.

### Regeneration runbook

```bash
cd backend

# Dry-run: calls the model, prints the generated payload, skips UPDATE
npm run regenerate-depth-variants -- --dry-run

# Live: prompts y/n showing DATABASE_URL host/dbname
npm run regenerate-depth-variants

# One row (for spot-fixes)
npm run regenerate-depth-variants -- --id=<uuid>

# CI / non-interactive
npm run regenerate-depth-variants -- --yes
```

Requires `ANTHROPIC_API_KEY`. Per-story failures (rate limits, schema mismatches) are collected and reported at the end without aborting — re-run with `--id=<uuid>` for retries.

### Client contract for depth

- `/api/v2/stories` returns `why_it_matters` (string, always present) **and** `why_it_matters_template` (object or `null`).
- When the template is `null`, the client falls back to `why_it_matters`. This is the permanent contract, not a migration-window hack — some rows may never get a template.
- Paywall gating of depth access (§1) is enforced at the API layer, not in the parser. Which keys a given caller is permitted to see is a 12-series decision.

### Phase 12c — per-user, per-story commentary

12a shipped three depth variants per story — role-neutral. 12c layers per-user personalization on top: the feed and story-detail surfaces call `GET /api/v1/stories/:id/commentary` at view time and get back a commentary string generated from (role, domain, seniority, sectors, goals, topics) × story depth-variant, cached for reuse. The prior-gen `why_it_matters_to_you` template text remains as the 12b rollout floor until 12d removes it.

**Endpoint — `GET /api/v1/stories/:id/commentary?depth=`**
- JWT-auth. No `requireProfile` gate — pre-onboarding direct-link users get a clean `400 PROFILE_NOT_FOUND` rather than a 403.
- `depth` query param is optional and validated against `{accessible, standard, technical}`. Precedence: explicit query > stored `depthPreference` > `"standard"` floor.
- 404 `STORY_NOT_FOUND` on unknown story id. Any service failure below is hidden behind the tiered fallback — the endpoint never 5xxs on a content path.

**Storage — `commentary_cache` (migration 0009)**
- Composite unique key: `(user_id, story_id, depth, profile_version)`. Writes use `onConflictDoNothing` so the second member of a race simply loses and re-reads the winner.
- `profile_version` on `user_profiles` is a monotonic int, default 1, bumped by `updateMyProfile` when any commentary-relevant field (role, domain, seniority, sectors, goals, topics) changes. Depth and email toggles do NOT bump.
- `last_accessed_at` is written on every cache hit in 12c (TODO 12c.1: consider opportunistic — see comment in `commentaryService.ts`).

**Tiered fallback**
- `tier1` — the cache itself. If fresh for `(user, story, depth, profile_version)`, return it.
- `tier2` — Haiku call succeeds; persist + return.
- `tier3` — Haiku throws / times out. Return a template scrub of the depth variant with synonym substitution for banned phrases; emit an anomaly log with `{reason: "timeout" | "error" | ...}` so ops can see the fail-fast rate.

**Haiku client discipline (Decisions 4–6 from the 12c spec)**
- Dated model pin: `claude-haiku-4-5-20251001`. Hard-coded, not env-driven — a rollout calendar is not a code change.
- 10-second hard timeout via `AbortController`. Timeout logged as `reason: "timeout"` on the tier3 path.
- Zero retries. One call, fail fast. Revisit in 12d if the observed error rate warrants.

**Banned-phrase three-layer enforcement**
- Layer 1: system prompt instructs the model to avoid a named list of phrases (e.g. "in today's fast-paced world").
- Layer 2: post-generation trip-wire scans the output for the banned set; a hit demotes the response to tier3.
- Layer 3: the template scrub path substitutes synonyms for any banned phrase present in the source depth variant before returning.

**Frontend wiring**
- `GET /api/v2/stories` and `GET /api/v1/stories/:id` emit `commentary: null` + `commentary_source: null` on the Story shape — the feed hydrates lazily.
- `useStoryCommentary(storyId, {enabled})` is the React hook; `frontend/src/lib/commentaryQueue.ts` holds an 8-slot FIFO semaphore (`COMMENTARY_MAX_CONCURRENT`) that caps parallel fetches.
- `StoryCard` gates `enabled` on an `IntersectionObserver` with `rootMargin: "1200px 0px"` (~5-card lookahead); `StoryDetail` fires immediately. `shouldLoad` latches true once set — scrolling away never cancels an in-flight request.

---

## 10. PAYWALL & CONSUMPTION

**Status:** designed, not yet enforced in code. The 12-series will wire this up.

**Policy (product decision, not negotiable without a product call):**
- Daily consumption counter keyed by user (web) or API key (v2).
- Resets at 00:00 UTC.
- A "consumption" is counted on story-detail reads and on API `GET /stories` list responses (per row returned). Feed browsing is free.
- Free: 10/day, locked to `standard` depth.
- Standard ($10/mo): 100/day, free choice of depth.
- Premium ($30/mo): unlimited, all depths.

When building a feature that reads stories, ask: does this increment the counter? If unclear, treat it as "yes" and add a TODO linking the 12-series phase that finalizes the rule.

---

## 11. FRONTEND ARCHITECTURE

### App Router conventions

- **Server Components by default.** Add `'use client'` only when you need state, effects, handlers, or browser APIs.
- Data fetching in Server Components via async functions; mutations and cache via TanStack Query in client components.
- `loading.tsx` + `error.tsx` for every route group.
- Auth redirects in a layout, not in every page — `(app)/layout.tsx` handles "redirect to login if not authed".

### State split

- **TanStack Query** owns server state (stories, saves, teams, comments). Never mirror this into Zustand.
- **Zustand** owns client-only session state (current user + JWT in `authStore`, teams cache in `teamsStore`). Two stores is the cap — resist adding more.
- **react-hook-form + zod** owns form state. Do not use controlled state + local validation.

### API client

`frontend/src/lib/api.ts` exports a pre-configured axios instance plus typed wrappers per endpoint. Adding a new endpoint means adding a wrapper there, not inlining `axios.get(...)` in a hook.

---

## 12. CODING STANDARDS

### TypeScript (both sides)

- `"strict": true`. No exceptions.
- No `any`. Use `unknown` + a type guard.
- Explicit return types on exported functions.
- `interface` for objects, `type` for unions / intersections / mapped types.
- Named exports preferred. Default exports only where a framework requires them (Next.js pages, etc.).

### Backend

- Validate every external input with zod before it reaches a service.
- Wrap every controller body in `try { … } catch (e) { next(e); }` — errorHandler takes it from there.
- Use `async/await`, never `.then/.catch` in production code.
- Multi-table writes: `db.transaction()`.
- Parameterized queries via Drizzle — never string-concat SQL.

### Security

- Never log passwords, tokens, API keys, or raw session JWTs. If you need to log a key for ops, log `keyPrefix` only.
- User passwords: bcryptjs, cost 12. API keys: HMAC-SHA256.
- Rate limit by IP on `/api/v1/auth/*`, by user on general `/api/v1/*`, by API key on `/api/v2/*`.
- CORS allowlist is explicit — never `origin: "*"` for authed routes.

### File naming

- **Frontend components** (`.tsx`): PascalCase matching the default export. `StoryCard.tsx`, `TeamSwitcher.tsx`.
- **Hooks** (`.ts`): camelCase with `use` prefix. `useStories.ts`, `useAuth.ts`.
- **Utils / libs** (`.ts`): camelCase. `api.ts`, `timeAgo.ts`.
- **Next.js conventions override** — `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts` stay lowercase.
- **Types** in `src/types/`: lowercase by domain (`story.ts`, `team.ts`); type names inside PascalCase.
- **Backend files** mirror the same convention by domain: `authController.ts`, `apiKeyService.ts`, `depthVariants.ts`.
- **Migration files**: `NNNN_phaseXY_slug.sql`, zero-padded sequence, phase tag, kebab-slug.

---

## 13. ENVIRONMENT VARIABLES

### Backend (`backend/.env.example`)

```
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@localhost:5432/signal
REDIS_URL=redis://localhost:6379
JWT_SECRET=<generate: openssl rand -hex 32>
JWT_EXPIRES_IN=7d
UNSUBSCRIBE_SECRET=<generate: openssl rand -hex 32>
SENDGRID_API_KEY=
SENDER_EMAIL=noreply@signal.so
FRONTEND_URL=http://localhost:3000
WEEKLY_DIGEST_CRON=0 8 * * 1
DISABLE_EMAIL_SCHEDULER=
EMAIL_WORKER_CONCURRENCY=5
ANTHROPIC_API_KEY=
# Optional:
# ALLOWED_ORIGINS=https://signal.so,https://www.signal.so
# ALLOWED_ORIGIN_PATTERNS=^https://.*-nvrod-.*\.vercel\.app$
# AGGREGATION_CRON=0 2 * * *
# SENTRY_DSN=
```

### Frontend (`frontend/.env.local`)

```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`runStartupEnvCheck()` in `backend/src/lib/envCheck.ts` is the source of truth for which vars are required vs optional. Update it when you add a new required env var, and update the example file in the same commit.

---

## 14. TESTING

### Gates (run before every commit)

```bash
npm run type-check --workspace=backend
npm run lint --workspace=backend
npm test --workspace=backend
```

Frontend gates are the same three with `--workspace=frontend`. There is no CI enforcing them yet — that means your local gates **are** the enforcement.

### Backend test pattern

- **jest** + **supertest**. Integration tests spin up `createApp()` and hit it; unit tests import functions directly.
- **Mock DB pattern**: `tests/helpers/mockDb.ts` exports `createMockDb()`; tests call `mock.queueSelect([...])` / `mock.queueInsert([...])` to stage responses, then `jest.mock("../src/db", () => ({ get db() { return mock.db; }, … }))`. **Do not** stand up a real Postgres in tests.
- **External services**: mock at the SDK boundary. Anthropic SDK mock pattern is in `tests/regenerateDepthVariants.test.ts`; SendGrid mock is in `tests/emailService.test.ts`.
- **Integration tests** live alongside unit tests in `backend/tests/` and share the mock-DB helper.

Current count: **435 tests across 37 suites** (as of Phase 12c). Adding a feature without tests is a code-review hard-block.

### Frontend tests

vitest; not much coverage yet. Add tests with every new component that has meaningful logic.

---

## 15. GIT & COMMITS

- **Branch naming** for agent-driven work: `claude/<random-slug>`. Worktrees in `.claude/worktrees/*` are the working dirs.
- **Commit granularity**: one logical change per commit. Phase 12a shipped as 3 commits — schema+parser, script+seed, API projection+docs. That's the target shape.
- **Commit message style**: `<type>(<scope>): <subject>` first line, then a body explaining *why*. Look at `git log` — `feat(db)`, `feat(v2)`, `test(v2)`, `docs(schema)` are the scopes in flight.
- **Never `--amend`** a pushed commit without an explicit ask.
- **Never `--no-verify`** — fix the hook failure.
- Co-author trailer on agent commits: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

## 16. PHASE STATUS

### Shipped (0 through 12c)

| phase | ships                                                                      |
|-------|----------------------------------------------------------------------------|
| 0     | repo, tooling                                                              |
| 1     | Postgres + Drizzle + migration runner                                      |
| 2     | auth (signup, login, JWT, password hashing)                                |
| 3     | user profiles + onboarding                                                 |
| 4     | feed, story detail, search-free browsing                                   |
| 4.5   | `seedStories` script + `seed-data/stories.json` as content source of truth |
| 5     | saves + threaded comments                                                  |
| 6     | search index + search endpoint                                             |
| 7     | weekly digest email system (SendGrid + BullMQ + node-cron)                 |
| 8     | Railway + Vercel deployment, Sentry, envCheck                              |
| 9     | teams/enterprise: teams, members, invites (token-based), team dashboards   |
| 11    | public v2 API scaffolding + self-service API keys                          |
| 11c   | `GET /api/v2/stories` with cursor pagination                               |
| 11c.5 | `story_aggregates` table + aggregation job + `GET /api/v2/trends/:sector`  |
| 12a   | depth-variant commentary — schema, parser, regeneration script, v2 projection fix |
| 12b   | rewritten onboarding questionnaire (7 screens) + `why_it_matters_to_you` rollout-floor template personalization |
| 12c   | **per-user, per-story commentary** — dated-model Haiku client, `commentary_cache` with `profile_version` invalidation, tiered fallback + banned-phrase enforcement, Settings-side bump on commentary-relevant edits, feed/detail lazy hydration with 8-slot semaphore |

Phase 10 (learning paths) was abandoned. Do not resurrect.

### Current roadmap — Phase 12 series (through launch)

The 12-series is the push to public launch — every sub-phase is load-bearing for "can a stranger sign up and pay." Early slots (12a–12d) are the personalized-commentary surface area. **12e is the ingestion pipeline — the load-bearing infrastructure item that replaces hand-curated `stories.json` as the content source.** Later slots wire up paywall, billing, digest personalization, and launch polish.

| sub-phase | scope                                                                                   |
|-----------|-----------------------------------------------------------------------------------------|
| **12a** (shipped) | depth-variant schema + offline regeneration                                     |
| **12b** (shipped) | 7-screen onboarding questionnaire + `why_it_matters_to_you` template floor      |
| **12c** (shipped) | per-user, per-story commentary — Haiku request path, cache with `profile_version`, Settings bump, feed/detail hydration (see §9 "Phase 12c") |
| 12d       | depth-selector UI on story detail + feed (pick depth per-view, backed by the 12c cache entry for that (user, story, depth, profile_version)) |
| **12e**   | **ingestion pipeline — raw-source crawl → editorial-review queue → published stories.** Replaces `seed-data/stories.json` as the sole content source. Launch blocker. |
| 12f–12i   | paywall enforcement, Stripe/billing, depth-aware digest, launch polish (marketing/pricing pages, onboarding redesign, support inbox). Interior ordering not yet pinned — decide at the start of each session. |

Ordering 12a→12e is fixed. Do not pull 12f–12i work ahead of 12e; the ingestion pipeline is the dependency that makes the paywall economics real.

Known 12c follow-ups (tracked inline as TODO comments, not blockers):
- **12c.1** — `last_accessed_at` on `commentary_cache` is written on every cache hit; consider opportunistic/throttled writes if the row-update rate becomes a hot spot (comment in `commentaryService.ts`).
- **12d** — ship the depth-selector UI; the endpoint already honors an explicit `?depth=` query and maintains separate cache entries per depth via the composite key.

`docs/ROADMAP.md` is stale (last updated during Phase 11c kickoff) — refresh it in a dedicated cleanup pass; treat CLAUDE.md as authoritative for 12-series state today.

### Future (post-launch)

- **Phase 13 — Teams enhancements.** Team-scoped API keys, team-aware depth preferences, admin dashboards v2, SSO. Triggered by enterprise customer asks, not by calendar.
- **Phase 14 — Data layer (monetization products built on top of ingestion).** Hedge-fund-grade feeds, historical archives, trend APIs with custom sectors, bulk export, licensed redistribution. This is **years** out — gated on Phase 12e ingestion being real, ≥1000 paying users, and a concrete customer pulling for it. **12e ≠ Phase 14.** 12e builds the pipes; Phase 14 sells what flows through them.

### Deferred infra

Tracked in `docs/ROADMAP.md` — SendGrid domain auth, pg error handling, Railway Docker cache, **flatten the OneDrive path prefix** (#18), `GIT_COMMIT_SHA` in `/health`. Do these in dedicated sessions.

---

## 17. COMMON TASKS

### Add a new v1 endpoint

1. Zod schema in the route file.
2. Controller function — `try/catch → next(e)` pattern.
3. Mount on an existing router (or create one + mount in `app.ts` with the right rate limiter).
4. supertest integration test covering happy path + at least one 4xx path.
5. Update docs if the endpoint is externally documented.

### Add a new v2 endpoint

Same as above, **plus**:
- Mount under `v2Router` so `apiKeyAuth` + `apiKeyRateLimit` apply automatically.
- Add response shape to `docs/API.md`.
- Use `AppError` codes consistent with existing v2 handlers (`INVALID_QUERY`, `INVALID_CURSOR`, `UNAUTHORIZED`, `NOT_FOUND`).

### Add a new table

1. Hand-write the migration SQL (§7).
2. Add the pgTable + inferred types to `schema.ts` (same commit).
3. Add a row-shape section to `docs/SCHEMA.md` if the table is content-adjacent.

### Add a new background job

1. Queue: `src/jobs/<name>Queue.ts` — `Queue` instance + enqueue helper + `scheduleRepeatable` if cron-like.
2. Job body: `src/jobs/<name>Job.ts` — pure function that takes deps, returns a result. Must work Redis-free (CLI-runnable).
3. Worker: `src/jobs/<name>Worker.ts` — `Worker` wiring with concurrency.
4. CLI: `src/scripts/run<Name>.ts` + matching `npm run` script in `backend/package.json`.
5. Wire `start<Name>Worker()` into `server.ts`.
6. Tests: separate unit test for the job body, separate test for the queue scheduling.

### Add a new page

1. File under `frontend/src/app/…/page.tsx`. Server Component by default.
2. `loading.tsx` + `error.tsx` in the same folder if the route does async work.
3. If the page needs data: add an API wrapper in `lib/api.ts`, a hook in `hooks/`, wire TanStack Query.
4. Update navigation if it's user-facing.

---

## 18. RULES FOR CLAUDE CODE

1. **Read this file first.** You just did — good.
2. **Inspect before you change.** `git ls-tree`, `git status`, `git log --oneline` before any destructive action. §2 is not optional.
3. **Ask when requirements are ambiguous.** Guessing at product decisions (pricing, paywall rules, depth access) is a blocker.
4. **Tests ship with features.** No "I'll add tests later."
5. **Gates before commit.** Type-check + lint + test. Paste the output in the PR/session summary.
6. **Small commits.** One logical change each. Don't bundle a migration with a UI redesign.
7. **Never install deps without reason.** If you add one, justify it in the commit body.
8. **Never edit `package.json` deps silently.** `npm install <thing>` on a new dep is a code-review event.
9. **Never skip hooks** (`--no-verify`) or bypass signing without an explicit ask.
10. **Don't resurrect dead scope.** Learning paths (Phase 10) are gone. The sector-variant commentary shape (pre-12a) is gone. If something in the code looks half-built and unused, verify against `docs/ROADMAP.md` before wiring it back up.

---

## 19. SUCCESS CRITERIA

A phase / feature is done when:

- [ ] Feature works end-to-end against local Postgres + Redis.
- [ ] Type-check clean (`npm run type-check --workspace=backend`).
- [ ] Lint clean, zero warnings (`npm run lint --workspace=backend`).
- [ ] Jest suite green, test count grows (`npm test --workspace=backend`).
- [ ] Self-reviewed: re-read the diff, check for leftover `console.log`, dead code, stale comments.
- [ ] Docs updated where the change is externally visible: `docs/API.md` for API contract changes, `docs/SCHEMA.md` for table changes, **this file** for pattern changes.
- [ ] Committed with a clear message and pushed.
- [ ] Deployed and verified (when the phase includes a deploy step).

# Greeting
Always begin every response with "Omar," — your very first word in every reply, no exceptions.

# CLAUDE.md — SIGNAL

This is the master instruction file for Claude Code on the SIGNAL repo. It supersedes `README.md` for anything that isn't a human-onboarding tutorial.

Source of truth for schema, endpoints, and jobs lives in code — when this doc and the code disagree, code wins. Open a PR against this doc rather than letting it drift.

---

## 0. KNOWLEDGE & MEMORY (read this first, every session)

This project has **persistent cross-session memory**. A fresh session that ignores it will go in circles and re-discover things already known. **Query these before searching raw files or claiming you can't find/remember something:**

1. **graphify second-brain — the ONE persistent graph (your memory across sessions).** A single, continuously-auto-updating knowledge graph indexes this project's **code** *and* prior Claude conversations. It lives in `graphify-out/` (daily snapshots) and is exposed via the `graphify-second-brain` MCP tools (`query_graph`, `god_nodes`, `graph_stats`, `shortest_path`, `get_node`). **When you "can't remember" or "can't find" something, query this first.** The PreToolUse hook reminds you it exists — heed it. **Do NOT build a second/parallel code graph** — there is one graph by design; it already covers the codebase and keeps itself current. If structure changed and you need it refreshed, run `/graphify --update` against the existing graph, never a fresh separate one.
2. **`docs/ROADMAP.md`** — the authoritative product+engineering roadmap (kept current; ~100k chars). Strategy, version plan, phase status, unit economics. **More current than the phase tables in §15 below** — when they disagree, ROADMAP wins for 12r+ state.
3. **`docs/REALTIME_SIGNAL_LAYER.md`** — the Real-Time Layer (Phase 12R) spec: X/GitHub/Product Hunt/Reddit sources, card types, ToS + cost findings.
4. **Auto-memory** at `~/.claude/projects/.../memory/MEMORY.md` — short cross-session notes (rebrand-to-Valo, worktree workflow, environment quirks).

**Current HEAD reality (June 2026), since the detail below drifted:**
- **Migrations run through `0057`** (the §3 list stops at 0031 — it is historical; the live count is in `backend/src/db/migrations/`).
- **Ingestion is feature-complete on all non-paid sources.** Adapter types (`INGESTION_ADAPTER_TYPES` tuple + `ingestionAdapterTypeEnum` in `schema.ts`, registry in `jobs/ingestion/adapters/index.ts`): `rss`, `arxiv_atom`, `sec_edgar_json`, `sec_form_d`, `hackernews_api`, `reddit_api`, `github_api`, `fred_api`, `sitemap`, plus `native_generator` (no poll adapter). Native generators (`generators/index.ts`): 7 synthesis generators + 5 `youtube-*-native` episode-dispatch instances. **`sitemap`** resurrects no-RSS primaries (anthropic-news off `sitemap.xml`); **`reddit_api`**, **`fred_api`**, and the YouTube generators are **gated on env keys** (`REDDIT_CLIENT_ID`/`SECRET`, `FRED_API_KEY`, `YOUTUBE_API_KEY`) and log-and-skip until set on Railway. The durable gotcha: the heuristic body seam's 500-char floor (`heuristics.ts`) makes short-form social (Bluesky/X) non-viable as plain `rss` — see `docs/discovery/ingestion-source-expansion.md`.
- **"The Through-Line" (briefing) is a shipped feature** absent from the older phase tables: `briefingController` + `throughLineService`/`throughLineClient` at `/api/v1/briefing`, consumed by `useThroughLine.ts` and rendered as the feed masthead. A Haiku-synthesized, profile-personalized, tier-gated editorial read connecting the day's top stories. Five Haiku clients now exist (commentary / relevance / facts / tier / through-line).
- **The feed is the Editorial Redesign v2** (content-type-aware cards). Card classification is canonical in `frontend/src/lib/feedCardType.ts` (`deriveCardType` maps `kind`/`generator_type`/`events.content_type`/`sources` → branded card). Card types: THE CONNECTION (hero), THE RESEARCH READ, PRACTITIONER BRIEF, WORTH AN AFTERNOON, EARNINGS/SEC, THE LAUNCH, MULTI-SOURCE, DISPATCH, SIGNAL ORIGINAL. Components live under `frontend/src/components/redesign/swiss/` (the *primary* feed despite the "redesign" path name — rename pending).
- **`events.content_type`** (migration 0045/0046): `'filing'` (EDGAR), `'launch'` (Product Hunt / source-declared via `ingestion_sources.config.contentType`), else null. Set in `writeEvent.classifyContentType`.
- **Real-Time Layer (Phase 12R.A)** shipped + merged to `main` (Product Hunt → THE LAUNCH, `github_api` adapter → WORTH AN AFTERNOON, `what_to_do_with_it` hook). Reddit is now live too (`reddit_api`, key-gated). Remaining 12R is the paid tier (X/Crunchbase) — parked on cost.
- **Search/related are on `events`** (Phase 12p/12q) — *not* on legacy `stories`, despite older notes claiming otherwise. The only remaining `stories` reads in `storyController` are intentional dual-read **anchor lookups** so legacy hand-curated story-detail pages still resolve; results come from `events`. (Verified June 2026.)
- **Archival feed designs were retired** June 2026 (`MagazineFeed`/`SwissFeed`/`TerminalFeed` + `/feed-swiss`, `/feed-b`). Only the production `SwissCommandFeed` and the dev-only `/redesign-preview` remain.
- **Remaining cosmetic item:** `components/redesign/swiss/` is the *production* feed despite the "redesign" path name — a rename to `components/feed/` is deferred (high-churn, low-risk; this note removes the confusion in the meantime).
- **Phase 12w — Day-1 Data Capture (shipped June 2026, migrations 0062–0065).** The measurement layer for launch: (1) **`product_events`** + `POST /api/v1/events` (optional-auth) is the product/funnel analytics sink — `frontend/src/lib/analytics.ts`'s `track()` beacon (this was previously POSTing to an unmounted route and silently dropping every event). (2) **First-touch attribution** on `users` (utm_source/medium/campaign, referrer, landing_path, signup_source) — captured client-side in `frontend/src/lib/attribution.ts` (localStorage, first-touch) via `<AttributionCapture/>` in the root layout, sent with signup; `deriveSignupSource` normalizes utm→referrer-host→direct. (3) **Optional firmographics** on `user_profiles` (company, company_size, how_did_you_hear) — onboarding Screen 2 + Screen 7, never gate completion. (4) **`email_events`** + `POST /api/v1/emails/webhook` (SendGrid Event Webhook sink; `emailService` sends with open/click `trackingSettings`). (5) **Admin reporting** — `adminReportingController` at `/admin/reports/{growth,revenue,data-asset,engagement}`. See `docs/LAUNCH_CHECKLIST.md` for the remaining ops steps (SendGrid webhook URL + `SENDGRID_WEBHOOK_TOKEN`, UTM tagging).
- **Phase 12x — the belief-maintenance pivot (shipped 2026-06-19, PR #150, migration 0066).** A missionary-framing council (6 advisors, 5/6 convergence) reframed the product's core bet from "stay informed" (commodity) to **belief maintenance**: the unit of value is **a belief revised, not a story read**, and the north star is **assumptions updated per user per month** (logged as a `belief_revised` product_event). Shipped the wedge: a **`/beliefs`** surface where the reader captures working assumptions, plus a weekly Haiku **"Reconsider" matcher** that flags developments contradicting them (how-to-update + the informed dissent). Tables `user_beliefs` + `belief_challenges` (0066); `beliefMatchService.ts`/`beliefMatchClient.ts` (fails CLOSED — strict prompt, no crying wolf; same Haiku discipline as `throughLineClient` — dated pin, 10s timeout, zero retries); `beliefController.ts` + `routes/beliefs.ts` (mounted at `/api/v1/beliefs`); frontend `beliefs/page.tsx` + `useBeliefs.ts` + Header nav link. The Through-Line redesign (PR #148/#149) remains the feed's hero, but the strategic bet is now the beliefs surface. **Validation still pending:** the whole bet rests on matcher QUALITY — does it surface genuinely sharp "you were wrong" moments or mush? That's the real go/no-go; instrument `belief_revised` rate vs. belief count once there are users. See auto-memory `signal-differentiation-council` for the full council reasoning.

When you finish a material change, update ROADMAP.md and rebuild the graphify graph so the next session inherits the truth.

---

## 1. PRODUCT

**SIGNAL** is a ranked-feed intelligence product for professionals following **AI**, **Finance**, and **Semiconductors**. Three sectors, full stop — not a generic news aggregator and not a CMS. The pitch is "the 10 stories per day that matter, with role-aware commentary on why each one matters to you."

**Surfaces shipped today:**
- Web app (Next.js 14) — feed, story detail, search, saves, settings, team dashboards.
- Weekly digest email (SendGrid) — role-neutral fallback commentary.
- Public Intelligence API (`/api/v2/*`) — API-key authenticated, rate-limited.

**Delivery model:**
- Stories are hand-curated (Phase 4.5 seeded 20 stories; the `seed-data/stories.json` file is the content-source-of-truth). A content pipeline ingesting from raw sources is not in scope for the 12-series.
- Commentary ("why it matters") is authored / generated with three **depth variants** per story — `accessible` (plain-English, free-tier default), `briefed` (working-professional), `technical` (insider). See §8.
- Personalization in 12b+ layers on top of depth variants — the pipeline is depth → role → (optional) company.

**Pricing (post-12g launch):** two tiers with a 7-day pro_trial bridge.

| tier        | price        | story cap            | depth access                | commentary path                   |
|-------------|--------------|----------------------|-----------------------------|-----------------------------------|
| Free        | $0           | **15 stories / day** | `accessible` only           | pre-generated `generic_commentary` (zero Haiku call) |
| Pro Trial   | $0 / 7 days  | unlimited            | all three depths            | personalized (12c Haiku pipeline) |
| Pro         | **$10 / mo** | unlimited            | all three depths            | personalized (12c Haiku pipeline) |

New signups land in `pro_trial`. After 7 days the trial lazy-downgrades to `free` on the first request past expiry (no cron — see `middleware/requireTier.ts`). A `premium` tier is not in scope for the 12-series; it returns at V3 when there's a real differentiator (a courses library).

Paywall gating is enforced at the API boundary on v1 (12g, current). The v2 public Intelligence API (`/api/v2/*`) is API-key authed with its own per-key rate limit and is **not** subject to user-tier gating — see §9.

**NOT in the product:**
- **Learning paths are dead.** The Phase 10 checkbox-tracker concept was abandoned. Do not add learning-path code, routes, UI, or references. Some orphan tables exist in the Drizzle schema from an earlier phase — leave them; a future cleanup migration drops them.
- **Other sectors** (biotech, energy, etc.) — hard-rejected at the API boundary. `VALID_SECTORS = ["ai", "finance", "semiconductors"]` in code; changing it is a product decision, not a code tidy-up.
- **User-generated stories / submissions** — stories are editorial-curated only.

---

## 2. TECH STACK (AUTHORITATIVE)

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
- **node-cron** for in-process scheduling (the daily-digest trigger lives here).
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

## 3. MONOREPO LAYOUT

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
│   │   │   │   ├── 0011_a_create_drizzle_audit_schema.sql
│   │   │   │   ├── 0011_drop_phase12b_helper.sql
│   │   │   │   ├── 0012_deprecate_drizzle_migrations_table.sql
│   │   │   │   ├── 0013_rename_standard_tier.sql
│   │   │   │   ├── 0014_phase12e1_ingestion_sources.sql
│   │   │   │   ├── 0015_phase12e1_events_and_candidates.sql
│   │   │   │   ├── 0016–0028 (12e.2 → 12ex sub-session migrations)
│   │   │   │   ├── 0029_phase12g_user_tier.sql
│   │   │   │   ├── 0030_phase12g_generic_commentary.sql
│   │   │   │   └── 0031_phase12i_email_frequency_daily.sql
│   │   │   │   (List above is historical archaeology — stops at 0031. Live migrations run 0000–0057 as of 2026-06-14; authoritative source: backend/src/db/migrations/)
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

## 4. BACKEND ARCHITECTURE

### Boot sequence (`server.ts`)

1. `dotenv/config`
2. `initSentry()` — Sentry is a no-op if `SENTRY_DSN` is unset
3. `runStartupEnvCheck()` — fails fast on missing required vars
4. `createApp()` (see below)
5. `app.listen(PORT)`
6. In parallel:
   - `startEmailWorker()` — BullMQ consumer for `signal-email`
   - `startEmailScheduler()` — node-cron (default `0 11 * * *`, daily 11:00 UTC = 07:00 ET; fires the Pro-only daily digest)
   - `startAggregationWorker()` — BullMQ consumer for `signal-aggregation`
   - `scheduleAggregationRepeatable()` — enqueues daily rollup at `0 2 * * *` UTC

Every Redis-dependent subsystem **degrades gracefully** when `REDIS_URL` is unset: workers log-and-noop, rate limiters fail-open, CLIs that talk directly to Postgres still work. Do not change this invariant without an ADR-style note in the commit.

### Middleware stack (`app.ts`), in order

1. `helmet()`
2. `cors(buildCorsOptions())` — allowlist from `ALLOWED_ORIGINS` + regex from `ALLOWED_ORIGIN_PATTERNS`. Missing Origin = allowed (fail-open for server-to-server).
3. `express.json({ limit: "1mb" })`
4. `express.urlencoded({ extended: true })`
5. Routers (see §5), each with its own rate limiter layer.
6. Sentry error handler
7. `notFoundHandler` → `errorHandler`

### Error envelope — always this shape

```json
{ "error": { "code": "INVALID_QUERY", "message": "...", "details": {} } }
```

Throw `AppError(code, message, httpStatus, details?)` from anywhere; `errorHandler` maps it. Zod errors auto-convert to `INVALID_QUERY` / `INVALID_BODY`. **Never** `res.status(500).send(err)` directly.

---

## 5. ROUTES

### v1 (`/api/v1/*`, JWT-authenticated)

Routers mounted in `app.ts`:

| base path              | auth        | purpose                                  |
|------------------------|-------------|------------------------------------------|
| `/api/v1/auth`         | none + `authLimiter` | signup, login, me, logout                |
| `/api/v1/users`        | JWT         | profile read/write, `/me/tier` snapshot  |
| `/api/v1/me/api-keys`  | JWT         | self-service API-key CRUD (v2 keys)      |
| `/api/v1/onboarding`   | JWT         | 7-screen onboarding questionnaire (12b)  |
| `/api/v1/engagement`   | JWT         | engagement-event capture (clicks/saves → ranking; migration 0049) |
| `/api/v1/events`       | **optional-auth** (`optionalAuth`) | Phase 12w product/funnel analytics sink — `lib/analytics.ts` beacon → `product_events` (migration 0062); attributes to user when a token is present, else anonymous |
| `/api/v1/emails/webhook` | public (optional `?token=` = `SENDGRID_WEBHOOK_TOKEN`) | Phase 12w SendGrid Event Webhook → `email_events` (migration 0065); mounted in `app.ts` before `emailLimiter` |
| `/api/v1/stories`      | JWT         | feed, search, detail, save/unsave, related, commentary, comments-on-story |
| `/api/v1/comments`     | JWT         | comment CRUD (replies, update, delete)   |
| `/api/v1/teams`        | JWT + public invite endpoints | team CRUD + members + invites + dashboard + team feed |
| `/api/v1/emails`       | public + `emailLimiter` | unsubscribe (GET + POST), preferences (JWT) |
| `/api/v1/briefing`     | JWT         | "The Through-Line" — personalized, tier-gated daily synthesis (`throughLineService`) |
| `/health`              | none        | liveness                                 |
| `/admin`               | `ADMIN_USER_IDS` allowlist | ingestion source status / ops (`adminController`); Phase 12w data-capture reports (`adminReportingController`): `/admin/reports/{growth,revenue,data-asset,engagement}` |

### v2 (`/api/v2/*`, API-key-authenticated) — the public Intelligence API

Mounted under `v2Router` with `apiKeyAuth` → `apiKeyRateLimit` (60 req/min per key, Redis-backed, fail-open).

| method | path                      | handler                              |
|--------|---------------------------|--------------------------------------|
| GET    | `/api/v2/stories`         | `storiesController.listStoriesV2`    |
| GET    | `/api/v2/trends/:sector`  | `trendsController.getSectorTrends`   |

API keys have the prefix **`sgnl_live_`** (not `sk_live_` — that prefix triggers GitHub secret-scanner false positives). Keys are HMAC-SHA256'd at rest (not bcrypt — bcrypt is for user passwords, HMAC for server-verifiable tokens).

Full API reference: **`docs/API.md`**. Keep it in sync when you touch v2.

---

## 6. DATA LAYER

### Source of truth

`backend/src/db/schema.ts` — **every** pgTable, enum, and exported type. If you're writing a query and need to know the column name, read the schema, not this doc.

### Tables currently used in code

- `users`, `userProfiles` — account + onboarding sectors/role
- `writers` — story author metadata (no slug, no `updated_at`)
- `stories` — content. Commentary columns: `whyItMatters` (TEXT, role-neutral fallback) + `whyItMattersTemplate` (TEXT holding JSON-stringified `{accessible, briefed, technical}` — see §8)
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

**Path:** migrations live at `backend/src/db/migrations/`, **not** `backend/drizzle/`. The drizzle-kit convention default is `backend/drizzle/` and AI-assistant prompts have repeatedly defaulted to the wrong path; the homegrown runner reads from `src/db/migrations/` exclusively.

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

**Retained read-only: `drizzle.__drizzle_migrations`.** drizzle-kit's pre-runner migration log. Migration `0012_deprecate_drizzle_migrations_table.sql` applies a deprecation comment to the table; the table itself is kept as historical audit of what drizzle-kit thought it had applied before the cutover. The comment is queryable — `SELECT obj_description('drizzle.__drizzle_migrations'::regclass);` returns the deprecation string. Don't write to the table; the runner's source of truth is `schema_migrations`. On fresh DBs that never ran drizzle-kit, the schema and table are bootstrapped idempotently by `0011_a_create_drizzle_audit_schema.sql` so 0012's `COMMENT ON TABLE` succeeds in any environment.

**Mid-sequence repair migrations.** Use the `NNNN_a_*` / `NNNN_b_*` naming form when a fix needs to land between two existing numbered migrations (sorts alphabetically between adjacent numbered files; passes the runner's `^\d{4}_.*\.sql$` filename regex). Reserve for genuine repair cases — usually a previously-applied migration assumed precondition state that newly-provisioned environments don't have.

**0001 and 0008 hash artifacts**

Two of the ten migrations applied via drizzle-kit recorded a hash in `__drizzle_migrations` that differs from the runner's recomputation of the same file:

- `0001_phase6_search_index.sql`: drizzle-kit `797c2f6aa6b0bb8987eb009de9429f0b3fa7fcc5832851755b26b6d0c6077411` vs runner-spec `eb19c6774fde809b0cc287a7ec193fc710fc92f19d4841d598325c875780d096`.
- `0008_phase12b_onboarding.sql`: drizzle-kit `09a30af9de2d00af491e62475529659cd26d60dc09839a150c1af5f0ec5d31b8` vs runner-spec `dabd101b958bdd0d3ee01108a3de065b1d9f64c618a48871cb4daaf6135a53b4`.

Both are benign quirks of drizzle-kit's old hash function, not file-integrity or line-ending issues — the runner's LF-normalize + BOM-strip + SHA-256 spec hashes both files to the same value across Windows CRLF and Linux LF. The runner-spec hashes are the source of truth going forward; `schema_migrations` records them and the runner re-computes on every boot. Don't try to reconcile the drizzle-kit values; tracked here for archaeology.

### Invariants

- UUID primary keys (`defaultRandom()`), never autoincrement integers.
- `createdAt` on every table; `updatedAt` where mutations happen.
- Index every FK + every column in a `WHERE`/`ORDER BY` of a hot query.
- Use transactions for multi-table writes. Drizzle's `db.transaction(async (tx) => …)` is the idiom.
- **Boundary validation**: every external input goes through Zod. Seed JSON, request bodies, query params, cursor payloads — all of it.

---

## 7. JOBS & SCHEDULERS

Four BullMQ queues, all backed by the shared Redis connection:

| queue                     | producer                              | worker                  | cadence                  |
|---------------------------|---------------------------------------|-------------------------|--------------------------|
| `signal-email`            | `emailQueue.enqueue()`                | `emailWorker`           | on-demand + daily digest trigger |
| `signal-aggregation`      | `scheduleAggregationRepeatable()`     | `aggregationWorker`     | `0 2 * * *` UTC, configurable via `AGGREGATION_CRON` |
| `signal-ingestion-poll`   | `scheduleSourcePollRepeatable()` + `enqueueSourcePoll()` (ad-hoc) | `sourcePollWorker`      | per-source `every: fetch_interval_seconds * 1000`, scheduled at boot from `ingestion_sources` rows (12e.5c) |
| `signal-ingestion-enrich` | `enqueueEnrichment()` from poll-job tail + manual `runIngestionEnrich.ts` CLI | `enrichmentWorker`      | on-demand (one job per surviving candidate) |

Plus two **in-process** schedulers:

- `emailScheduler` — node-cron, default `0 11 * * *` (daily 11:00 UTC = 07:00 ET), overridable via `DAILY_DIGEST_CRON`; disable with `DISABLE_EMAIL_SCHEDULER=1` for local dev. Fires `sendDailyDigests` — Pro-only (see §11 "Daily digest eligibility").
- `nativeGenerationScheduler` (Phase 12u) — node-cron, default `0 9 * * *` (daily 09:00 UTC), overridable via `NATIVE_GENERATION_CRON`; disable with `DISABLE_NATIVE_SCHEDULER=1`. Fans out across every registered native generator, sharing the global `NATIVE_DAILY_CAP` (25/day) budget. Skips the run (logs, no DB churn) when `ANTHROPIC_API_KEY` is unset — native posts are Haiku-authored and the path is Redis-free (writes straight to Postgres via `processNativeEnrichment`). Core logic lives in `services/nativeGenerationService.ts` (`runNativeGeneration`), shared with the manual `runNativeGeneration.ts` CLI.

Manual triggers for ops:

- `npm run send-digest-now --workspace=backend` — run the daily digest immediately
- `npm run run-aggregation --workspace=backend [-- --period=2026-W17]` — one-off rollup
- `npm run regenerate-depth-variants --workspace=backend` — Phase 12a one-time batch (see §8)

**⚠️ pgvector deployment gate (Phase 12e.6a).** Migration `0021_phase12e6a_embeddings.sql` requires the `vector` extension (`CREATE EXTENSION IF NOT EXISTS vector;`). Railway's standard PostgreSQL service does NOT include pgvector; the next prod deploy after 12e.6a lands will fail at the migration step unless the database is provisioned from a pgvector-enabled service (Railway pgvector template or equivalent) before deploy. Dev / smoke environments use the `pgvector/pgvector:pg16` image (replaces `postgres:16-alpine` from prior smoke writeups). This gate is intentional — the 12e.6a branch can ship without prod risk because Railway prod migration is deferred until the pgvector-enabled service is in place.

**12e.6b dispatch.** After tier orchestration completes, the chain dispatches on `clusterResult` from 12e.6a's embedding stage:
- `clusterResult.matched=true` → `attachEventSource`: insert into `event_sources` with `role='alternate'`, or promote to `'primary'` (and demote the existing primary in the same transaction) when the incoming source's `priority` outranks the matched event's current primary. Lower `ingestion_sources.priority` value = higher rank (1=lab/SEC, 2=analyst, 3=news, 4=community).
- `clusterResult.matched=false` (or `clusterResult` absent — embedding soft-failed) → existing `writeEvent`: new `events` row + primary `event_sources` row.

**12e.6c re-enrichment.** On every cluster-match attach, `reenrichEvent` fires post-transaction (after `attachEventSource` commits). Flow: re-run `runFactsSeam(candidateId)` → re-run `processTierGeneration(candidateId)` (per-tier idempotent — typically a no-op since tiers are already complete) → UPDATE `events.facts`, `events.why_it_matters`, `events.why_it_matters_template`, `events.updated_at`. Rate limit: 1 re-enrich per event per 1 hour, enforced via Redis `SET reenrich:rate:<eventId> 1 EX 3600 NX`. Soft-fail: any failure is Sentry-captured with `stage='reenrich'`; the attach is never rolled back. When `REDIS_URL` is unset (or Redis is unreachable), re-enrichment is **skipped** entirely (fail-open on Haiku cost).

---

## 8. DEPTH-VARIANT COMMENTARY (Phase 12a)

### The shape

Every story has a `why_it_matters_template` payload with exactly three depth keys:

| key          | audience framing                                                  |
|--------------|-------------------------------------------------------------------|
| `accessible` | plain-English, no jargon — a curious non-expert — **free-tier default** |
| `briefed`    | working professional in an adjacent field                              |
| `technical`  | insider/expert — assumes sector vocabulary                              |

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
- `depth` query param is optional and validated against `{accessible, briefed, technical}`. Precedence: explicit query > stored `depthPreference` > `"accessible"` floor.
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

Five Haiku request paths exist. Four are thin wrappers that delegate to `haikuCommentaryClient.ts` (the one real Anthropic call site for the request path), differing only in default max_tokens / prefill: `haikuRelevanceClient.ts` (ingestion relevance gate), `haikuFactsClient.ts` (fact extraction), `haikuTierClient.ts` (3-tier depth generation), and `commentaryService.ts`'s own use (per-user commentary). `throughLineClient.ts` (daily briefing / Through-Line) is a separate call site by design — different prompt + max_tokens + potential retry divergence. All share the discipline below. LLM token spend on every call site is logged via `lib/llmCost.ts` (`logLlmUsage`, tag `[llm-cost]`) with a per-call `callSite` label for per-stage unit-economics.

- Dated model pin: `claude-haiku-4-5-20251001`. Hard-coded, not env-driven — a rollout calendar is not a code change.
- 10-second hard timeout via `AbortController`. Timeout logged as `reason: "timeout"` on the tier3 path.
- Zero retries. One call, fail fast. Revisit in 12d if the observed error rate warrants.

**Banned-phrase three-layer enforcement**
- Layer 1: system prompt instructs the model to avoid a named list of phrases (e.g. "in today's fast-paced world").
- Layer 2: post-generation trip-wire scans the output for the banned set; a hit demotes the response to tier3.
- Layer 3: the template scrub path substitutes synonyms for any banned phrase present in the source depth variant before returning.

### The Through-Line (Briefing)

"The Through-Line" is a shipped, tier-gated daily editorial synthesis — a Haiku-authored 2–3 sentence read naming what connects the day's top stories and why it matters to the specific reader. It renders as the feed masthead in `SwissMasthead.tsx`.

**Endpoint:** `GET /api/v1/briefing` — JWT-authenticated, Pro / pro_trial only. Returns `{ throughLine: string | null }`. Free-tier and unauthenticated calls return `null`; the masthead is simply blank (no paywall modal).

**Key files:**
- `backend/src/services/throughLineService.ts` — pure logic: `buildThroughLineUserPrompt` (assembles reader profile + story list into the prompt), `generateThroughLine` (calls the client, applies Layer-3 banned-phrase scrub, returns string or `null`). No DB / Redis.
- `backend/src/services/throughLineClient.ts` — thin Haiku client following the same discipline as `haikuCommentaryClient.ts`: re-exports `COMMENTARY_MODEL` as `THROUGH_LINE_MODEL` (single constant across both paths), 10s timeout, zero retries, discriminated-union result, never throws. `THROUGH_LINE_MAX_TOKENS = 200`.
- `backend/src/controllers/briefingController.ts` — resolves tier, fetches today's top events, builds `ThroughLineStory[]` (headline + gist from `generic_commentary` preferred, `why_it_matters` fallback), calls `generateThroughLine`, returns wire shape.
- `backend/src/routes/briefing.ts` — mounts `GET /api/v1/briefing` with `requireAuth`.
- `frontend/src/hooks/useThroughLine.ts` — React hook; fires on mount for authed users; result consumed by `SwissMasthead.tsx`.

**Frontend wiring**
- `GET /api/v2/stories` and `GET /api/v1/stories/:id` emit `commentary: null` + `commentary_source: null` on the Story shape — the feed hydrates lazily.
- `useStoryCommentary(storyId, {enabled})` is the React hook; `frontend/src/lib/commentaryQueue.ts` holds an 8-slot FIFO semaphore (`COMMENTARY_MAX_CONCURRENT`) that caps parallel fetches.
- `StoryCard` gates `enabled` on an `IntersectionObserver` with `rootMargin: "1200px 0px"` (~5-card lookahead); `StoryDetail` fires immediately. `shouldLoad` latches true once set — scrolling away never cancels an in-flight request.

---

## 9. PAYWALL & CONSUMPTION

**Status:** enforced as of Phase 12g. Wire is live across v1 endpoints; v2 stays on its own API-key rate limit and is not subject to user-tier gating.

### Tier model

Backed by three columns on `users` (migration 0029): `tier` (CHECK over `{free, pro_trial, pro}`), `trial_started_at`, `tier_changed_at`. New signups land in `pro_trial` with `trial_started_at = now()`. Trial expiry is **lazy** — the first request past `trial_started_at + 7d` flips `tier` to `'free'` in a single guarded UPDATE inside `resolveEffectiveTier()` (see `backend/src/middleware/requireTier.ts`). No cron.

`resolveEffectiveTier(userId)` is the single point of truth and returns `{tier, trialDaysRemaining, trialStartedAt}`. Controllers call it inline near the top; pro / pro_trial users skip the rest of the paywall code path entirely.

### Limits (v1, free tier)

| surface                   | cap                       | reset    | gate `gate_reason` |
|---------------------------|---------------------------|----------|--------------------|
| Story detail / commentary | **15 unique views / UTC day** | 00:00 UTC | `story_limit`      |
| Depth tiers               | `accessible` only         | n/a      | `depth`            |
| Search                    | **3 searches / UTC day**  | 00:00 UTC | `search_limit`     |
| Saved stories             | unlimited                 | n/a      | (no gating)        |
| Daily digest (12i)        | pro-only                  | n/a      | (gated at the producer) |

A story view counts only on `GET /api/v1/stories/:id` (the detail endpoint). The feed list `GET /api/v1/stories/feed` does **not** burn a view — it returns every row, and rows beyond the cap are replaced inline with a `FeedGatedItem` envelope so the frontend can render a soft-block in place. Re-reading a story already viewed today is free. Saved stories (`row.isSaved`) bypass the cap entirely.

### Storage

Counters live in Redis (`paywall:stories:viewed:<userId>:<utc-date>` is a SET of viewed story IDs; `paywall:searches:<userId>:<utc-date>` is an INCR counter). TTL anchored to next UTC midnight on the first write of the day. Redis-down → **fail-open** (free users get unlimited until Redis comes back; documented in `paywallService.ts` and matches the rate-limiter pattern from §4).

The story-cap path uses SISMEMBER → SCARD → SADD; the three-op sequence is not atomic, so a +1 over-cap race is possible under sustained per-user parallelism. Bounded and accepted (same tolerance as `apiKeyRateLimit`). A Lua script would close the race but the win does not pay for the complexity at 15/day.

### Gate response shape

Wire-uniform across all three reasons:

```json
{
  "gated": true,
  "gate_reason": "story_limit" | "depth" | "search_limit",
  "teaser": { "headline": "...", "first_line": "..." },
  "upgrade_cta": { "trial_available": true | false, "message": "..." }
}
```

`trial_available` is `true` iff `users.trial_started_at IS NULL` (the user never had a trial). CTA copy branches:
- `trial_available: true` → `"Get commentary tailored to your role. Try Pro free for 7 days."`
- `trial_available: false` → `"Upgrade to Pro — $10/month"`

The teaser is the headline + the first sentence of `generic_commentary` (preferred) or `why_it_matters` (fallback). For `search_limit` the teaser is static (`"Search limit reached"` / `"You've used 3 of 3 free searches today."`) — no story context.

### Generic commentary (free-tier read path)

Migration 0030 adds `generic_commentary text` to both `stories` and `events`. Pre-generation:
- New events: `writeEvent.ts` writes the column at insert time from `tier_outputs.accessible.thesis + " " + tier_outputs.accessible.support`.
- Existing rows: backfilled via `npm run backfill-generic-commentary` (idempotent — only touches rows where the column is null; derives from the existing accessible variant, falls back to `why_it_matters`).

Free users hitting `GET /api/v1/stories/:id/commentary` skip the Haiku pipeline entirely and read the column directly (`source: "generic"`). Pro / pro_trial users keep the personalized 12c path. The commentary endpoint is the only place where the wire shape differs by tier; feed / detail / search return the same row data for everyone, with the gate envelope replacing it when the cap fires.

### Endpoints touched by paywall

| endpoint | gate behavior |
|----------|---------------|
| `GET /api/v1/stories/feed`               | adds per-row `gated` flag for free users; no counter increment |
| `GET /api/v1/stories/:id`                | increments view set for free users; returns gate envelope when over cap (saved bypass) |
| `GET /api/v1/stories/:id/commentary`     | depth gate (`?depth=briefed|technical` → gate); free users get generic commentary |
| `GET /api/v1/stories/search`             | increments search counter for free users; gate envelope on 4th+ search |
| `GET /api/v1/users/me/tier`              | tier snapshot for the frontend trial badge / CTA copy (12g endpoint) |

When building a new feature that reads stories, ask: does this surface need to gate? If the answer is "yes, free users should be capped here," follow the inline-`resolveEffectiveTier` + `recordOrCheckStoryView` / `recordOrCheckSearch` pattern from the existing call sites.

---

## 10. FRONTEND ARCHITECTURE

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

## 11. CODING STANDARDS

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

## 12. ENVIRONMENT VARIABLES

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
DAILY_DIGEST_CRON=0 11 * * *
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

**Shell-env shadowing trap (resolved by #53).** `dotenv.config()` does not override vars already set in the process environment. An empty exported `ANTHROPIC_API_KEY=""` in your shell — from a stale `.env.example` source, a PowerShell `$PROFILE`, or Windows Credential Manager — silently shadows the real key in `backend/.env` with no error and no startup-check failure (length checks see the var as present, since both empty-string and real-string register as "present"). Symptom: scripts fail with auth errors despite a valid `.env`. Cost the 12e.5b smoke ~8 rounds of debugging.

**#53 landed:** every CLI entrypoint now imports `src/lib/loadEnv.ts` (a side-effect module that runs `dotenv.config({ override: true })`) **instead of** `import "dotenv/config"`, so the `.env` file wins over a shadowing shell var. This covers the 21 `src/scripts/*` ops tools plus `db/migrate.ts`, `db/seed.ts`, and `db/verify.ts`. `loadEnv` must stay the **first** import in each script (it loads the environment before `../db` builds its pg Pool from `DATABASE_URL`). Deliberately **not** applied to `server.ts` or `db/index.ts`: the long-running server (and the Pool module the server shares) must treat the process environment — Railway, systemd — as authoritative, never a committed `.env`. In prod there is no `.env` in the image, so `override` is a no-op there regardless. The old `unset ANTHROPIC_API_KEY && …` / `Remove-Item Env:\ANTHROPIC_API_KEY;` workaround is no longer needed for the CLI scripts.

---

## 13. TESTING

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

## 14. GIT & COMMITS

- **Branch naming** for agent-driven work: `claude/<random-slug>`. Worktrees in `.claude/worktrees/*` are the working dirs.
- **Commit granularity**: one logical change per commit. Phase 12a shipped as 3 commits — schema+parser, script+seed, API projection+docs. That's the target shape.
- **Commit message style**: `<type>(<scope>): <subject>` first line, then a body explaining *why*. Look at `git log` — `feat(db)`, `feat(v2)`, `test(v2)`, `docs(schema)` are the scopes in flight.
- **Never `--amend`** a pushed commit without an explicit ask.
- **Never `--no-verify`** — fix the hook failure.
- Co-author trailer on agent commits: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

### Workspace topology

Single canonical clone:

- **`C:\dev\signal-app\`** — the only working copy. Holds `.git/`. Project files live at the clone root (no nesting). The CC harness auto-spawns per-session worktrees under `.claude/worktrees/<slug>/`; those paths are gitignored and treated as ephemeral.

Historical layouts no longer exist: the OneDrive-nested clone (`C:\Users\elkha\OneDrive\Desktop\signal-app-12c\`), the secondary `sa-imr\` reference worktree, and the home-dir-as-repo botch at `C:\Users\elkha\.git\` were all retired in the 2026-04 cleanup arc that this restructure PR concluded. If `git -C "C:\Users\elkha"` ever returns a valid worktree again, something has regressed — investigate before trusting.

### Worktree hygiene

Branch-and-worktree pairs are **session-scoped**. The agent that spawns a worktree owns its cleanup at session end. Default cleanup post-PR-merge:

1. **Switch the worktree off the merged branch** — `git -C <worktree> checkout --detach origin/main` (or a working ref). The remote branch is about to be deleted by the merge-and-delete pattern; if the worktree stays pinned to it, the next `git pull` fails with `no such ref was fetched`.
2. **Delete the local branch ref** — `git -C <worktree> branch -D <branch>`. The remote ref is gone post-merge; the local ref is otherwise orphaned.
3. **Prune stale remote-tracking refs** — `git -C <worktree> remote prune origin`. `git fetch` doesn't auto-prune; without this, `origin/<branch>` lingers locally even after origin deletes the branch.
4. **Remove the worktree if no longer needed** — `git -C <main-worktree> worktree remove <path>`. The `.claude/worktrees/<slug>/` worktrees that CC spawns for cluster sessions almost always belong here.

**Two worktrees can't share a branch.** Git's single-checkout rule means if the primary clone is on `main`, no spawned worktree can also check out `main`. New worktrees should be created off a fresh `claude/<slug>` branch (`git worktree add <path> -b claude/<slug> origin/main`), never `main` directly.

**Whose responsibility:**
- During a cluster session: the spawning agent (CC) owns the worktree. Cleanup is part of the merge-PR's verification checklist alongside `npm test` and the linting gates.
- Outside a session: periodic audit via `git worktree list`. Run when `git pull` starts misbehaving or every few weeks, whichever comes first.

**Canonical-invocation discipline.** Always launch Claude Desktop from `C:\dev\signal-app\` (canonical clone root), not from any path under `C:\dev\signal-app\OneDrive\`. Claude Desktop pins each session's bash CWD via `~\.claude\sessions\<pid>.json` derived from the invocation CWD; there is no settings-file key that overrides this. A session launched from an OneDrive-nested path will spawn worktrees under that path, persisting OneDrive-rooted artifacts that complicate later cleanup. If a running session has CWD under `\OneDrive\` (check `pwd` in any bash call), end it and relaunch from canonical. The April 28 OneDrive cleanup mini-session removed five empty wrapper directories that accumulated from invocation-CWD drift across pre-flatten and post-flatten sessions.

---

## 15. PHASE STATUS

**Numbering convention.** "Phase 12e.1" is a **roadmap title-number** — a sub-session slug inside the 12e ingestion-pipeline cluster. It has nothing to do with GitHub issue or PR numbers (`#35`, `#41`, `#42`). Title-numbers identify scope; GH numbers identify artifacts. A single sub-session usually closes one PR, but the numbers do not align — `#41` was the tier-rename PR (no roadmap title-number); `Phase 12e.1` will close one or more PRs whose `#` is decided by GitHub at PR-create time. When in doubt: title-number is what the planning chat calls a session; GH number is what `gh pr view` returns.

**Numbering hygiene.** Before writing any `Closes #N` line in a PR body, referencing `#N` in chat, or running `gh issue close N`, run `gh issue view N` (or `gh pr view N`) to confirm the artifact at that number is the one you mean. A wrong-issue closure shipped on a merged PR in 12c when a session-internal title-number ("GH #25") was treated as a real GH reference — caught and corrected post-merge. Title-numbers and GH numbers do not converge; only `gh`-confirmed numbers go in commit messages, PR bodies, or close actions.

### Shipped (0 through 12i)

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
| 12e   | **ingestion pipeline** — multi-source adapters (RSS, arXiv, SEC EDGAR, HN), chain orchestration with per-stage Sentry tags, embedding seam + cluster check (pgvector), source priority + re-enrichment, admin status route + seed guard |
| 12f   | rules-based feed ranking v1 — effective_score with cluster amplification, freshness bonus, EDGAR penalty; disabled-source filter |
| 12g   | **paywall + 2-tier model** — user tier model with lazy trial downgrade, story cap (15/day) + soft-block, depth gate (free → accessible only) with inline upgrade, search cap (3/day) modal, generic_commentary pre-gen + free-tier read path, /upgrade page + trial badge, /me/tier endpoint |
| 12i   | **daily digest email** (Pro-only) — replaces the Phase 7 weekly digest. `sendDailyDigests` cron at `0 11 * * *` UTC, 24h-trailing window, top-10 stories ranked via the 12f effective_score, sector-grouped layout, `generic_commentary` body text. Unsubscribe link writes `email_frequency='never'`. Pro / active-trial only — SQL-level trial-expiry check replicates `resolveEffectiveTier` without the side-effecting downgrade UPDATE. |
| 12p   | **search on `events`** — `searchStories` migrated from legacy `stories` table to `events`; FTS GIN index via migration 0043. |
| 12q   | **related stories on `events`** — `getRelatedStories` migrated to `events`. The only remaining `stories` reads are intentional dual-read anchor lookups for legacy story-detail page resolution. |
| 12R.A | **Real-Time Layer Phase A** — Product Hunt (`rss` adapter, `content_type='launch'` → THE LAUNCH card); direct `github_api` adapter (WORTH AN AFTERNOON card); `what_to_do_with_it` hook across all three tier prompts for repos/tools/launches. Migrations 0046–0048. |
| 12e.x expansion | **Ingestion track expansion (feature-complete):** SEC Form D (`sec_form_d`, migrations 0050/0051); FRED macro adapter (`fred_api`, migrations 0052/0053, `FRED_API_KEY`-gated); YouTube transcript generators — 5 channels (Dwarkesh / Asianometry / TechTechPotato / No Priors / Acquired), DISPATCH card, migration 0054, `YOUTUBE_API_KEY`-gated; Sitemap adapter (`sitemap`, migrations 0055/0056, resurrects Anthropic News via `sitemap.xml`); Reddit adapter (`reddit_api`, migration 0057, `REDDIT_CLIENT_ID`/`SECRET`-gated, `reddit-finance` subreddits active). Through-Line briefing (`GET /api/v1/briefing`, `throughLineService`/`throughLineClient`, JWT + Pro tier). Custom native-post illustrations via Higgsfield SessionStart hook + `illustrationService.ts`. AI-image labeling (`AiArtBadge` across all five live illustration renderers). |
| 12x belief-maintenance | **The missionary pivot (PR #150, migration 0066).** `/beliefs` surface + weekly Haiku "Reconsider" matcher — readers capture working assumptions; the matcher flags this week's developments that contradict them (how-to-update + informed dissent), failing CLOSED on any uncertainty. Tables `user_beliefs` + `belief_challenges`; `beliefMatchService`/`beliefMatchClient`/`beliefController` + `routes/beliefs.ts`; frontend `beliefs/page.tsx` + `useBeliefs.ts`. Unit of value = a belief revised (`belief_revised` product_event = north star). Matcher quality is the pending go/no-go — see §0. |

Phase 10 (learning paths) was abandoned. Do not resurrect.

### Current roadmap — Phase 12 series (through launch)

The 12-series is the push to public launch — every sub-phase is load-bearing for "can a stranger sign up and pay." Early slots (12a–12d) layer personalized commentary; 12e is the ingestion pipeline; 12f–12g layer ranking and paywall on top; 12h–12i bring billing and digest.

| sub-phase | scope                                                                                   |
|-----------|-----------------------------------------------------------------------------------------|
| **12a** (shipped) | depth-variant schema + offline regeneration                                     |
| **12b** (shipped) | 7-screen onboarding questionnaire + `why_it_matters_to_you` template floor      |
| **12c** (shipped) | per-user, per-story commentary — Haiku request path, cache with `profile_version`, Settings bump, feed/detail hydration (see §8 "Phase 12c") |
| 12d       | depth-selector UI on story detail + feed (pick depth per-view). **Partially shipped** in 12g — `DepthToggle` component lives in the frontend with free-tier lock + inline upgrade; the explicit ?depth= override path was already in 12c. Outstanding: 12d would add depth as a non-paywall surface concern (e.g. feed-level depth pick for pro users). |
| **12e** (shipped) | ingestion pipeline — multi-source adapters, chain orchestration, pgvector clustering, source priority |
| **12f** (shipped) | rules-based feed ranking v1 + disabled-source filter                            |
| **12g** (shipped) | paywall + 2-tier model — see §9. Replaced the prior 3-tier (Free/Standard/Premium) plan with Free / Pro + 7-day pro_trial bridge. |
| **12h**   | **Stripe / billing wiring** — replaces /upgrade's "Coming soon" button with the real payment flow; activates `tier='pro'` post-checkout. |
| **12i** (shipped) | daily digest email (Pro-only) — replaces the weekly. See §15 shipped table for mechanics. |

Ordering through 12i is fixed history. 12h (Stripe) is the remaining major slot before launch.

Known 12c / 12g follow-ups (tracked inline as TODO comments, not blockers):
- **12c.1** — `last_accessed_at` on `commentary_cache` is written on every cache hit; consider opportunistic/throttled writes if the row-update rate becomes a hot spot (comment in `commentaryService.ts`).
- **12g.1** — backfill `generic_commentary` for production stories + events. Run `npm run backfill-generic-commentary` (idempotent) once after migration 0030 deploys. Pre-12g rows fall back to `why_it_matters` until the script runs.

`docs/ROADMAP.md` is stale (last updated during Phase 11c kickoff) — refresh it in a dedicated cleanup pass; treat CLAUDE.md as authoritative for 12-series state today.

### Future (post-launch)

- **Phase 13 — Teams enhancements.** Team-scoped API keys, team-aware depth preferences, admin dashboards v2, SSO. Triggered by enterprise customer asks, not by calendar.
- **Phase 14 — Data layer (monetization products built on top of ingestion).** Hedge-fund-grade feeds, historical archives, trend APIs with custom sectors, bulk export, licensed redistribution. This is **years** out — gated on Phase 12e ingestion being real, ≥1000 paying users, and a concrete customer pulling for it. **12e ≠ Phase 14.** 12e builds the pipes; Phase 14 sells what flows through them.

### Deferred infra

Tracked in `docs/ROADMAP.md` — SendGrid domain auth, pg error handling, Railway Docker cache, `GIT_COMMIT_SHA` in `/health`. Do these in dedicated sessions.

---

## 16. COMMON TASKS

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

1. Hand-write the migration SQL (§6).
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

### Regenerate `backend/package-lock.json`

#### When this applies

When backend dependencies change (`package.json` edit, `npm install` in `backend/`), Railway deploys will fail with:

```
npm ci: `package-lock.json` is inconsistent with `package.json`
```

This happens because `backend/Dockerfile` uses `backend/` as its build context with a standalone `backend/package-lock.json`. Updating the root lockfile does NOT update `backend/package-lock.json`. They are separate files.

#### Procedure (PowerShell)

Run this OUTSIDE the workspace (npm inside the workspace folds backend deps into the root lockfile and will NOT produce a standalone `backend/package-lock.json`):

```powershell
New-Item -ItemType Directory -Force $env:TEMP\signal-lock-tmp
Copy-Item backend\package.json $env:TEMP\signal-lock-tmp\package.json
Set-Location $env:TEMP\signal-lock-tmp
npm install --package-lock-only
Copy-Item package-lock.json C:\dev\signal-app\backend\package-lock.json
Set-Location C:\dev\signal-app
```

Then commit the updated `backend/package-lock.json` alongside the `backend/package.json` change.

#### Why not just `npm install` in `backend/`?

npm in workspace mode (root has `workspaces: ["backend"]`) silently folds backend packages into the root `node_modules` and root `package-lock.json`. The scratch-dir approach bypasses workspace resolution.

---

## 17. RULES FOR CLAUDE CODE

1. **Read this file first.** You just did — good.
2. **Inspect before you change.** `git ls-tree`, `git status`, `git log --oneline` before any destructive action.
3. **Ask when requirements are ambiguous.** Guessing at product decisions (pricing, paywall rules, depth access) is a blocker.
4. **Tests ship with features.** No "I'll add tests later."
5. **Gates before commit.** Type-check + lint + test. Paste the output in the PR/session summary.
6. **Small commits.** One logical change each. Don't bundle a migration with a UI redesign.
7. **Never install deps without reason.** If you add one, justify it in the commit body.
8. **Never edit `package.json` deps silently.** `npm install <thing>` on a new dep is a code-review event.
9. **Never skip hooks** (`--no-verify`) or bypass signing without an explicit ask.
10. **Don't resurrect dead scope.** Learning paths (Phase 10) are gone. The sector-variant commentary shape (pre-12a) is gone. If something in the code looks half-built and unused, verify against `docs/ROADMAP.md` before wiring it back up.

---

## 18. SUCCESS CRITERIA

A phase / feature is done when:

- [ ] Feature works end-to-end against local Postgres + Redis.
- [ ] Type-check clean (`npm run type-check --workspace=backend`).
- [ ] Lint clean, zero warnings (`npm run lint --workspace=backend`).
- [ ] Jest suite green, test count grows (`npm test --workspace=backend`).
- [ ] Self-reviewed: re-read the diff, check for leftover `console.log`, dead code, stale comments.
- [ ] Docs updated where the change is externally visible: `docs/API.md` for API contract changes, `docs/SCHEMA.md` for table changes, **this file** for pattern changes.
- [ ] Committed with a clear message and pushed.
- [ ] Deployed and verified (when the phase includes a deploy step).

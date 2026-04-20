# Phase 9 Closeout — Teams / Enterprise

**Status:** ✅ Shipped to prod. All P0, P1, P2 items verified live.
P3 cleanup sprint (tickets #10, #11, #14, #15, #16, and this document)
committed on `claude/p3-cleanup-sprint`, awaiting owner merge.

This doc is the source of truth for what Phase 9 shipped, what was
deferred, and what Session 6+ picks up.

---

## Prod commits on `main`

| SHA | Message |
|---|---|
| `d0525d1` | chore: force Railway rebuild to apply migration 0004 |
| `1058b0f` | Phase 9 P2 #8: distinguish revoked from accepted invites (merge) |
| `c787d4c` | feat(teams/invite): show distinct revoked badge in pending invites |
| `9496dc2` | fix(teams/invite): distinguish revoked from accepted in invite status |
| `c9ec391` | feat(db): add team_invites.revoked_at for distinguishing revoke from accept |
| `9ca9bc3` | Phase 9 P2 polish (merge): pluralize member count + dashboard empty state copy |
| `2eb6c31` | polish(phase9): pluralize member count + dashboard empty state copy |
| `3fe0e9c` | Phase 9 P1 #3 follow-up: split INVALID_INVITE into signature vs not-found |
| `707dfd7` | fix(teams/invite): split INVALID_INVITE into signature vs not-found |
| `762b1ba` | Phase 9 P1 hotfixes (merge): distinguish expired invite + fix members cache invalidation |
| `108466e` | fix(teams/invite): invalidate team, members, invites, dashboard on invite accept |
| `7512171` | fix(teams/invite): distinguish expired from invalid in accept flow |
| `f222f39` | fix(teams/dashboard): enforce admin role and surface correct 403 copy |
| `4dae2d8` | fix(ops): warn loudly in prod when critical env vars are missing at boot |
| `4a9ab80` | Phase 9b-3b: unauth invite join page, pending invites, recharts dashboard, polish |

## Session 5 commits on `claude/p3-cleanup-sprint` (not yet on main)

| SHA | Message |
|---|---|
| `07646d2` | feat(api): add /health endpoint with commit SHA and build time |
| `677ea58` | fix(db): surface pg connection failures as 503 via error handler |
| `3fb03b2` | fix(smoke): add Vercel origin CORS preflight check |
| `8a13ff3` | docs: sync team_invites schema and frontend naming convention in CLAUDE.md |
| _pending_ | docs(phase9): create PHASE_9_CLOSEOUT.md as repo source-of-truth (this commit) |

## Prod URLs

- Frontend (Vercel, main alias): `https://project-nvrod.vercel.app`
- Frontend (Vercel, branch alias): `https://project-nvrod-git-main-oelkhateeb6-1333s-projects.vercel.app`
- Backend (Railway): `https://signal-app-production-cd33.up.railway.app`

---

## What Phase 9 shipped

- **9a — Team CRUD backbone.** Teams table + team_members, Drizzle schema,
  controllers for create/read/list, membership seeding for the creator.
- **9b-1 — Invites API.** `team_invites` table, HMAC-signed tokens,
  list/create/resend/revoke endpoints, SendGrid invite email template,
  rate limits.
- **9b-2 — Team feed + members UI.** Frontend `/teams`, `/teams/[id]`,
  `/teams/[id]/members` with admin-only invite form, pending-invites
  panel, role badges.
- **9b-3a — Invite accept flow.** `/teams/join?token=...` page handling
  the four invite states (pending, used, expired, invalid signature vs
  invalid token), new-to-SIGNAL signup branch, existing-user accept branch,
  "different account signed in" warning.
- **9b-3b — Dashboard + polish.** `/teams/[id]/dashboard` with metric cards
  + Recharts pie/bar, admin-only gate, stories-by-sector + top-saved
  tables, skeletons, error boundaries, mobile pass.

---

## Smoke test verification table

All 11 steps of `docs/SMOKE_TEST_TEAMS.md` verified green on prod, plus
P2 #8 revoked badge verification as step 12.

| # | Step | Status |
|---|---|---|
| 1 | Create a team | ✅ |
| 2 | Configure sectors | ✅ |
| 3 | Invite a new-to-SIGNAL user | ✅ |
| 4 | Accept invite as new user | ✅ |
| 5 | Invite an existing SIGNAL user | ✅ |
| 6 | Invite link — wrong signed-in account | ✅ |
| 7 | Invite link — already used | ✅ |
| 8 | Invite link — expired | ✅ |
| 9 | Invite link — invalid token | ✅ |
| 10 | Resend and revoke invites | ✅ |
| 11 | Dashboard (admin + non-admin) | ✅ |
| 12 | Revoked invite shows distinct rose badge + `revoked {date}` sub-line (P2 #8) | ✅ |

Session 5 adds a **step 0** (CORS preflight sanity against the real Vercel
origins) so the same regression can't slip past undetected again.

---

## Critical incidents found and resolved

### 1. CORS allowlist regression

**Symptom:** the prod Vercel URL was blocked by the backend preflight even
though `localhost:3000` was accepted; the entire Teams surface appeared
broken in the browser.

**Root cause:** the allowlist used an exact-match string list, but Vercel
issues new immutable deploy URLs per push, so the configured origin went
stale on every deploy.

**Fix:** switched to a regex allowlist (`DEFAULT_ORIGIN_PATTERNS` in
`backend/src/app.ts`) that matches any deploy under this project's Vercel
scope. `ALLOWED_ORIGIN_PATTERNS` env var can override.

**Follow-up (Session 5):** smoke test now sends real Vercel origins in the
preflight to exercise the regex branch, not just localhost.

### 2. Railway Docker cache masking a fresh migration

**Symptom:** committed + pushed migration 0004 (`team_invites.revoked_at`),
Railway reported a successful deploy, but `/api/v1/teams/{id}/invites`
still returned rows without the `revoked_at` field — the container was
running stale code.

**Root cause:** Railway's Docker build cache reused a prior layer that
predated the migration file; the `migrate` step ran silently over an
already-up-to-date table.

**Fix:** force-rebuild commit (`d0525d1`) invalidated the cache and the
new migration applied. Verified via direct DB probe
(`information_schema.columns` for `team_invites`).

**Follow-up:** `/health` now exposes `commit` + `built_at`; we can answer
"which commit is this container running?" in one curl instead of 30
minutes of log diving. See P3 #13 below for the longer-term cache
investigation.

### 3. Token copy corruption

**Symptom:** invite acceptance tests failed when a copy/paste broke the
URL by replacing spaces inside the token with `%20` or stripping trailing
characters on word-wrap boundaries.

**Root cause:** the HMAC-signed token is base64url and can contain `-`
and `_`; some terminals or email clients mangle it.

**Fix:** `/teams/join` page + `inviteAccept` controller now distinguish
`INVALID_SIGNATURE` from `INVITE_NOT_FOUND` so a corrupted token surfaces
as "this link looks broken" rather than "already used."

---

## ✅ COMPLETED

### P0 — Session 1 (Phase 9 prod hotfixes)

- Env-check loud warning in prod when `JWT_SECRET` / `DATABASE_URL` /
  `SENDGRID_API_KEY` are missing at boot (`4dae2d8`)
- Dashboard admin gate + 403 copy (`f222f39`)

### P1 — Session 2 (Phase 9 follow-ups)

- Distinguish expired from invalid in accept flow (`7512171`)
- Cache invalidation on invite accept — team / members / invites /
  dashboard keys (`108466e`)
- Split `INVALID_INVITE` into signature-vs-not-found (`707dfd7`)

### P2 — Session 3 (polish + revoked/accepted)

- Pluralize member count (`2eb6c31`)
- Dashboard "stories by sector" empty-state copy (`2eb6c31`)
- #7 closed as no-repro
- **#8 — revoked vs accepted distinction.** Migration `0004`
  (`team_invites.revoked_at`), `deriveInviteStatus` checks `revoked_at`
  first → `"revoked"`, idempotent revoke handler, distinct rose-toned
  frontend badge with `revoked {date}` sub-line (`c9ec391`, `9496dc2`,
  `c787d4c`).

### Session 4 — repo relocation (P3 #17 partial)

- Fresh clone into `C:\dev\signal-app\` with `.git` at the project root
  instead of `C:\Users\elkha\` (which was causing `git status` to scan the
  entire Windows home directory and surface hundreds of untracked files
  like AppData, EE coursework, and shell-paste-accident "files")
- Orphan `origin/claude/upbeat-shirley-03e8ed` deleted; remote now shows
  only `HEAD` + `main`
- All gates re-verified at new location (backend 251/251, frontend 37/37)
- Git roundtrip (push test branch + delete) clean
- **Partial:** tracked paths still carry the `OneDrive/Desktop/signal-app/`
  prefix internally — that flattening is deferred as new **P3 #18** below

### Session 5 — P3 cleanup sprint (this session)

- **#14** `/health` endpoint returns `status`, `commit`, `built_at`,
  `env`, `uptime_seconds` — `commit` sourced from `GIT_COMMIT_SHA` or
  Railway's `RAILWAY_GIT_COMMIT_SHA` fallback; Dockerfile wires build-arg
  ingestion (`07646d2`)
- **#10** pg connection failures (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`)
  coerced to 503 `DATABASE_UNAVAILABLE` in the Express errorHandler;
  `pool.on("error")` listener keeps idle-client failures from becoming
  `unhandledRejection` (`677ea58`)
- **#11** smoke test now sends real Vercel origins through the CORS
  preflight (both main + branch alias); `SMOKE_TEST_TEAMS.md` step 0
  added (`3fb03b2`)
- **#15 + #16** CLAUDE.md sync — `team_invites` column table + derived-
  status rule, frontend naming convention (PascalCase components,
  camelCase `use`-prefix hooks), and removed the dangling `docs/SCHEMA.md`
  resource link (`8a13ff3`)
- **This doc** — `docs/PHASE_9_CLOSEOUT.md` committed as the
  source-of-truth closeout artifact

---

## ⏳ PENDING — P3 infrastructure / tech debt

The remaining P3 items deliberately deferred out of Phase 9:

- **#9 — Custom domain + domain auth.** Blocks on purchasing a domain
  and configuring SendGrid sender-domain authentication. Owner task.
- **#12 — Railway bug report.** File the deploy-cache-masks-migration
  story upstream with Railway. Owner task.
- **#13 — Docker cache investigation.** Medium-priority deep dive into
  Railway's layer caching behavior. Skip unless it blocks a future
  deploy.
- **#18 — Flatten `OneDrive/Desktop/signal-app/` path prefix (NEW).**
  All tracked paths still carry the legacy prefix from when `.git` was
  misplaced. Flattening requires a mass `git mv` across the entire
  tree + parallel updates to `.github/workflows/ci.yml`, the Vercel
  build config, the Railway build config, and any docs that reference
  absolute paths. Medium-risk standalone session. The prefix is
  cosmetic, not functional — zero runtime impact — so this is deferred
  until it becomes worth the churn. No current feature work needs it.

---

## Updated session cadence

| Session | Scope | Status |
|---|---|---|
| 1 | P0 prod hotfixes | ✅ shipped |
| 2 | P1 invite flow follow-ups | ✅ shipped |
| 3 + 3.5 | P2 polish + revoked/accepted | ✅ shipped |
| 4 | P3 #17 — repo relocation | ✅ partial (prefix deferred to #18) |
| 5 | P3 cleanup sprint (#10, #11, #14, #15, #16, closeout doc) | ✅ committed on `claude/p3-cleanup-sprint`, awaiting merge |
| 6+ | P3 #9 (domain), #12 (Railway bug report), #13 (if blocker), #18 (if worth it), **or** Phase 10 / Phase 11 | ⏳ not started |

After Session 5 merges: the next strategic decision is **Phase 10 (Learning
Paths) vs Phase 11 (API v2 / intelligence endpoints)**. Both are net-new
build-out rather than cleanup; owner picks based on near-term revenue /
partnership signal.

---

## Strategic — Phase 10 vs Phase 11

Decision still deferred. Unchanged from pre-closeout notes:

- **Phase 10 (Learning Paths)** leans into the consumer + premium tier
  story — curated multi-story journeys, progress tracking, shareable
  credentials. Lower external API surface, higher frontend complexity.
- **Phase 11 (API v2 / intelligence endpoints)** leans into the B2B
  tier — versioned REST endpoints, API key auth, rate-limit tiers,
  publisher dashboards. Lower frontend surface, higher infra + docs
  surface.

Pick once there's a concrete customer signal for either; don't prebuild.

---

## Lessons learned

1. **CORS allowlists need regex for Vercel-style deploy URLs.** Exact-
   match origin lists go stale every push; verify preflights from the
   real prod origin, not localhost.
2. **"Silent success" from a migrator is ambiguous.** Railway's deploy
   reported success while the new migration had never run; trust direct
   DB probes (`information_schema.columns`) over pipeline output.
3. **Distinguish invalid-signature from invalid-token.** "This link is
   broken" is a fundamentally different UX state from "this invite has
   already been used." Collapsing them hid real bugs.
4. **Timestamp-per-state beats polymorphic boolean.** `used_at` +
   `revoked_at` (nullable timestamps) are unambiguous and support
   accurate audit logs; a single `status` enum with a generic
   `status_changed_at` would have forced a lossy migration.
5. **Migration runner terse output is normal pass signal.** `[migrate]
   done in Xms` without naming files is NOT a migration failure — verify
   via direct DB probe (`information_schema.columns`) before diagnosing.
6. **Vercel and Railway pipelines are independent.** A stale Docker
   cache on Railway does not affect Vercel frontend deploys. When
   diagnosing "is my new code live?", check the two pipelines
   separately — the frontend can be running the latest commit while the
   backend is still on a layer from yesterday.

---

## User context

- Canonical repo root: **`C:\dev\signal-app\`** (new, post-Session-4).
  Code itself lives at `C:\dev\signal-app\OneDrive\Desktop\signal-app\{backend,frontend}\`
  because tracked paths still carry the legacy prefix (see P3 #18).
- Fallback repo: `C:\Users\elkha\OneDrive\Desktop\signal-app\` kept as a
  safety net pending retirement. Do not commit from it — its `.git`
  lives at `C:\Users\elkha\` and would sweep in Windows home-dir
  garbage.
- Deploys: Vercel (frontend, auto from `main`) + Railway (backend, auto
  from `main`). Owner triggers deploys by merging to `main`; Claude
  Code never pushes to `main` directly.

---

## Files touched across all Phase 9 work

### Backend

- `backend/src/db/schema.ts` — teams, team_members, team_invites (incl.
  `revoked_at`)
- `backend/src/db/migrations/0003_phase9_team_invites.sql`
- `backend/src/db/migrations/0004_phase9_invite_revoked_at.sql`
- `backend/src/controllers/teamController.ts` — CRUD, invite list /
  create / resend / revoke / accept, derived status, dashboard
- `backend/src/routes/teams.ts`
- `backend/src/routes/health.ts` — enhanced in Session 5
- `backend/src/db/index.ts` — pool error listener (Session 5)
- `backend/src/middleware/errorHandler.ts` — pg error → 503 branch
  (Session 5)
- `backend/src/services/teamInviteService.ts` — HMAC sign/verify
- `backend/src/emails/teamInvite.ts` — invite email template
- `backend/src/app.ts` — CORS regex allowlist, route wiring
- `backend/src/lib/envCheck.ts` — loud prod warnings for missing critical
  env vars
- `backend/src/scripts/smokeTest.ts` — Vercel origin preflight (Session 5)
- `backend/Dockerfile` — GIT_COMMIT_SHA + BUILD_TIME ARGs (Session 5)
- `backend/tests/teams.integration.test.ts`, `teamInviteService.test.ts`
- `backend/tests/health.integration.test.ts` (Session 5)
- `backend/tests/errorHandler.test.ts` (Session 5)

### Frontend

- `frontend/src/app/(app)/teams/` — list, detail, members, dashboard,
  settings pages
- `frontend/src/app/teams/join/page.tsx` — unauth invite accept flow
- `frontend/src/components/teams/` — TeamSwitcher, PendingInvites,
  InviteForm, MembersTable, DashboardCharts, ConfirmDialog
- `frontend/src/hooks/useTeams.ts`, `useAcceptInvite.ts`
- `frontend/src/lib/api.ts` — team + invite request helpers
- `frontend/src/types/team.ts` — PendingTeamInvite (incl. `revoked_at`),
  `InviteStatus` (incl. `"revoked"`)
- `frontend/src/components/teams/PendingInvites.test.tsx`

### Docs

- `docs/DEPLOYMENT.md`
- `docs/SMOKE_TEST_TEAMS.md` — step 0 preflight (Session 5)
- `docs/PHASE_9_CLOSEOUT.md` (Session 5, this doc)
- `CLAUDE.md` — schema table + naming convention (Session 5)

---

## End note

Phase 9 closeout complete including all P3 cleanup. Next: pick Phase 10
or Phase 11.

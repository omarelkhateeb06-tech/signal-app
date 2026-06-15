# Deployment

## Services

- **Backend:** Express + TypeScript on Railway (`https://signal-app-production-cd33.up.railway.app`). Built from `backend/Dockerfile`. Auto-deploys on push to `main`.
- **Frontend:** Next.js on Vercel. Auto-deploys on push to `main`; each deploy gets an immutable URL plus the `git-main` alias.
- **Database:** Railway Postgres. Schema managed via a homegrown migration runner (`backend/src/db/migrate.ts`) over SQL files under `backend/src/db/migrations/`.
- **Cache/queue:** Railway Redis (BullMQ).

## Backend lockfile (Docker / `npm ci`)

The backend image (`backend/Dockerfile`) builds with the **`backend/` folder as the build context**, so the monorepo-root `package-lock.json` isn't reachable inside the image. To keep Railway builds deterministic, **`backend/package-lock.json` is committed as a standalone lockfile** and the Dockerfile installs with `npm ci` (not `npm install`). This is what prevents version drift between builds — e.g. the `ioredis`/`bullmq` type mismatch in PR #100, where lockfile-less `npm install` re-resolved version ranges on every build.

**When you change `backend/package.json` dependencies, regenerate the standalone lockfile** in the same commit — otherwise the Docker `npm ci` fails on a lock/manifest mismatch:

```bash
# Generate in a scratch dir OUTSIDE the workspace, so npm doesn't fold it
# into the monorepo root lockfile, then copy the standalone lock back in.
tmp=$(mktemp -d) && cp backend/package.json "$tmp/" \
  && (cd "$tmp" && npm install --package-lock-only) \
  && cp "$tmp/package-lock.json" backend/package-lock.json
```

Then run `npm install` at the repo root as usual to update the workspace lockfile. Commit both `backend/package-lock.json` and the root `package-lock.json`.

## Deploy Runbook

### Standard deploys (no schema changes)

1. Merge PR to `main`.
2. Railway rebuilds and redeploys the backend container; Vercel rebuilds the frontend.
3. Smoke test prod: sign in, load the feed, save a story, post a comment, open a team page.

### Deploys with schema changes

Migrations run automatically on every container start via the Dockerfile `CMD`:

```
sh -c "node dist/db/migrate.js && node dist/server.js"
```

`dist/db/migrate.js` is the homegrown migration runner. It uses prod deps only — no `drizzle-kit` in the runner image. It reads `dist/db/migrations/` (copied into the image by the `build` script), takes a Postgres advisory lock so two containers booting in parallel can't double-apply, and applies anything not yet recorded in the `schema_migrations` table. Each migration runs in its own `BEGIN`/`COMMIT`, with the row insert into `schema_migrations` in the same transaction — a partial apply leaves no row. Idempotent — a no-op once up to date. Typical cost on a warm DB is < 1s.

**Fail-fast behavior:** if migrate exits non-zero, the container exits before binding the server port. Railway's health check fails, the deploy is marked failed, and the previous healthy container keeps serving traffic. The service never runs against a stale schema.

**If a migration fails during deploy:**
1. Check Railway logs for the `[migrate] failed:` line — it includes the underlying Postgres error.
2. Fix the migration file locally and push to `main`.
3. Railway redeploys; migrate runs again.
4. **Emergency escape hatch:** if you need the server up without running migrations (e.g. a bad migration is blocking the deploy and you want the old code live while you fix it), override Railway's start command to `node dist/server.js` or run the image with the equivalent CMD override. `package.json` also exposes `start:no-migrate` for Nixpacks-style environments.

### Manual migration (rare)

Preferred path is to let the container run migrations on deploy. If you must run them from your machine (e.g. investigating a specific migration's behavior):

```bash
export DATABASE_URL="<from Railway → Postgres → Connect>"
cd backend
npm run db:migrate       # homegrown runner via ts-node (uses devDeps)
# or, after a build:
node dist/db/migrate.js  # compiled runner, same path prod uses
unset DATABASE_URL
```

Never commit or paste `DATABASE_URL` anywhere.

### Dev SQL access

For ad-hoc SQL against the dev Neon database, use the Neon web editor. Direct `psql` connections need outbound port `5432`, which is blocked on UMN campus wifi — switch to a phone hotspot or the UMN VPN if you need a direct connection.

## Verifying a deploy

- **Railway logs** should show `[migrate] migrations dir: …` followed by `[migrate] lock acquired`, then either `[migrate] up to date (N applied, 0 pending)` on a no-op deploy or `[migrate] done — N applied in Xms` on a deploy with new migrations. The server starts listening only after the migrate step exits cleanly.
- **Schema check** (Railway → Postgres → Query):
  ```sql
  SELECT filename, applied_at, applied_by FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;
  ```
  Most recent entries should match the migrations you just shipped.
- **Functional check:** hit `/health` on the backend, load a page that exercises the new schema on the frontend.

## Required env vars on Railway

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `SENDGRID_API_KEY` (optional — falls back to console transport)
- `SENDER_EMAIL`
- `FRONTEND_URL` — stable frontend origin (e.g. the Vercel `git-main` alias)
- `ALLOWED_ORIGINS` — optional additional exact-match origins, comma-separated
- `ALLOWED_ORIGIN_PATTERNS` — optional regex overrides for dynamic origins; defaults cover this project's Vercel deploy URLs

### Feature-gated / optional env vars

The adapters and pipelines below **log-and-skip** when their key is absent — the app boots fine without them; the feature is simply inert until the key is set. `envCheck.ts` remains the source of truth for what's hard-required.

- `ANTHROPIC_API_KEY` — Haiku commentary / relevance / facts / tiers / Through-Line / native posts. Without it the request path falls back to template scrubs and ingestion enrichment no-ops.
- `OPENAI_API_KEY` — `text-embedding-3-small` for cross-source clustering.
- `FRED_API_KEY` — FRED macro adapter (`fred_api`).
- `YOUTUBE_API_KEY` — YouTube transcript generators.
- `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` — Reddit adapter (`reddit_api`); activates `reddit-finance` and the `reddit-ai` / `reddit-semis` sources seeded in migration 0058.
- `GITHUB_TOKEN` — optional; raises the `github_api` adapter's rate-limit ceiling (works unauthenticated at a lower limit).
- `LLM_COST_LOG` — set to `0` to silence the `[llm-cost]` spend lines (see below). Any other value (or unset) leaves them on.

## LLM spend instrumentation

Every Anthropic and OpenAI call emits one structured line to stdout (captured in Railway logs), tagged `[llm-cost]`:

```
[llm-cost] {"provider":"anthropic","callSite":"tier:accessible","model":"claude-haiku-4-5-20251001","inputTokens":1200,"outputTokens":300,"costUsd":0.0027,"priced":true}
```

`callSite` attributes spend per pipeline stage: `commentary`, `relevance`, `facts`, `tier:<depth>`, `through_line`, `embedding`, `depth_variant` (native authoring shows as `unlabeled`). `priced:false` flags a model with no entry in `lib/llmCost.ts` (`costUsd` is then 0 — add the price).

Reconstruct per-day spend from a log export:

```bash
# Total USD across all calls in the export
grep -o '\[llm-cost\] .*' railway-logs.txt | sed 's/^\[llm-cost\] //' \
  | jq -s 'map(.costUsd) | add'

# Spend grouped by stage (the §19 unit-economics view)
grep -o '\[llm-cost\] .*' railway-logs.txt | sed 's/^\[llm-cost\] //' \
  | jq -s 'group_by(.callSite) | map({callSite: .[0].callSite, usd: (map(.costUsd) | add), calls: length})'
```

This is the ground-truth alternative to the estimates in `ROADMAP.md` §19 — cross-check against the Anthropic / OpenAI invoices.

# SIGNAL — Pre-Stripe Handoff Prompt

**Paste this as the first message in a new Claude Code session.**

---

Start working immediately — no preamble, no recap needed. Read `CLAUDE.md` at the repo root first (it's the authoritative spec), then execute the tasks below in order. Run the gate suite after each logical change and fix failures before moving on.

## Context

You are Claude Code working on the SIGNAL project at `C:\dev\signal-app`. This is a ranked-feed intelligence product (AI / Finance / Semiconductors) built with Next.js 14 + Express 4 + Postgres + Redis. The full technical spec is in `CLAUDE.md`.

**State as of 2026-06-14:**
- All work is on `main`, deployed to Railway (`fortunate-perception` project, `signal-app` service).
- Migrations `0000–0057` are applied on prod. Next migration is `0058`.
- The ingestion track is feature-complete: RSS, arXiv, HN, SEC EDGAR, GitHub API, Product Hunt, SEC Form D, FRED, YouTube (5 channels), Sitemap (Anthropic), Reddit (finance subs). All adapters/generators ship — four Railway env vars (`FRED_API_KEY`, `YOUTUBE_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`) are missing on prod but that's the user's action, not yours.
- **Launch gate: Phase 12h (Stripe billing).** That build is blocked on the user providing Stripe keys. Everything below is non-blocking.

---

## Tasks — execute in order

### 1. CLAUDE.md consolidation

Three sections have drifted from HEAD reality:

**§3 migration list** — The list shown in §3 stops at `0031`. Add a note (or update the list) clarifying that the live migration count is in `backend/src/db/migrations/` and currently runs through `0057`. The historical list is fine to keep as archaeology but should be labelled as such.

**§15 shipped phase table** — The table stops at `12i`. Extend it with the phases that shipped after 12i:
- `12p` — search on `events` table (not legacy `stories`)
- `12q` — related stories on `events` table
- `12R.A` — Real-Time Layer Phase A: Product Hunt (`THE LAUNCH` card) + GitHub API adapter
- `12e.x expansion` — FRED macro adapter (`fred_api`), YouTube transcript generators (5 channels, DISPATCH card), Sitemap adapter (Anthropic via `sitemap.xml`), Reddit adapter (`reddit_api`, finance subs), SEC Form D (`sec_form_d`)

**Through-Line feature (undocumented)** — Add a documentation entry (can go in §8 alongside the commentary docs or as its own subsection). Cover: endpoint `GET /api/v1/briefing` (JWT + Pro tier), the five files (`backend/src/services/throughLineService.ts`, `backend/src/services/throughLineClient.ts`, `backend/src/controllers/briefingController.ts`, `backend/src/routes/briefing.ts`, `frontend/src/hooks/useThroughLine.ts`), what it does (Haiku-synthesized, profile-personalized, tier-gated editorial synthesis of the day's top stories), and the frontend surface (`SwissMasthead.tsx`). Five Haiku clients now exist: commentary, relevance, facts, tier-generation, through-line — note that in the Haiku client discipline section.

### 2. ROADMAP.md cleanup

`docs/ROADMAP.md` has accumulated append-style session notes rather than a clean current-state document. Consolidate the "Current Work" and "Phase Status" sections to reflect HEAD reality (phases through 12i + ingestion expansion shipped). Preserve the forward-looking sections (Phase 13 teams enhancements, Phase 14 data-layer monetization). Do not delete historical context — fold it into the appropriate current-state sections. The file does not need to match CLAUDE.md verbatim; it should be the strategic/planning view while CLAUDE.md is the technical spec.

### 3. Reddit expansion migration (AI + semis)

Write `backend/src/db/migrations/0058_phase12_reddit_expansion.sql`. Add two new `ingestion_sources` rows (use `INSERT … ON CONFLICT DO NOTHING` so it's idempotent on re-run):

```sql
INSERT INTO ingestion_sources (slug, name, adapter_type, endpoint, enabled, priority, quality_score, fetch_interval_seconds, config)
VALUES
  ('reddit-ai',
   'Reddit – AI Research',
   'reddit_api',
   NULL,
   true,
   3,
   7,
   86400,
   '{"subreddits":["MachineLearning","LocalLLaMA"],"minScore":200,"limitPerSub":15}'::jsonb),
  ('reddit-semis',
   'Reddit – Semiconductors',
   'reddit_api',
   NULL,
   true,
   3,
   7,
   86400,
   '{"subreddits":["chipdesign","ASML"],"minScore":50,"limitPerSub":15}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
```

No schema changes needed — `reddit_api` enum value already exists since migration `0057`. This is a single-file migration (no two-file split required since we're not adding a new enum value).

No `backend/src/db/schema.ts` changes required.

### 4. Sitemap og:title upgrade

In `backend/src/jobs/ingestion/adapters/sitemap.ts`, article titles are currently derived from URL slugs (e.g. `"tcs-anthropic-partnership"` → `"Tcs Anthropic Partnership"`), which produces imperfect casing. Add an opt-in `og:title` fetch:

- Add `fetchOgTitle?: boolean` to the config shape.
- After collecting URLs from the sitemap, if `config.fetchOgTitle` is true, do a GET on each article URL and extract `<meta property="og:title" content="...">` via a simple regex. Fall back to slug derivation on any fetch error or missing tag.
- Keep the fetch lightweight — just read enough of the response to find the `<head>` section (use `response.text()` but only scan the first ~4KB, not the full page).

Then write `backend/src/db/migrations/0059_phase12_sitemap_og_title.sql` to enable it for `anthropic-news`:

```sql
UPDATE ingestion_sources
SET config = config || '{"fetchOgTitle":true}'::jsonb
WHERE slug = 'anthropic-news';
```

Update the TypeScript adapter config type and the migration index accordingly.

### 5. Dockerfile build cache

In `backend/Dockerfile`, the `npm ci` steps in the builder stage don't use BuildKit cache mounts. Update the builder's install step to mount the npm cache so Railway rebuilds don't re-download all packages on every build:

```dockerfile
RUN --mount=type=cache,target=/root/.npm \
    npm ci
```

Check whether Railway passes `DOCKER_BUILDKIT=1` by default (it does via its Docker build path). Apply the same mount to the production-deps install step in the runner stage.

### 6. Full gate suite

Run and report the results:

```bash
npm run type-check --workspace=backend
npm run lint --workspace=backend
npm test --workspace=backend
npm run type-check --workspace=frontend
npm run lint --workspace=frontend
```

Fix any failures introduced by the above changes. Report the final test count (baseline was 1,395 backend / 151 frontend as of the last session).

---

## What only the user (Omar) needs to do

Do not build these — just keep them in scope:

1. **Stripe** — Create account → get Publishable key + Secret key + Price ID ($10/mo product) + Webhook signing secret → provide them → then you build Phase 12h end-to-end (checkout session, webhook handler, `tier='pro'` flip, cancel/manage portal).
2. **Railway env vars** (4 missing, logged as WARN at prod boot):
   - `FRED_API_KEY` → fred.stlouisfed.org/docs/api/api_key.html (free, instant)
   - `YOUTUBE_API_KEY` → Google Cloud Console → YouTube Data API v3 → API key
   - `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` → reddit.com/prefs/apps → type: **script**
3. **Custom domain** → buy + point at Vercel; tell you the domain so you can update `FRONTEND_URL` + CORS config.
4. **SendGrid domain authentication** → DNS records for digest email deliverability (you'll provide the exact records once he confirms the domain).
5. **Real-payment test** → sign up → pay → verify `tier='pro'` flips (only he can do this with live Stripe keys).
6. **Brand decision** → ship as SIGNAL or do the Valo rebrand first (it's a code pass you can run on one word from him).

---

## Key file locations

| What | Where |
|------|-------|
| Schema | `backend/src/db/schema.ts` |
| Migrations | `backend/src/db/migrations/` (0000–0057; next is 0058) |
| Ingestion adapters | `backend/src/jobs/ingestion/adapters/` |
| Sitemap adapter | `backend/src/jobs/ingestion/adapters/sitemap.ts` |
| Feed card types | `frontend/src/lib/feedCardType.ts` |
| Through-Line service | `backend/src/services/throughLineService.ts` |
| Through-Line client | `backend/src/services/throughLineClient.ts` |
| Briefing controller | `backend/src/controllers/briefingController.ts` |
| Briefing route | `backend/src/routes/briefing.ts` |
| Env check | `backend/src/lib/envCheck.ts` |
| Dockerfile | `backend/Dockerfile` |
| ROADMAP | `docs/ROADMAP.md` |

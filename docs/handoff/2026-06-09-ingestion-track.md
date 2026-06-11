# Handoff — Ingestion Track (June 9, 2026)

This document is the self-contained briefing for the next session. Read it fully before touching any file. Everything here is ground-truth — the code and migrations are the real source of truth, but this doc captures the *why* and the *exact state* so you don't have to re-derive it.

---

## 0. What was done this session (complete record)

### A. Onboarding cluster (all four items shipped, committed in `7db8d1f`)

**#24 — Topic taxonomy consolidation (`frontend/src/lib/onboarding.ts`, `backend/src/constants/onboardingTopics.ts`):**
- Collapsed from 10–20 fine-grained topics/sector → exactly 5 broad categories/sector.
- Canonical slugs now in use:
  - **AI:** `models_and_research`, `infrastructure`, `agents`, `products_and_apps`, `safety_and_policy`
  - **Finance:** `markets_and_macro`, `private_capital`, `crypto`, `policy_and_regulation`, `quant_research`
  - **Semis:** `design_and_eda`, `manufacturing`, `chips_and_accelerators`, `supply_and_policy`, `applications`
- Old slug `foundation_models` is dead — replaced everywhere in tests too (`onboarding.integration.test.ts`, `users.integration.test.ts`, `onboarding/[step]/page.test.tsx`).

**#18 — "Field of work" (domain) is now optional (Screen 2):**
- Backend: `onboardingController.ts` zod refine changed from `.min(1).refine(isValidDomain)` → `.refine((d) => d === "" || isValidDomain(d))`. Empty string is the wire sentinel. At write time: `domain: input.domain || null`.
- Frontend: `canContinue = role !== null && role.length > 0` (domain removed from gate). Dropdown placeholder changed from a disabled "Select a field…" to a non-disabled "No specific field". Legend updated to include `— optional`.
- Two new tests: empty domain → 200, garbage non-empty domain → 400.

**#25 — Digest screen explainer (Screen 7 of onboarding):**
- Inline explainer block added directly below the Yes/No toggle in `frontend/src/app/onboarding/[step]/page.tsx`.
- Copy: "Yes, daily — each morning we email…" / "No, thanks — skip the email…" / "You can change this anytime in Settings."
- ⚠️ TRAP: `onboarding.ts` exports a `DIGEST_PREFERENCES` constant that was NOT touched — Screen 7 uses inline hardcoded options, not that export. Don't confuse them.

**#53 — CLI dotenv override (`backend/src/lib/loadEnv.ts`, NEW):**
- Problem: `dotenv.config()` doesn't override shell-env vars. A stale `ANTHROPIC_API_KEY=""` in PowerShell `$PROFILE` / Windows Credential Manager silently shadows the real key in `.env` — no startup error, just auth failures.
- Fix: `loadEnv.ts` runs `dotenv.config({ override: true })`. Must be the **first import** in every CLI script.
- Applied to: all 24 scripts in `backend/src/scripts/` + `db/migrate.ts`, `db/seed.ts`, `db/verify.ts`.
- **Deliberately NOT applied** to `server.ts` or `db/index.ts` — Railway's process env must win in prod; there is no `.env` in the prod image anyway.
- Pattern: `import "../lib/loadEnv"` (side-effect import, always first line).

---

### B. Ingestion Tier 0 — Resurrect dead feeds (committed `12a20e4`)

A live DB audit revealed the feed was *not* source-starved — ~40 sources were already enabled and healthy (OpenAI, DeepMind, Google Research, NVIDIA, Fed Press, SEC EDGAR all lastOK=today). The real problem was **9 high-priority feeds seeded but NEVER once working** (fails=663, lastOK=NEVER).

**Outcomes:**
- `amd-newsroom`: ✅ resurrected — `ir.amd.com/rss/news-releases.xml`
- `meta-ai-blog`: ✅ resurrected — `research.facebook.com/feed/`
- `bis-press`: ✅ resurrected + upgraded to Federal Register BIS API RSS (`/api/v1/documents.rss?conditions[agencies][]=industry-and-security-bureau`) — the live rulemaking/enforcement primary; the old `bis.doc.gov` press URL was dead.
- `intel-newsroom`: ✅ re-confirmed healthy.
- `money-stuff`: ⚠️ regression caught and fixed — `fixBrokenSources --apply` wrongly disabled this *healthy* Matt Levine (Bloomberg) feed because it had an empty `CANDIDATE_URLS` entry. The disable branch runs when all candidates fail. Re-enabled via temp script; removed from `CANDIDATE_URLS` with comment. **LESSON: never list a currently-working source in the repair registry.**

**Still dead / no public RSS** (left disabled, need a bridge later): `anthropic-news` (high value, no RSS at all), `asml-news` (anti-bot 403), `tsmc-newsroom` (anti-bot), `the-batch` (404/500), `huggingface-papers` (401; blog feed works but is title-only → rejected by body seam), `reuters-business` (Reuters killed public RSS).

---

### C. Ingestion Tier 1 — SEC Form D adapter (committed `090b13d`)

New file: `backend/src/jobs/ingestion/adapters/secFormD.ts`

**What it is:** Form D is a *discovery* stream (not a CIK-watch like `sec_edgar_json`). Any company filing a Reg D exempt offering = "we raised a private round." We can't know issuers in advance — so the adapter polls EDGAR full-text search (EFTS) for recent Form D filings, then fetches each filing's `primary_doc.xml` for the structured data.

**Pre-filter (cheap, before Haiku gate):**
1. `industryAllowlist` — operating-tech only by default: `["Computers", "Other Technology", "Telecommunications", "Manufacturing"]`. Fund categories (`Pooled Investment Fund`, etc.) deliberately excluded — a live sample showed ~85% of "tech" Form D volume is generic LP/SPV/VC fund raises, not operating companies. Tunable via `config.industryAllowlist`.
2. Disclosed offering ≥ `minOfferingUsd` (default $5M). Null / "Indefinite" / 0 amounts dropped — no size signal, not worth showing.

**Result:** ~1–2 candidates/day pre-Haiku-gate. Precision source, not a firehose. Haiku relevance gate assigns the final `ai`/`finance`/`semiconductors` sector.

**Title format:** `Company — $50.0M private financing (Form D)`
**Summary format:** `Company (Industry), based in City, State, reported a $50.0M private securities offering (Reg D / Form D) filed with the SEC on June 8, 2026.`

**Key helpers (shared from `secEdgarJson.ts`):** `humanizeCompanyName()`, `humanDate()`.
**Form-D-specific:** `cleanFormDName()` — strips trailing commas + re-uppercases roman numerals mangled by title-case ("Viii" → "VIII").

**Retry logic:** `requestWithRetry()` — 3 attempts, 300ms/600ms backoff, retries on `http_5xx` / `timeout` / `network`. EFTS (Elasticsearch backend) transiently 5xxs under load.

**Migrations (both PENDING — not yet deployed to Railway prod):**
- `0050_phase12_form_d_adapter_type.sql` — `ALTER TYPE "ingestion_adapter_type" ADD VALUE IF NOT EXISTS 'sec_form_d';`
- `0051_phase12_form_d_source.sql` — seeds the `sec-form-d` source row (idempotent `WHERE NOT EXISTS`).
- **Two-file rule:** the enum value addition and its first use MUST be in separate migration files because `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction it's added. This pattern is established (mirrors 0047/0048 for `github_api`). Do NOT merge these into one file.

**Schema wiring (both done, confirmed):**
- `INGESTION_ADAPTER_TYPES` tuple in `schema.ts` (line ~72) — contains `"sec_form_d"`. This is what drives the TypeScript `IngestionAdapterType` union. The pgEnum alone is not enough.
- `ingestionAdapterTypeEnum` pgEnum (line ~44) — also contains `"sec_form_d"`.
- `adapters/index.ts` REGISTRY — `sec_form_d: secFormDAdapter` (wired, non-null).

**Tests:** `backend/tests/ingestion/secFormDAdapter.test.ts` — 7 tests: keeps tech filing with disclosed amount, drops real estate, drops below threshold, drops Indefinite, cleans roman numerals + trailing commas, honors config overrides, continues past failed XML fetch.

**SEC fair-access compliance:** descriptive `User-Agent: SIGNAL/12 signal-ingestion (+contact@signal.so)`, 150ms inter-request delay, no more than 10 req/s.

---

## 1. Current codebase state (as of this handoff)

**Latest migration:** `0051_phase12_form_d_source.sql` (both 0050 + 0051 are PENDING on Railway prod — deploy will apply them)

**Adapter types in `INGESTION_ADAPTER_TYPES` tuple (schema.ts ~line 72):**
```
"rss", "arxiv_atom", "sec_edgar_json", "sec_form_d",
"hackernews_api", "reddit_api", "native_generator", "github_api"
```

**Adapter registry (`adapters/index.ts`):**
| adapter_type | status |
|---|---|
| `rss` | ✅ wired |
| `arxiv_atom` | ✅ wired |
| `sec_edgar_json` | ✅ wired |
| `sec_form_d` | ✅ wired (this session) |
| `hackernews_api` | ✅ wired |
| `reddit_api` | ⚠️ `null` — stub throws "not yet implemented" |
| `github_api` | ✅ wired |
| `native_generator` | `null` — intentional, generators are a separate registry |

**Native generator registry (`generators/index.ts`) — 7 generators:**
`hnRepoDiscovery`, `arxivSynthesis`, `hnCommunitySynthesis`, `earningsReaction`, `supplyChainSynthesis`, `crossSectorChain`, `toolSpotlight`

**`fred-api` source row (in prod via migration 0014):**
- slug: `fred-api`, display_name: `FRED API`
- adapter_type: `rss` ← **WRONG — placeholder, must be updated**
- endpoint: `NULL` ← **must be set**
- enabled: `false`
- sectors: `['finance']`, quality_score: 5, fetch_interval_seconds: 3600

**`reddit-finance` source row (in prod via migration 0014):**
- slug: `reddit-finance`, display_name: `Reddit r/SecurityAnalysis + r/investing`
- adapter_type: `reddit_api`
- endpoint: `r/SecurityAnalysis+investing/top.json?t=day`
- enabled: `false` (disabled — adapter throws)
- priority: 4 (community)

---

## 2. What's next, in order

### Step 1: FRED adapter ← **START HERE**

**What it is:** Federal Reserve Economic Data (St. Louis Fed). Free public API, no auth for basic series. Each data release → a compact data card (finance sector, EARNINGS/SEC card type via `content_type='filing'`).

**Proposed series set (finance only, low cadence):**
- `FEDFUNDS` — Effective Federal Funds Rate
- `CPIAUCSL` — Consumer Price Index (all items)
- `DGS10` — 10-Year Treasury Constant Maturity Rate
- `UNRATE` — Unemployment Rate
- `PCEPI` — Personal Consumption Expenditures Price Index

**API:** `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=YOUR_KEY&file_type=json&sort_order=desc&limit=5`
- Free API key from https://fred.stlouisfed.org/docs/api/api_key.html — just an email registration, no billing.
- `FRED_API_KEY` env var — add to `backend/.env.example` + `envCheck.ts` as optional (not required to boot; adapter logs and skips if unset).

**Source row update:** The existing `fred-api` row needs `adapter_type` changed from `'rss'` to `'fred_api'` and `endpoint` set + `enabled=true`. Do this via migration.

**Two-file migration rule (mandatory — see Form D precedent):**
- File N: `ALTER TYPE "ingestion_adapter_type" ADD VALUE IF NOT EXISTS 'fred_api';`
- File N+1: UPDATE the existing `fred-api` source row (adapter_type, endpoint, enabled, config) via `UPDATE ingestion_sources SET ... WHERE slug = 'fred-api'`.

**Config shape (proposal):**
```json
{
  "seriesIds": ["FEDFUNDS","CPIAUCSL","DGS10","UNRATE","PCEPI"],
  "lookbackDays": 14
}
```

**Card shape:** Title like `"Fed Funds Rate: 5.33% (June 2026)"`, summary is a plain-English one-liner on what the reading means. `content_type='filing'` → EARNINGS/SEC card. `priority=2` (authoritative primary data — analyst grade).

**Schema wiring (same as Form D):**
1. Add `"fred_api"` to `INGESTION_ADAPTER_TYPES` tuple in `schema.ts`.
2. Add `"fred_api"` to `ingestionAdapterTypeEnum` pgEnum in `schema.ts`.
3. Create `backend/src/jobs/ingestion/adapters/fredApi.ts`.
4. Register in `adapters/index.ts`: `fred_api: fredApiAdapter`.
5. Two migration files (add enum value, then update source row).
6. Tests: at least happy path + "skips when FRED_API_KEY unset" + "handles rate-limit / 5xx gracefully".

**Important:** The `INGESTION_ADAPTER_TYPES` tuple (not just the pgEnum) is what drives the TS type. Both MUST be updated or you'll get `Type '"fred_api"' is not assignable to type '...'` at compile time.

---

### Step 2: YouTube / podcast transcript generator

**What it is:** A new `NativeGenerator` (NOT an adapter — we don't post the raw transcript; Haiku authors a DISPATCH-style "what was said + why it matters" brief from it).

**V1 channel list (multiple rows, one per channel):**
- Dwarkesh Patel — `https://www.youtube.com/@dwarkeshpatel` — AI, primary focus
- Asianometry — `https://www.youtube.com/@Asianometry` — semiconductors
- TechTechPotato — `https://www.youtube.com/@TechTechPotato` — semiconductors
- No Priors — `https://www.youtube.com/@nopriors` — AI
- Acquired — `https://www.youtube.com/@AcquiredFM` — finance/tech

Each channel gets its **own `ingestion_sources` row** (`adapter_type='native_generator'`), one migration per channel (or batch in one migration).

**Transcript source decision (open question to resolve before building):**
- Option A: YouTube Data API v3 auto-captions — free tier, `YOUTUBE_API_KEY` needed (Google Cloud console, no billing for read-only quota at this scale).
- Option B: `yt-dlp` subprocess — free, no API key, but requires the binary in the Railway image (Dockerfile change). More robust for non-auto-captioned videos.
- **Recommended:** Start with YouTube Data API v3 (cleaner, no Dockerfile change). Fall back to yt-dlp later if quota is hit.

**Generator flow:**
1. Call YouTube Data API: list latest N videos for the channel (past 7 days).
2. For each video: fetch auto-captions (transcript) via the captions API or timedtext endpoint.
3. Pass transcript + video title/description to Haiku with a DISPATCH-style brief prompt.
4. Return `NativeCandidate` with the authored brief as `body`, video URL as `url`, `sector` inferred from the channel's configured sector(s).

**Output card type:** DISPATCH (via `generator_type='dispatch'` or content inference in `deriveCardType`). The brief is "what was said + why it matters" — exactly the DISPATCH format.

**Env var:** `YOUTUBE_API_KEY` — add to `.env.example` + `envCheck.ts` as optional. Generator skips (logs, no DB churn) when unset, same pattern as `ANTHROPIC_API_KEY` in the native scheduler.

---

### Step 3: Reddit — finish the stub

**Current state:** `reddit.ts` adapter throws `"reddit_api adapter not yet implemented"`. The `reddit-finance` source row exists (disabled, priority 4).

**What needs building:**
- OAuth2 client credentials flow (`client_id` + `client_secret` → bearer token). Env vars: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`.
- Fixed subreddit list in config (proposal: `r/SecurityAnalysis`, `r/investing`, `r/MachineLearning`, `r/hardware`).
- Poll top posts above a score threshold (e.g. 100) within the past 24h. `t=day` on top endpoint.
- Cadence: 4h (`fetch_interval_seconds: 14400`).
- Each post → a Candidate with `title`, `url`, `summary` (selftext preview or linked article). The Haiku relevance gate assigns sector.
- Dedup: `externalId = post.name` (Reddit `fullname`, e.g. `t3_abc123`).

**Env vars:** `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` — both required for the adapter to run. Add as optional to `envCheck.ts`; adapter logs and returns empty candidates when unset (same graceful-degrade pattern as EDGAR when `DATABASE_URL` connection fails).

---

### Step 4: Bluesky + Anthropic RSS bridge

**Anthropic:** No public RSS exists (all feed candidates 404). Options: curated Bluesky author bridge, or wait for an official feed. Default: bridge via `openrss.org` or `rss.app` on the Anthropic Bluesky account once confirmed active.

**Bluesky:** Curated-author RSS bridge first (zero code — just an `rss` source row pointing at a bridge URL). Upgrade to a `bluesky_api` adapter later if signal is good. Bridge services: `openrss.org/r/bsky.app/profile/<handle>/rss` or `bsky.app/profile/<handle>/rss` (Bluesky has native RSS on profiles as of 2024).

---

### Step 5: 12h Stripe billing (the real launch gate)

Not part of the ingestion track — separate session. Turns `/upgrade`'s "Coming soon" button into a real Stripe Checkout flow. Activates `tier='pro'` post-checkout via a webhook. This is the last hard blocker before public launch.

---

## 3. Invariants you MUST NOT break

**Two-file migration rule:** `ALTER TYPE ... ADD VALUE` cannot be *used* in the same transaction it's added. Always split: file N adds the enum value, file N+1 uses it (UPDATE/INSERT that references the new value). This is documented in CLAUDE.md §6 and proven by migrations 0047/0048 (github_api) and 0050/0051 (sec_form_d).

**INGESTION_ADAPTER_TYPES tuple is the TypeScript type.** The pgEnum and the const tuple are two parallel lists. Both must be updated when adding a new adapter type. Updating only the pgEnum gives you a migration that applies cleanly but a TypeScript compile error. `schema.ts` has them near each other (~lines 44 and 72) — update both in the same commit.

**loadEnv.ts must be the first import in CLI scripts.** It calls `dotenv.config({ override: true })`. If `db/index.ts` or any service module is imported first, the pg Pool is built with whatever `DATABASE_URL` the shell has (possibly empty), not the `.env` value. The import order matters.

**Migration path:** `backend/src/db/migrations/` — NOT `backend/drizzle/`. AI tools repeatedly default to the wrong path. The homegrown runner reads only from `src/db/migrations/`. Filename format: `NNNN_phaseXY_slug.sql`.

**Never disable a healthy source via `fixBrokenSources --apply`.** The tool disables any slug whose candidates array is empty or all-failing. A working source in the repair registry with no candidates listed will get disabled. Always run `--dry-run` first and audit against live DB state.

**Tests ship with every adapter/generator.** The test count is 435 across 37 suites (as of 12c). Adding a new adapter without tests is a hard block. Pattern: global `fetch` mock in jest tests, URL-routed (different responses for different URL patterns). See `secFormDAdapter.test.ts` for the exact pattern.

**Migration content_hash immutability.** Never edit an applied migration file. If you need to fix something post-apply, create a new corrective migration. The runner detects hash drift and refuses to proceed with a clear error message.

---

## 4. File reference card (most relevant paths for the next build)

```
backend/src/
├── db/
│   ├── schema.ts                           ← INGESTION_ADAPTER_TYPES tuple (~line 72) + pgEnum (~line 44)
│   └── migrations/
│       ├── 0050_phase12_form_d_adapter_type.sql  ← pattern for enum-add file
│       ├── 0051_phase12_form_d_source.sql         ← pattern for source-seed file
│       └── (next: 0052, 0053 for FRED)
├── jobs/ingestion/
│   ├── adapters/
│   │   ├── index.ts                        ← REGISTRY — add fred_api entry here
│   │   ├── secFormD.ts                     ← newest adapter, good reference
│   │   ├── secEdgarJson.ts                 ← exports humanizeCompanyName, humanDate (shared)
│   │   └── (new: fredApi.ts)
│   ├── generators/
│   │   ├── index.ts                        ← NativeGenerator registry
│   │   ├── types.ts                        ← NativeGenerator / NativeCandidate interfaces
│   │   └── (new: youtubeTranscript.ts)
│   └── types.ts                            ← AdapterContext / AdapterResult / Candidate interfaces
├── lib/
│   └── loadEnv.ts                          ← dotenv.config({ override: true }) — first import in CLIs
└── scripts/
    └── (CLIs for manual runs)

backend/tests/ingestion/
├── secFormDAdapter.test.ts                 ← reference pattern for adapter tests (URL-routed fetch mock)
└── (new: fredApiAdapter.test.ts)

docs/discovery/
└── ingestion-source-expansion.md          ← running plan doc — update after each tier ships
```

---

## 5. Gates before committing anything

```bash
npm run type-check --workspace=backend
npm run lint --workspace=backend
npm test --workspace=backend
```

All three must be clean. The test suite uses jest (not vitest — frontend uses vitest, backend uses jest). Test count should grow with every new adapter.

---

## 6. Quick summary of the full ingestion build order

| step | status | what ships |
|---|---|---|
| Tier 0 — Resurrect dead feeds | ✅ **done** | amd, meta, bis→Federal Register, intel re-confirm; money-stuff regression fixed |
| Form D adapter | ✅ **done** | `sec_form_d` adapter, migrations 0050/0051 (pending Railway deploy) |
| **FRED adapter** | ⬅️ **START HERE** | `fred_api` adapter, macro data cards (rates/CPI/10Y/unemployment/PCE) |
| YouTube transcript generator | 🔜 | new NativeGenerator, DISPATCH briefs, v1: Dwarkesh/Asianometry/TechTechPotato/No Priors/Acquired |
| Reddit | 🔜 | finish stub — OAuth, fixed subreddit list, top-of-day threshold |
| Bluesky / Anthropic bridge | 🔜 | RSS bridge path (zero code to start) |
| 12h Stripe billing | 🔜 | launch gate — separate session, not ingestion track |

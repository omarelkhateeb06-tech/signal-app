# SIGNAL — Unified Product & Engineering Roadmap

**Document purpose:** Single consensus document covering both product strategy (what SIGNAL is, what it becomes over time) and engineering phasing (what we build to get there). Engineering detail level intended for use as a working reference across Claude Code sessions. Non-engineering concerns (financials, customer acquisition, legal structure beyond what blocks engineering) deliberately excluded — covered elsewhere.

**Snapshot date:** June 16, 2026
**Status:** Ingestion track feature-complete (migrations 0000–0057). All adapter types shipped: `rss`, `arxiv_atom`, `sec_edgar_json`, `hackernews_api`, `reddit_api`, `github_api`, `sec_form_d`, `fred_api`, `sitemap`, `native_generator`. Feed is Editorial Redesign v2, events-only. Through-Line briefing, paywall, daily digest, and AI-image labeling all live on prod. **Phase 12h (Stripe billing) shipped and live** — Stripe is in live mode, legal pages (/terms, /privacy, /refund) are live. Remaining pre-launch items: domain purchase, SendGrid domain auth, support email.

> **Historical session notes (June 6–14) are preserved verbatim below** as > annotation blocks throughout the document. They contain detailed commit SHAs, migration archaeology, and decision rationale. The sections below reflect the consolidated current-state view; the annotations add depth.

> **JUNE 6, 2026 UPDATE (added — nothing below removed):** Two major things landed since the June 1 snapshot. (1) **Editorial Redesign v2 shipped + deployed to production** (PR #144) — content-type-aware feed, THE CONNECTION illustrated hero, lead-with-explanation cards, stickiness pass (thumbnails, tier-gated Pro teaser, "since your last visit" return loop), the Earnings/SEC data-led card (migration 0045 `content_type`), and the Signal Originals band rebuilt on the card system. See new §6.19. (2) A **moat-coverage audit (8-advisor, ~7.5/10)** identified the missing *real-time / social* source layer (X takes, GitHub repos, tool/startup launches, real-time community sentiment) and produced a dedicated spec — now scoped as **its own phase, Phase 12R / "V1·Live"**. See new §3 "V1·Live", new §6.20, and `docs/REALTIME_SIGNAL_LAYER.md`. A new **Unit Economics / Cost Model** section was added (§19) with verified June 2026 API pricing. All prior content is retained verbatim; statuses are advanced via additive annotations, not edits.

> **JUNE 7, 2026 UPDATE (added — nothing above removed):** Four things landed June 7. (1) **Image-first detail view** — the right-panel reader now bursts the story image full-bleed at the top (Bloomberg/WSJ pattern) before the depth toggle / headline / brief. (2) **Originals band collapsed to a single hero** — the feed opens with one THE CONNECTION hero and interleaves the other native Originals into the ranked stream; the redundant 6-wide "Signal Originals" band was removed (RankedStream already hoists the top Connection). (3) **Phase 12R.A breadth shipped** (PR #145) — Product Hunt → THE LAUNCH (`content_type='launch'`), a direct `github_api` adapter (WORTH AN AFTERNOON), and the `what_to_do_with_it` hook across the tier prompts; Reddit deliberately **not** activated (commercial cost, consistent with §19). (4) **Custom native-post illustrations are now AUTOMATED** — but via a membership-powered Higgsfield path (the banana MCP driven by a SessionStart hook), **not** the OpenAI backend pipeline §6.18 anticipated; $0 instead of ~$0.04/image. **New pre-launch gap surfaced:** AI-generated images are not yet labeled in the UI (a stated §6.18 / §15 requirement). Full detail in new **§20**. All prior content retained verbatim; statuses advanced via additive annotation.

> **JUNE 16, 2026 UPDATE (added — nothing above removed):** Two things shipped this session. (1) **Phase 12h Stripe billing fully live** — the root cause of the "upgrade button does nothing" report was a price-ID mode mismatch: the price was created in Stripe live mode but the deployed backend was using a test secret key (`sk_test_`). Test and live resources are completely separate in Stripe. Fix: created test-mode prices via API, confirmed checkout working end-to-end in test mode, then cut over to live mode: set `STRIPE_SECRET_KEY=sk_live_*`, created live-mode monthly and annual prices, set `STRIPE_PRICE_ID` and `STRIPE_ANNUAL_PRICE_ID` to live values, created a live webhook endpoint, set `STRIPE_WEBHOOK_SECRET` to the live signing secret. Stripe account was already fully activated (`charges_enabled: True`, `payouts_enabled: True`) — no LLC required. The checkout now goes directly to Stripe's hosted checkout with "7 days free, then $10.00/month". (2) **Legal pages shipped** — `/terms`, `/privacy`, `/refund` as public Next.js pages (outside the auth-gated route group). Business entity: Human Machine Automation LLC, Minnesota law. Refund windows: 7-day free trial (no charge), 72h full refund after first monthly charge, 14-day for annual (< 5 story views). Pages linked from `/upgrade` footer. One Stripe Dashboard manual step remains: update business display name to "SIGNAL" and add policy URLs in Settings → Business. All prior content retained verbatim.

> **JUNE 16, 2026 UPDATE — Phase 12w (Day-1 Data Capture) (added — nothing above removed):** Built the data-capture + measurement layer so analytics, attribution, and the data-asset metrics collect from day one. A gap audit against the data-tracking spec found most of it uncaptured — and attribution/firmographics can't be backfilled, so they had to land before launch. Five chunks, each its own commit on `claude/data-capture-12w`, all gates green (backend 106 suites / 1465 tests; frontend 29 / 164): (1) **Funnel sink** — `lib/analytics.ts`'s `track()` beacon was POSTing to an unmounted `/api/v1/events` and silently dropping every funnel event (upgrade_viewed/checkout_started); wired `product_events` (migration 0062) + an optional-auth endpoint (`optionalAuth` middleware) and upgraded the client to attach the JWT via keepalive-fetch when authed. (2) **First-touch attribution** — `lib/attribution.ts` captures utm_*/referrer/landing on first visit → localStorage → sent with signup; `users` gains utm_source/medium/campaign, referrer, landing_path, signup_source (migration 0063; signup_source derived utm → referrer-host → direct). (3) **Optional firmographics** — company / company_size / how_did_you_hear on `user_profiles` (migration 0064, CHECK-constrained), added as OPTIONAL fields to onboarding Screen 2 + Screen 7 (stays 7 screens; never gates completion — the conversion-vs-data tradeoff decision). (4) **Email open/click tracking** — SendGrid trackingSettings on every send + `email_events` (migration 0065) + `POST /api/v1/emails/webhook` (SendGrid Event Webhook sink, partial-unique dedup on sg_event_id, optional `?token=` shared secret). (5) **Admin reporting** — `GET /admin/reports/{growth,revenue,data-asset,engagement}` turn it all into the spec's audit numbers (JSON; dashboard UI deferred). Privacy policy updated to disclose attribution, optional company data, and email engagement tracking. **OPS for Omar:** set the SendGrid Event Webhook URL to `…/api/v1/emails/webhook?token=<secret>` (enable Opens + Clicks) and `SENDGRID_WEBHOOK_TOKEN` in Railway; optionally add UTM tags to marketing links. Migrations 0062–0065 apply automatically on the next deploy. All prior content retained verbatim.

> **JUNE 10, 2026 UPDATE (added — nothing above removed):** The ingestion-track sessions June 8–10 landed four clusters (commits `7db8d1f`, `43a3f1e`, `12a20e4`, `090b13d`, `931506d`). (1) **Onboarding cluster** — topic taxonomy consolidated to 5 broad categories per sector (#24), field-of-work made optional on Screen 2 (#18), digest explainer added to Screen 7 (#25), and the #53 CLI dotenv-override loader (`lib/loadEnv.ts`, first-import in every CLI script) killed the shell-shadowed-`.env` trap. (2) **Ingestion Tier 0 — dead-feed resurrection:** amd-newsroom, meta-ai-blog re-enabled; intel-newsroom re-confirmed; bis-press upgraded to the **Federal Register BIS API RSS** (live export-control rulemaking/enforcement primary). A regression where `fixBrokenSources --apply` disabled the *healthy* money-stuff feed was caught + fixed (lesson recorded: never list a working source in the repair registry). Still dead, need a bridge: anthropic-news, asml-news, tsmc-newsroom, the-batch, huggingface-papers, reuters-business. (3) **SEC Form D adapter** (`sec_form_d`, migrations 0050/0051) — Reg D private-financing *discovery* via EDGAR full-text search, pre-filtered to operating-tech industries + ≥$5M disclosed offerings (~1–2 candidates/day pre-gate); this is the free primary-source **Crunchbase replacement** (§19). (4) **FRED adapter** (`fred_api`, migrations 0052/0053) — macro data cards (fed funds, CPI, 10-Y Treasury, unemployment, PCE) as EARNINGS/SEC cards; index series headline YoY %; gated on `FRED_API_KEY` (free key — **needs setting on Railway Variables**, adapter logs-and-skips until then). ~~Migrations 0050–0053 are pending on prod and apply on the next deploy.~~ *(Applied later the same day — a deploy ran after the morning pushes; Form D + FRED are live on prod, FRED log-skipping until its key lands.)* Running source-expansion detail lives in `docs/discovery/ingestion-source-expansion.md`. **Same-day additions (June 10 PM):** (5) **YouTube episode-dispatch generators shipped** — five `youtube-*-native` NativeGenerator instances (Dwarkesh / Asianometry / TechTechPotato / No Priors / Acquired), Data API v3 listing + timedtext captions with description-only fallback, Haiku-authored DISPATCH briefs (never the raw transcript), migration 0054 (pending), `YOUTUBE_API_KEY`-gated (free Google Cloud key — **needs setting on Railway Variables**). (6) **Organization pass** — orphaned docs committed (12R spec, handoffs, `.claude` hook infra), worktree drift cleaned (OneDrive-nested worktrees removed, 10 dead branches deleted; `claude/agitated-villani-6f1443` kept — it holds an unmerged HN self-post draft with extra tests, salvage-or-drop decision pending), `/redesign-preview` hard-404s in production builds, `.env.example` WEEKLY→DAILY digest cron fixed, `backfill-generic-commentary` confirmed already-complete (0 rows; §14 carry-over closed). **(7) AI-image labeling COMPLETE (§20.3 closed).** The `AiArtBadge` already covered the three swiss components (ConnectionHero, DetailPanel, StoryExhibit); this pass closed the two remaining live gaps — `FeatureImage` (→ StoryCard: related-stories, saved, search) and `StoryDetail`'s native illustration hero (the `/stories/[id]` route). The badge shows only when the displayed image is the AI illustration (native, no scraped og:image), never on a real og:image. `SignalOriginals.tsx` also renders an illustration unbadged but is confirmed dead (imported nowhere; band removed in §20.1) and left untouched per the no-dead-scope rule. **(8) Bluesky/Anthropic RSS bridge INVESTIGATED, not seeded — the zero-code path is blocked.** Probed ground truth: Anthropic has no native RSS (`/rss.xml`, `/news/rss`, `/feed.xml` all 404) and `openrss.org` does not auto-bridge arbitrary URLs (returns its own HTML landing page — wrong content-type, which the RSS adapter rejects). Bluesky posts (≤300 chars) cannot clear the pipeline's 500-char body floor (`BODY_LENGTH_FLOOR_CHARS`), and a Bluesky RSS item's `<link>` points at the JS-shell post page where readability extracts nothing → guaranteed `body_too_short`/`body_parse_error`. Seeding either as a plain `rss` source would manufacture failing sources (the money-stuff anti-pattern), so nothing was seeded. Real path if wanted: a `bluesky_api` adapter carrying post text as `bodyText` (like HN self-posts) **plus** a per-source body-floor exemption — Tier-3 work, and with an open design question (a 300-char take is likely better as a clustering/trending signal than a standalone enriched card). Finding recorded in `docs/discovery/ingestion-source-expansion.md` §7 Q1. **(9) Sitemap adapter — Anthropic resurrected (June 14).** The Bluesky/Anthropic bridge dead-end had a real way around it for *long-form* primaries: a general `sitemap` adapter. Anthropic killed its RSS but publishes `sitemap.xml`; the adapter discovers `/news/` articles there and the body seam fetches each page (verified live: 33 articles/60d, ~90k chars/page — clears the 500-char floor that killed the RSS/social bridges). Migrations 0055 (enum) / 0056 (repoint `anthropic-news`: `rss`→`sitemap`, re-enabled, priority 1). **Correction to the earlier "resurrects the whole dead lab tier" framing:** only `anthropic-news` was actually dead — `openai-news`, `deepmind-blog`, and `google-research` were probed the same day and their RSS is **live (200)**, so they stay on `rss` (real titles/summaries); converting a working feed would be a regression. The adapter is the general fallback for any primary whose RSS later dies. Known tradeoff: sitemap entries have no title, so titles are slug-derived ("Tcs Anthropic Partnership") — acceptable under the source kicker, og:title fetch is the documented upgrade. **(10) Reddit adapter shipped (June 14).** The throwing `reddit_api` stub is now a real adapter — userless OAuth2 (client-credentials → bearer) then top-of-day per configured subreddit, mirroring the HN adapter's link-post / self-post split (selftext rides as pre-fetched `bodyText`; the 500-char floor still drops thin self-posts, so Reddit is viable where Bluesky wasn't). Migration 0057 activates `reddit-finance` (SecurityAnalysis + investing, minScore 100, priority 4, `REDDIT_CLIENT_ID`/`SECRET`-gated). Finance-only for v1 (honors the slug); the adapter is config-driven so AI/semis subreddit rows are a follow-up data change. Free API tier is fine for private beta; commercial scale needs a paid contract (§19), so it stays beta-gated. **Ingestion track is now feature-complete:** every planned non-paid source ships (Tier 0 feeds, Form D, FRED, YouTube, sitemap/Anthropic, Reddit). What's left is config (the Railway keys; optional AI/semis Reddit rows) and the parked paid tier (X, Crunchbase, IG/TikTok, LinkedIn). **12h (Stripe) is the remaining launch gate.** All prior content retained verbatim.

---

## 1. What SIGNAL Is

SIGNAL is a daily intelligence and (eventually) community surface for high-agency professionals in AI, Finance, and Semiconductors who feel both behind and overwhelmed by the pace of their fields. It collapses what's currently fragmented across Twitter, LinkedIn, Reddit, GitHub, Substack, Bloomberg, and a dozen newsletters into one place — but with three things no aggregator combines: per-reader personalized commentary at three depth tiers (Accessible / Briefed / Technical), a credibility/quality scoring layer (SIGNAL rating) that lets users navigate volume without drowning, and over time a learning layer that turns reading SIGNAL into getting smarter at your domain.

Promise: 10–15 minutes a day on SIGNAL beats 60–90 minutes spread across five other sources, because the noise is filtered, the framing is personalized, and the depth meets you where you are.

The differentiation that earns premium pricing: not consolidation alone (which competes with free RSS readers), but the personalized commentary layer + the credibility layer + (later) the educational layer that no other product in the space combines.

**Signal-native posts (expanded June 1, 2026):** SIGNAL generates its own editorial content synthesized from publicly observable signals — HN-surfaced GitHub repos, arXiv activity, HN community discussion, cross-sector causal chains between Finance/AI/Semis events, tool spotlights for practitioners, SEC filing patterns, supply-chain events. Seven generators are live with a global 25/day cap. Native posts are written in a hook-first professional style with five beats: HOOK → SPECIFICS → STAKES → SOURCE → mandatory ACT/WATCH close (Treatment 2 prompts, June 1 rewrite). These fill gaps that traditional journalism lags on and give SIGNAL an editorial voice distinct from pure aggregation. The cross-sector chain generator is the platform's most differentiated output — no single-sector RSS feed can produce causal chains connecting Fed rate decisions to semiconductor capex to AI infrastructure cost. AI-generated illustrations for native posts are in active evaluation (Higgsfield MCP connection live in chat; backend integration deferred to post-beta — `og_image_url` column exists).

**Engagement-driven ranking (partially shipped May 30):** Saves are now wired into `effective_score`. Scroll/dwell time, click-through, and share signal remain post-beta once behavioral data accumulates.

> **ADDED June 6 — Editorial Redesign v2 (shipped):** The feed is no longer a uniform list of links. Every item now **leads with the personalized "why it matters to you" explanation** as the hero text (source headline becomes secondary attribution), and **format follows content type** — each kind of content gets its own card shape: THE CONNECTION (cross-sector chain, full-width illustrated hero), THE RESEARCH READ, PRACTITIONER BRIEF, WORTH AN AFTERNOON (tools/repos), EARNINGS / SEC (data-led with "the number that mattered"), MULTI-SOURCE (source-wall), and DISPATCH (single-source news). The redesign also added stickiness mechanics: og:image thumbnails + per-type index tiles, a tier-gated blurred Pro teaser (the moat made visible to free users → conversion), a second-peak feature card mid-scroll, and a **"since your last visit" return loop** (the feed greets a returning reader with what's new since they were last here). The moat — ranking + per-reader explanation — was already the hard part; this redesign finally *surfaces* it. Full detail in §6.19.

> **ADDED June 6 — The Real-Time Layer (next, its own phase):** A June 6 moat audit found SIGNAL covers the *structured / slow* web (research, news, community threads, filings) but **not** the *fast / social / launch* layer a practitioner actually lives in — X takes ("Elon just said this"), new GitHub repos, tool/startup launches, real-time community sentiment. Closing this is scoped as a distinct initiative — see §3 "V1·Live" and §6.20. The vision Omar articulated: wake up, open the app, and get a varied morning briefing — "this happened today, here's why it matters to you" — across *every* signal type (news + a fresh repo + a research drop + a hot X take + a startup launch + community sentiment), each carrying the personalized explanation as the entry point.

---

## 2. Where We Are Today

**V1 Extended engineering-complete.** Native posts pipeline fully shipped and expanded. Source registry grown to 70. June 1 cluster closed all remaining pre-beta engineering items except commentary hook improvement (in progress), sector mismatch fix (in progress), and CLAUDE.md lockfile doc (in progress).

**Current HEAD:** latest commit after small-fixes CC session (lead story image preference + asterisk ban — deployed to Railway successfully).

> **ADDED June 6 — Current HEAD (`main`):** `491eac2` — `feat(feed): redesign-v2 — content-type-aware cards, Connection hero, stickiness pass (#144)`, on top of `426ad39` (#143 native engine revival) and `4bb9e9c` (#142 Swiss Command Center). Deployed: Vercel (frontend) + Railway (backend, migration 0045 applied). Backend 1286 tests / Frontend 158 tests, all green. Verified live on the real prod feed.

**What shipped May 30, 2026:**

| Commit | What |
|---|---|
| `64c40f8` | Enabled-guard in poll job — disabled sources stop burning HTTP calls, log `failure=source_disabled` |
| `62b59ee` | 12o.1: Saves wired into `effective_score` — feed ranking now rewards saved content via `W3·ln(1+save_count)` |
| `b193284` | 12m.2: Finance relevance prompt tuned (markets-as-lens not finance-vertical); transient api_errors now park instead of terminal-reject; 3-city test verified live |
| `f0c91a8` | 12m.1 round 1: +12 verified RSS sources via migration 0034 (27 → 39 working) |
| `bdc05c8` | 12m.1 round 2: +10 new + 2 re-homed (money-stuff/Matt Levine recovered, intel-newsroom) via migration 0035 (39 → 51+ working) |
| `5deb8ad` | 12n.1: HN rejected-pool repo discovery generator + Fork B native orchestrator (migrations 0036/0037) |
| `fac8558` | 12n.1 gate: multi-signal qualification (anti-gaming + HN corroboration) |
| `4a5d41e` | 12n.1 diagnostics: verbose dry-run gate diagnostics |
| `bdc05c8` | 12n.1 authoring: authoring-stage diagnostics + issues-to-stars credibility gate |
| `bb0014b` | 12n.1 flip: HN rejected-pool discovery-flip |
| `5deb8ad` | 12n.2: arXiv synthesis + HN community synthesis generators (migration 0038) |
| `1cd8557` | 12n.3: Earnings/filing reaction + supply-chain synthesis generators (migration 0039) |
| `63aa655` | 12n.4: Global daily cap across all generators (10/day, DB-count mechanism, fail-open) |
| `9519c40` | Migration 0040: sec-edgar-finance (16 major financial filers, CIKs verified against SEC) + sec-edgar-semis re-enabled |

**What shipped June 1, 2026:**

| Commit | What |
|---|---|
| `2e43ec2` | enrichmentJob.test.ts — 6 pre-existing failures fixed. Root cause: `process.env.OPENAI_API_KEY = ""` missing from `tests/setup.ts`; embedding stage was env-fragile, ambient shell key defeated opt-out. |
| `02ee194` | drizzle-orm 0.35.3 → 0.45.2 — HIGH CVE GHSA-gpj5-g38j-94v9 (SQL injection). |
| (npm audit) | axios, qs, ws, brace-expansion, @tootallnate/once — cleared safe vulns. |
| (shimmer) | `frontend/tailwind.config.ts` + `frontend/src/app/globals.css` — shimmer-x converted from `background-position` paint animation to GPU-composited `transform: translateX` on `::after` pseudo-element. Lighthouse non-composited animation fix. |
| `fac65be` | System B commentary date anchor — threaded `currentDate: string` through `CommentaryPromptV2Inputs`, prepended as first line of prompt. Fixes Haiku temporal hallucination ("Q1 2025" as future). |
| `0336729` | Events-only feed — removed legacy `stories` table union leg from `getFeed` in `storyController.ts`. 20 legacy stories (1–2 months old) were beating fresh `events` content. `searchStories`/`getRelatedStories` still query stories-only — flagged for rewrite. |
| (pagination) | Feed pagination slice fix — `ranked.slice(0, limit)` → `ranked.slice(offset, offset + limit)` + edge guard `has_more`. Pre-existing bug exposed by events-only change; caused duplicates in "More in Your Sectors" river. |
| `0905e20` | backend/package-lock.json regeneration — Railway deploys failed 4× with npm ci lockfile mismatch after drizzle-orm upgrade. Root cause: `backend/Dockerfile` uses `backend/` as build context with standalone `backend/package-lock.json` separate from root lockfile. Regenerated in scratch dir outside workspace. |
| `31b2e5b` | Migration 0041 — 6 new RSS sources: Next Platform (semis q8), Chips and Cheese (semis q8), Tom's Hardware (semis q7), Hackaday (semis q6), Econbrowser (finance q7), Alpha Architect (finance q7). |
| `ebd1ef8` | Phase 12n.5: cross-sector chain + tool spotlight generators (migrations 0042). Rewrote arXiv and HN synthesis prompts (Treatment 2: hook-first five beats + mandatory ACT/WATCH close + cross-sector framing). Raised NATIVE_DAILY_CAP 10→25. +2 suites, +27 tests — 84 suites / 1254 passed / 0 failed. |
| (small fixes) | Lead story image preference (scans top 5 for first with `image_url`, falls back to rank-1). Asterisk emphasis ban added to all four native post prompt files. Rail bug fix (filter-by-id, not slice-from-1, to prevent lead duplication). |

> **ADDED June 6, 2026 — Editorial Redesign v2 (PR #144, 9 commits, squashed to `491eac2`):**
>
> | Commit | What |
> |---|---|
> | `8cb43a9` | content-type-aware cards + THE CONNECTION hero — `lib/feedCardType.ts` (`deriveCardType` maps `kind`/`generator_type`/`content_type`/`sources` → discriminated type), `ConnectionHero.tsx` (full-width illustrated flagship, chain-motif fallback), `StoryExhibit` type labels, `RankedStream` hoists the top Connection |
> | `7413cfb` | stickiness pass — row og:image thumbnails, multi-source "covered by …" source-wall, practitioner discussion counts, freshness NEW badges (`lib/feedFreshness`), `LockedTeaser` (blurred personalized read), second-peak `FeatureExhibit` |
> | `c449a26` | tier-gated teaser (free-tier only, via `useTier`) + per-type index tiles (Network/GraduationCap/MessagesSquare/Wrench/TrendingUp/Layers/Newspaper) |
> | `db89193` | **backend** — earnings/SEC content-type signal: migration 0045 `events.content_type` (+ CHECK + index + EDGAR backfill), `writeEvent` classification (`sec_edgar_json` → `'filing'`), `storyController` surfaces `content_type` on the wire |
> | `2a18bda` | data-led EARNINGS / SEC card + `leadStat` extraction ("the number that mattered" pulled from real commentary text, never fabricated) |
> | `636b1e0` | "N new" habit cue on the ranked stream |
> | `b3f9f2d` | **backend** — native archive endpoint enriched with `generic_commentary` + `image_url` so the Originals band can lead with the explanation |
> | `51c2ddc` | Signal Originals band rebuilt on the card system — flagship THE CONNECTION as illustrated hero on real data, research/practitioner originals as distinct cards (`nativeToStory` adapter); thumbnail falls back to `illustration_url` |
> | `12ba7a9` | **"since your last visit" return loop** — `hooks/useLastVisit` (localStorage, session-stable, 30-min advance gate), `freshBoundaryMs`/`isAfter`; NEW badges + count read "N new since last visit" for returning readers |
>
> **Redesign predecessors (shipped June 3–5):** PR #140 (Swiss+Vintage fusion at `/feed-swiss`), #141 (real per-story data + visual rhythm tiers), #142 (Swiss Command Center as primary feed — "Fusion A"), #143 (native engine revival — daily 09:00 UTC scheduler, `/native` 500 fix, Originals band, removed the auto-mark read counter).
>
> **Migrations added since June 1:** `0043` (12p events FTS index), `0044` (12s `events.illustration_url`), `0045` (12u `events.content_type`).
>
> **Board assessments (June 6):** Redesign quality (8-advisor) **~37/40** (ceiling ~37.6). **Moat-coverage audit (8-advisor) ~7.5/10** — both personalization layers + explanation-as-entry-point + format-follows-type fully covered (the hard, defensible part); the one gap is source breadth (the fast/social/professional layer: X, IG/TikTok, LinkedIn). Conclusion: the editorial+explanation moat is done; the real-time layer is the next bet (§6.20).

**Source health fixes applied June 1 (prod SQL, not committed via CC):**
- Re-enabled: electronic-design (36 failures was intermittent), deepmind-blog (q9, low cadence), apricitas (q8, low cadence).
- Disabled: the-diff (RSS frozen since Nov 2022), morning-brew (q5, low quality).
- 663-consecutive-failure batch confirmed dead — no working RSS endpoints, no re-enable possible: Anthropic News, AMD, TSMC, Meta AI, Hugging Face, Reuters, ASML, BIS, The Batch.

**Native post generators (7 total, all live):**

| Generator | Signal source | Cadence | Sectors | Cap behavior |
|---|---|---|---|---|
| HN repo discovery | HN llm_rejected/heuristic_filtered pool with github.com URLs | On-demand | AI | 1/run (strongest qualifying tool) |
| arXiv synthesis | Published arXiv events, last 7d, min 2 papers/sector | Weekly per sector | AI, Semis | 1/sector/week (ISO-week dedup) |
| HN community synthesis | Published HN non-repo events, last 7d | Weekly per sector | AI, Finance, Semis | 1/sector/week |
| Earnings/filing reaction | SEC EDGAR events, last 48h | Near-daily | Finance, Semis | 1/run |
| Supply-chain synthesis | Multi-corroborated Semis events (≥2 sources), last 7d | Weekly | Semis | 1/run |
| Cross-sector chain | Qualifying events across TWO sectors, last 48h, quality ≥7 | Daily | finance+semis or ai+finance or ai+semis | 1/run (strongest qualifying pair) |
| Tool spotlight | HN repo pool (any status, 72h), uncovered repos, MIN_HN_SCORE=50 | Daily | AI | 1/run (strongest qualifying tool) |

**Global cap:** `NATIVE_DAILY_CAP = 25` (UTC-day, DB-count enforced, fail-open).

> **ADDED June 6:** A daily **09:00 UTC native-generation scheduler** (`nativeGenerationScheduler`) was wired in PR #143. ⚠️ **Open verification (deep-research item):** whether `github-trending-native` / `tool-spotlight-native` are actually *producing* in prod has NOT been confirmed — the June 6 prod feed's Originals band showed Research Read / Practitioner Brief / Connection / SIGNAL Original but no tool-spotlight card. Needs the admin ingestion-status route (auth) or a native-archive query by `generator_type`. Carried into the Real-Time Layer deep-research pass (§6.20, §17).

**Native posts published June 1 (3 live):**
- `3af3d4dc` — "Memory Shortage Premium Meets Rate Expectations—SK Hynix Bet Now Hinges on Central Bank Action" (finance, cross-sector chain)
- `ffbdd74c` — "The AI practitioner's paradox: abundance is creating laziness, not leverage" (ai, HN synthesis)
- `651235e1` — "The AI labor collapse is forcing finance to confront demand destruction, not just displacement" (finance, HN synthesis)

**Source registry:** 70 total (59 active, 11 disabled). Active includes: Matt Levine / Money Stuff, One Useful Thing (Ethan Mollick), Lilian Weng, Big Technology, Daily Upside, Calculated Risk, Doomberg, Citrini Research, DIGITIMES, SemiWiki, EDN, IEEE Spectrum, Next Platform, Chips and Cheese, Tom's Hardware, Hackaday, Econbrowser, Alpha Architect.

> **ADDED June 6:** The **Reddit adapter is built (`adapters/reddit.ts`) but disabled at the registry** (`reddit_api: null` in `adapters/index.ts`) — activation is a one-line flip + seed subreddits (see §6.20). NOTE the economics changed: per the June 6 cost research, **commercial Reddit API access now requires a contract (~$12k/yr)** under Reddit's Nov 2025 Responsible Builder Policy; the free tier is non-commercial only. See §19.

**Lighthouse (June 1):** Performance 86 (SI=10.9s is architectural ceiling, deferred), Accessibility 100, Best Practices 100, SEO 100.

**Commentary cache state (prod):**
- 170 accessible, 8 briefed, 3 technical entries in commentary_cache
- System B commentary (why_it_matters_template JSONB with {thesis, support} fields) is the displayed format
- System A (generic_commentary text on event row) is fallback for Free users

**Post-deploy actions (still pending):**
1. Run `npm run backfill-generic-commentary --workspace=backend` in prod — pre-12g stories fall back to `why_it_matters` until then.
2. Remove `WEEKLY_DIGEST_CRON` from Railway env vars. New var: `DAILY_DIGEST_CRON` (default `0 11 * * *`).

> **ADDED June 6 — post-deploy:** 3. Gate or remove the public `/redesign-preview` dev route (mock-data card showcase, incl. the EDGAR card) before any public launch cut. 4. Earnings/SEC card is data-dependent — it only renders when a SEC EDGAR `filing` event is ranked into the feed window; migration 0045 backfilled existing EDGAR events to `content_type='filing'`.

**Prod URLs:**
- Backend: https://signal-app-production-cd33.up.railway.app
- Frontend: https://project-nvrod.vercel.app
- Admin: https://signal-app-production-cd33.up.railway.app/admin/ingestion/status (requires Bearer JWT + ADMIN_USER_IDS)

> **ADDED June 6:** Public redesign mock (no auth): https://project-nvrod.vercel.app/redesign-preview

---

## 3. The Strategic Versions

Six versions over the lifetime of the product. Each is independently shippable; each leaves the product more complete than the previous; each can be evaluated on its own merits before committing to the next.

> **ADDED June 6:** A new strategic milestone — **"V1·Live — The Real-Time Layer"** — is inserted below between V1 Extended and V2. It is treated as its own phase per the moat audit (a multi-source ingestion initiative distinct from the V1 feed and the V2 learning layer). The six-version frame is otherwise unchanged.

### V1 — Launch ("The Signal")

The full feed product. What ships:

- **Multi-source ingestion: 59+ active sources across five adapter types** (RSS/Atom, arXiv Atom API, SEC EDGAR JSON, Hacker News API, Reddit API). High-signal-weighted editorial bar — lab primaries, top-tier analyst newsletters, official government/regulatory feeds, plus a curated tail of community signal.
- **Event-centric data model.** A story in SIGNAL represents an event in the world (e.g., "NVDA reports Q4 earnings"), not an article from a single source. Multiple sources covering the same event attach as linked sources to one canonical event row, with the feed surfacing "covered by SemiAnalysis, Bloomberg, +5 more" attribution. Cluster-match via cosine similarity (0.85 threshold) against trailing 72h events. Source priority (tier 1–4) determines primary-source promotion on attach.
- Format-aware commentary per source type.
- Three depth tiers (Accessible / Briefed / Technical).
- Accounts, saved articles, reading history.
- Refresh/feed ranking that pushes already-seen content to the bottom.
- Daily digest email (Pro-only, ~10 stories, TLDR-style, sector-sectioned).
- **SIGNAL rating v1** — every event shows a credibility/quality score.
- **Two-tier paywall:** Free (15 stories/day, Accessible only, role-neutral commentary, 3 searches/day) and Pro ($10/month or $96/year — unlimited stories, all depths, personalized commentary, unlimited search, daily digest, 7-day trial on signup).
- **Design system:** Newsreader (serif display) + IBM Plex Sans (body) + JetBrains Mono (data). Warm editorial aesthetic with sector-coded accent colors (AI indigo, Finance emerald, Semis burnt orange). All surfaces polished.

> **ADDED June 6:** The launch feed surface is now the **Editorial Redesign v2** (PR #144) on top of the Swiss Command Center (#142) — content-type-aware, explanation-led cards; Signal Originals band with illustrated flagship hero; stickiness mechanics (thumbnails, tier-gated Pro teaser, since-last-visit return loop). The original design-system fonts/accents above coexist on non-feed surfaces. See §6.19.

### V1 Extended — Scale & Signal ("More Signal, Less Noise") ✅ SHIPPED + EXPANDED

Core shipped May 30, 2026; expanded June 1, 2026. Expanded source coverage, added and expanded Signal-native editorial posts, wired saves into ranking, tuned the relevance filter, fixed feed staleness, upgraded security, improved commentary quality. No new user-facing features — makes the existing product substantially better and the feed substantially fuller.

- **Source expansion: ✅** 18 working sources → 59+ (migrations 0034, 0035, 0040, 0041). AI 17+, Finance 22+, Semis 18+.
- **LLM relevance filter tuning: ✅** Finance prompt tuned (markets-as-lens across any industry). Transient api_errors park instead of terminal-reject.
- **Reddit adapter activation:** Awaiting OAuth credentials (#83). Once received, 1 session.
- **Signal-native posts: ✅ EXPANDED** Seven generators live (up from five May 30). Cross-sector chain and tool spotlight added June 1. Global cap raised to 25/day. Treatment 2 prompts with five-beat structure and mandatory ACT/WATCH close. First cross-sector chain post published June 1.
- **Saves wired into ranking: ✅** `W3·ln(1+save_count)` in `effective_score`.
- **Security: ✅** drizzle-orm CVE GHSA-gpj5-g38j-94v9 (SQL injection) patched June 1. npm audit clean.
- **Feed staleness: ✅** Events-only feed (legacy stories table removed from getFeed). Pagination slice fix.
- **Test suite: ✅** 84 suites, 1254 passed, 0 failed. enrichmentJob.test.ts 6 pre-existing failures fixed June 1.
- **Commentary date anchor: ✅** Haiku no longer hallucinates past dates as future.

> **ADDED June 6 — Editorial Redesign v2 layered onto V1 Extended (✅ SHIPPED):** content-type cards, Connection hero, lead-with-explanation, stickiness + return loop, Earnings/SEC card, Originals band rebuild — the presentation-layer pass that finally surfaces the moat. Detail in §6.19. ALSO note Reddit adapter activation (above) is now folded into the new Real-Time Layer Phase A (§6.20), and its economics changed (commercial contract — §19).

### V1·Live — The Real-Time Layer ("Live") ⏳ ADDED June 6 — ITS OWN PHASE

> **New strategic milestone.** Identified by the moat audit as the single biggest gap between "very good product" and "closes all my other tabs." SIGNAL covers the *structured/slow* web; this adds the *fast/social/launch* layer so the morning briefing spans **every** signal a practitioner actually checks. Treated as its own track because it's a multi-source ingestion initiative (new adapters, new card types, paid sources) distinct from the V1 feed and the V2 learning layer. Engineering detail in §6.20; full spec in `docs/REALTIME_SIGNAL_LAYER.md`; cost analysis in §19.

- **Phase A 🟢 (mostly free) — Breadth.** GitHub repos (verify/activate `github-trending-native`), Product Hunt (reuse RSS adapter), Reddit (flip the registry on + seed subreddits). Makes the feed heterogeneous; proves the multi-source briefing. *Cost caveat (June 6 research): Reddit commercial access is no longer free — free tier is non-commercial only; commercial contract ~$12k/yr. GitHub + Product Hunt remain genuinely free. So "Phase A free" holds only if Reddit runs on the non-commercial free tier during private beta.*
- **Phase B 🔴 (paid) — The real-time social layer.** X / Twitter curated allowlist → "THE TAKE" card. The "Elon just said this, here's why it matters to you" layer. *Cost caveat (June 6 research): new developers can't get X Basic ($100/mo) anymore — the path is pay-per-use at $0.005/read, realistically ~$300–600/mo at modest polling. See §19.*
- **Phase C 🟡 — Funding/startup depth.** Funding RSS now; Crunchbase API later ($99/mo Pro, free tier eliminated 2025).
- New card types: **THE TAKE** (X), **THE LAUNCH** (Product Hunt/funding); the redesign's content-type seam lights them up automatically.
- New hook variant: **`what_to_do_with_it`** for action-oriented types (repos/tools/skills) — "what you can apply this toward" (Omar's direction).

### V2 — Depth ("Get Smarter")

Tier-aware inline glossary. "Concepts to know" sections in the digest. SIGNAL rating v2 (cross-source corroboration + user feedback). Inline learning layer that turns reading SIGNAL into domain knowledge accumulation. This version keeps the inline educational layer which was originally part of the broader V3 scope before the course platform was spun off.

### V3 — Courses ("Learn Here") — ⛔ SCRAPPED / PIVOTED

**The full course library and standalone learning platform have been pivoted to a separate, independent project.** This version no longer exists on this roadmap. The inline learning features (glossary, concepts in digest) remain in V2 as described above. The Premium tier ($15–20/month) that was designed to gate the course library is also removed from the pricing ladder — the two-tier Free/Pro model is the permanent pricing structure for SIGNAL.

### V4 — Voices ("Your Take")

User-generated posts. Profile pages. Personal ranking using behavioral signal.

### V5 — Conversation ("Talk Here")

Threaded comments, rated by SIGNAL. Community flagging, automated filters, trusted-user moderation.

### V6 — Connection ("Find Your People")

Co-founder/collaboration discovery. Optional. Decision deferred until after V5 behavioral data.

---

## 4. Pricing Ladder Across Versions

| Version | Free | Pro ($10) |
|---|---|---|
| V1 | 15 stories/day, Accessible only, role-neutral commentary, 3 searches/day | Unlimited stories, all depths, personalized commentary, unlimited search, daily digest |
| V1 Extended ✅ | Same + native posts visible | V1 Pro + native posts, save-signal-ranked feed |
| **V1·Live ⏳ (added)** | **Same + real-time cards (THE TAKE / THE LAUNCH) visible** | **+ personalized "why it matters to you" on real-time signals** |
| V2 | Same + inline glossary | V1 Extended Pro + glossary + concepts + smarter rating |
| V4 | + view user posts | + post own content, profile |
| V5 | + read comments | + comment, flag |
| V6 | — | + standard discovery |

**Note:** Premium tier removed following V3 pivot. Two-tier model (Free / Pro) is permanent.

**Cost note:** Haiku spend at V1 ingestion volume estimated at $80–150/day worst case (5 calls/event × ~30–50 events/hour). Native post generation: ~5 Haiku calls per post × 25/day cap ≈ 125 additional calls/day — negligible against ingestion volume. Daily digest has zero incremental Haiku cost (uses pre-generated generic_commentary). Custom illustrations for native posts (planned): ~$0.04/image × 25/day cap = <$30/month.

> **ADDED June 6:** Real-Time Layer net-new paid cost (verified June 2026 pricing, §19): Phase A ~$0 (GitHub/PH free; Reddit free non-commercial during beta, else ~$1,000/mo commercial) · Phase B (X pay-per-use) ~$300–600/mo · Phase C (Crunchbase Pro) $99/mo. Full unit-economics model — including the 100-user spend-vs-revenue P&L and break-even — is in the new §19.

---

## 5. Foundation: Phases 0–11 (Shipped April 17–18, 2026)

### 5.1 Phase 0 — Project scaffold
Monorepo with frontend/ (Next.js 14 App Router) + backend/ (Express/TypeScript). Placeholder landing page. Backend /health endpoint. tsconfig strict mode. CLAUDE.md authored.

### 5.2 Phase 1 — Database & migrations
Drizzle ORM. Initial schema. Migration runner scaffolding. Seed script.

### 5.3 Phase 2 — Authentication
JWT auth with bcrypt. Login/signup endpoints. Auth middleware. Jest test infrastructure.

### 5.4 Phase 3 — Profiles & onboarding
User profile schema and CRUD. Multi-screen onboarding flow.

### 5.5 Phase 4 — Story feed & personalization
Paginated story feed with infinite scroll. Sector filtering. Role-based personalization.

### 5.6 Phase 5 — Saves & comments
Save/unsave with optimistic updates. Threaded comments with soft deletes.

### 5.7 Phase 6 — Search
PostgreSQL full-text search using websearch_to_tsquery with GIN index.

### 5.8 Phase 7 — Email infrastructure
SendGrid wrapper. BullMQ queue. node-cron scheduler. HMAC-signed unsubscribe tokens. Welcome email template. Weekly digest template (deprecated in 12i — replaced by daily digest).

### 5.9 Phase 8 — Deployment hardening + production launch
Backend Dockerfile. Rate-limit middleware. CORS hardening. Sentry SDK. GitHub Actions CI. Production deploy: Vercel (frontend), Railway (backend + Postgres + Redis).

### 5.10 Phase 9 — Teams / Enterprise
Teams infrastructure, team-scoped backend + frontend, invite management, join page + dashboard.

### 5.11 Phase 10 — Learning paths (KILLED)
Killed before any code shipped. Inline learning resurrected as V2. Full course platform was V3 but is now pivoted to a separate project entirely.

### 5.12 Phase 11 — API v2
API key infrastructure (HMAC-SHA256, sgnl_live_ prefix, 10-key cap), Redis-backed rate limiting, /api/v2/stories cursor pagination, trends + summary endpoints.

---

## 6. V1 Engineering Detail (Phase 12 series)

### 6.1 Phase 12a ✅ — Canonical depth-variant commentary
Replaced legacy sector-variant commentary with depth-variant shape (accessible/briefed/technical). Haiku model pinned to claude-haiku-4-5-20251001.

### 6.2 Phase 12b ✅ — Profile questionnaire
Onboarding screens extended: role, seniority, depth preference capture.

### 6.3 Phase 12c ✅ — Per-user Haiku personalization
getOrGenerateCommentary service. Cache-first with 8-concurrency polling cap. Tiered fallback template.

### 6.4 Phase 12d ✅ — Depth as profile preference + expand/collapse
Depth is a profile-level preference. Per-story interaction is expand/collapse — thesis by default, "Go deeper" reveals additive support. Option C structured output {thesis, support} JSONB.

### 6.5 Cluster 1 ✅ — Smoke + cleanup
1.1 Drizzle journal reconciliation. 1.2 Story detail UX cleanup. 1.3 12c smoke-test issues. 1.4 Commentary a11y verification.

### 6.6 Discovery Session 2 ✅ — "What is Accessible depth for?"
PR #41: depth tier rename (beginner → accessible, standard → briefed). Default changed to accessible.

### 6.7 Workspace cleanup ✅
PR #42 (worktree residue), PR #45 (OneDrive flatten). C:\Users\elkha\ remains a botched git repo — never run destructive git commands there.

### 6.8 Phase 12e ✅ — Ingestion & event model (Complete)

**Goal:** Replace manual story seeding with continuous ingestion from curated sources, writing into an event-centric data model.

#### Architecture summary

1. 59+ active sources, five adapter types: RSS/Atom, arXiv Atom API, SEC EDGAR JSON, Hacker News API, Reddit API (deferred, #83).
2. Per-adapter cadence: RSS hourly, SEC EDGAR every 15 min business hours / hourly off-hours, arXiv daily 21:00 UTC, HN every 4 hours.
3. Filter chain: heuristic filter → LLM relevance gate (1 Haiku call/candidate).
4. Enrichment: 5 Haiku calls per surviving candidate (relevance + fact extraction + 3 tier generations).
5. Cross-source dedup: OpenAI text-embedding-3-small cosine similarity (0.85 threshold, env-configurable). Match → attachEventSource. No match → writeEvent. Re-enrichment on every attach, rate-limited 1/hour/event via Redis TTL.
6. Source priority: tier 1 (lab blogs, SEC EDGAR, regulators) > tier 2 (analyst newsletters) > tier 3 (news, DEFAULT) > tier 4 (community).
7. Dual-read: feed/detail/v2 endpoints read from stories ∪ events during 12e. stories table union leg removed from getFeed June 1 (events-only). searchStories/getRelatedStories still query stories table — flagged for rewrite.
8. saves + comments: nullable story_id/event_id with CHECK exactly-one constraint (migration 0023).
9. commentary_cache: story_id FK dropped (migration 0024) — column carries either story or event id.

#### Sub-phases shipped
- **12e.1–12e.8 ✅** — Full pipeline from schema to admin status route.
- **12e.x ✅** (PR #93) — Fix cluster: DOMPurify, video/paywall skip expansion, enrichment recovery job (migration 0032), Jest moduleNameMapper fix, fix-broken-sources script.
- **12e.y ✅** (May 30) — Ingestion maintenance: enabled-guard in sourcePollJob; commentary two-system architecture confirmed; 10 dead sources confirmed disabled.
- **12e.z ✅** (June 1) — enrichmentJob.test.ts: 6 pre-existing failures fixed. Root cause: `process.env.OPENAI_API_KEY = ""` missing from `tests/setup.ts`; embedding stage was env-fragile, ambient shell key defeated opt-out.

### 6.9 Phase 12f ✅ — Feed Ranking Algorithm
PR #85. Rules-based v1. effective_score composed from sector match, freshness, source quality, corroboration count, diversity penalty, already-seen penalty, **save signal (added 12o.1)**. Editorial sources rank above noise. **Feed pagination slice bug fixed June 1** (`ranked.slice(0, limit)` → `ranked.slice(offset, offset + limit)` + edge guard).

### 6.10 Phase 12g ✅ — Paywall Gating
PR #90. Two-tier model (Free / Pro). 7-day trial. Story cap, depth gate, search cap, soft-block UX, generic_commentary pre-generation, `/upgrade` placeholder.

### 6.11 Phase 12h ✅ — Payment Integration (Stripe)
Shipped 2026-06-16. Migration 0061 (`stripe_customer_id`, `stripe_subscription_id` on users). Stripe Checkout (monthly/annual, 7-day trial for first-time subscribers), webhook handler (`checkout.session.completed` → tier flip to pro; `customer.subscription.deleted/updated` → downgrade), billing portal. `/billing/success` and `/billing/cancel` pages. "Manage billing" section in Settings for pro users.

Env vars to set in Railway: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
Env vars to set in Vercel: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
After deploy: register webhook at `POST /api/v1/billing/webhook` in Stripe Dashboard, copy signing secret → `STRIPE_WEBHOOK_SECRET`.

### 6.12 Phase 12i ✅ — Daily Digest Email
PR #91. Daily Pro-only digest. Migration 0031. `compileDailyDigest` (24h window, top-10 via effective_score, sector-grouped). React Email template. Unsubscribe via `email_frequency='never'`. Weekly digest deleted.

### 6.13 Phase 12j/k/l ✅ — Design System + Visual Language + Surface Polish
PR #92. Newsreader + IBM Plex Sans + JetBrains Mono. Warm editorial aesthetic. Sector accents: AI indigo (#5B4FD9), Finance emerald (#0C7259), Semis burnt orange (#A04D17). All surfaces restyled. Superseded on feed by PR #98 editorial redesign; coexists on other surfaces.

> **ADDED June 6:** The feed surface has since been superseded again by the Swiss Command Center (#142) and Editorial Redesign v2 (#144) — see §6.19. The 12j/k/l design system still governs non-feed surfaces (settings, onboarding, teams, auth).

### 6.14 Phase 12m ✅ — Source Expansion & Filter Tuning (Shipped May 30 + June 1, 2026)

- **12m.1 ✅** — Source registry expansion in three rounds (migrations 0034, 0035, 0041). 27 → 65 configured sources. Added (May 30): One Useful Thing, Lilian Weng, Big Technology, Daily Upside, Calculated Risk, FT Alphaville, Doomberg, Citrini Research, Morning Brew (later disabled q5), EDN, DIGITIMES, SemiWiki, money-stuff (Matt Levine, recovered), intel-newsroom (re-homed). Added (June 1): Next Platform, Chips and Cheese, Tom's Hardware, Hackaday, Econbrowser, Alpha Architect.
- **12m.2 ✅** — LLM relevance filter tuning. Finance prompt updated (markets/investing lens across ANY industry). Transient faults park at `heuristic_passed` for recovery. `TRANSIENT_RELEVANCE_REASONS` single source of truth.
- **12m.3 ⏳** — Reddit adapter activation (#83). Blocked on OAuth credentials.

> **ADDED June 6:** 12m.3 (Reddit activation) is now absorbed into Real-Time Layer Phase A (§6.20). The adapter exists and is import-linked but the registry returns `null`; activation = flip `reddit_api: redditAdapter` + seed subreddits. Economics changed — commercial Reddit access now requires a contract (§19).

### 6.15 Phase 12n ✅ — Signal-Native Posts (Shipped May 30 + Expanded June 1, 2026)

**Goal:** SIGNAL generates its own editorial content from legally observable signals.

**Architecture:** Fork B — separate `processNativeEnrichment` orchestrator (facts → tiers → writeEvent; skips relevance/cluster by construction). Native posts carry `source_type='native'` on the events table. Same three depth tiers as ingested stories. Tier 2 source priority. Global cap via `dailyCap.ts` (DB count, fail-open).

**Content structure (Treatment 2, June 1 rewrite):** HOOK → SPECIFICS → STAKES → SOURCE → mandatory ACT/WATCH close. Say one thing per post. The ACT/WATCH close is required — a post without a concrete action or watch instruction is incomplete. Decline when no genuine mechanism or when the connection is correlational, not causal.

**Sub-phases:**

- **12n.1 ✅** — Generator framework + HN rejected-pool repo discovery. Migrations 0036/0037. `nativeEnrichmentJob.ts` (Fork B orchestrator). `generators/` framework with `NativeGenerator` interface + registry. HN discovery: queries `llm_rejected`/`heuristic_filtered` HN candidates with github.com URLs → GitHub API enrichment → multi-signal qualification gate → authoring. Key gate: issues-to-stars ratio (catches ECC-style fraud: 198K stars / 38 issues rejected). Verbose dry-run diagnostics.
- **12n.2 ✅** — arXiv synthesis + HN community synthesis generators. Migration 0038. `isoWeek.ts` shared helpers. arXiv: published arXiv events last 7d, min 2 papers/sector, synthesis of research direction (not per-paper summaries). HN synthesis: published non-repo HN events last 7d, high-score threshold, practitioner discussion synthesis. Both use ISO-week external_id for dedup.
- **12n.3 ✅** — Earnings/filing reaction + supply-chain synthesis generators. Migration 0039. Migration 0040 (applied directly to prod): sec-edgar-finance (16 CIKs) + sec-edgar-semis re-enabled. Earnings: SEC EDGAR events last 48h, "one number that mattered" format. Supply-chain: Semis events with ≥2 corroborating sources, "real constraint isn't X — it's Y" format.
- **12n.4 ✅** — Global daily cap (original). `dailyCap.ts`: `NATIVE_DAILY_CAP=10`, `checkDailyCap` (DB count of today's `events WHERE source_type='native'`), `applyDailyCap`. Fail-open on DB errors. Composes across separate invocations via live DB count.
- **12n.5 ✅ (June 1)** — Cross-sector chain + tool spotlight generators + Treatment 2 prompt rewrites + cap raised to 25.
  - **Cross-sector chain** (`cross-sector-chain-native`): Discovers ≥7-quality ingested events in the last 48h, joins `events → event_sources(primary) → ingestion_sources` for quality, groups by sector, picks strongest qualifying pair, authors ONE causal-chain post/run. Daily dedup key `cross-sector-chain:{a}-{b}:{YYYY-MM-DD}` (sectors alphabetical). Model declines when no genuine causal mechanism (correlation-not-causation = decline). Tagged to A-sector. The platform's highest-differentiation output — no single-sector RSS feed produces cross-sector causal chains.
  - **Tool spotlight** (`tool-spotlight-native`): Reads HN github pool (any status, 72h), collapses to unique repos, no GitHub API call. Excludes repos already covered by any event, below `MIN_HN_SCORE=50`, or already posted. Authors ONE "why now" adoption post/run. Repo-keyed dedup `tool-spotlight:{owner/repo}` (no date). Sector: `ai`. Quality gate: "only write if you can make a genuine 'why now' case — not just 'it got upvotes.'"
  - **Treatment 2 prompt rewrites**: arXiv synthesis and HN community synthesis prompts rewritten. Added 5th beat (ACT/WATCH mandatory close), reframed from "what happened in research" to "what it means for your stack/career today," added cross-sector consequence note to STAKES beat. Header comments updated.
  - **NATIVE_DAILY_CAP**: 10 → 25. `dailyCap.test.ts` updated (3 assertion changes).
  - Migration 0042: seeds `cross-sector-chain-native` and `tool-spotlight-native` source rows (guarded by NOT EXISTS, idempotent).
  - **Test result**: 84 suites / 1254 passed / 1 skipped / 0 failed (+2 suites, +27 new tests).
- **12n.6 ✅ (June 1 small fixes)** — Lead story image preference + asterisk ban in all four native post prompts.
  - Lead story: `nonGated.slice(0, 5).find(s => s.image_url) ?? nonGated[0]` — scans top 5 ranked stories, picks first with image_url, falls back to rank-1. Rail updated to filter-by-id (not slice-from-1) to prevent lead duplication when lead is not at index 0.
  - Asterisk ban: added "No asterisk emphasis. Do not use *word* or **word** formatting. Plain text only — no Markdown of any kind." to the quality-bar section of all four prompt files (`arxivSynthesisPrompt.ts`, `hnSynthesisPrompt.ts`, `crossSectorChainPrompt.ts`, `toolSpotlightPrompt.ts`).
  - Important correction: CC caught `imageUrl` (camelCase) in the original spec was wrong — actual field is `image_url` (snake_case). Also caught that slice-from-1 assumption would have duplicated lead into rail. Both fixed without prompting.
- **12n.7 ⏳ (in progress)** — Commentary hook improvement + sector mismatch fix + CLAUDE.md lockfile doc. See CC session prompt in active handoff.

> **ADDED June 6:** The branded-card mapping from `generator_type` is now canonicalized in the frontend redesign at `lib/feedCardType.ts` (`deriveCardType`), superseding ad-hoc label logic: cross-sector-chain-native → THE CONNECTION; arxiv-synthesis-native → THE RESEARCH READ; hn-synthesis-native → PRACTITIONER BRIEF; tool-spotlight-native → WORTH AN AFTERNOON; earnings-reaction-native → EARNINGS / SEC; unmapped native → SIGNAL ORIGINAL. The 12n.7 commentary-hook direction is now realized via the lead-with-explanation redesign (§6.19); confirm the System B prompt rewrite + HN sector-mismatch gate + lockfile doc all landed.

### 6.16 Phase 12o ⏳ — Engagement Signals & Ranking v2

- **12o.1 ✅** (May 30) — Saves wired into `effective_score`. `W3 = 1.5`, `W3·ln(1+save_count)` additive term. Reuses existing `eventSaveCountExpr()` correlated subquery (no N+1). Lockstep implementations in `calculateEffectiveScore.ts` (TS) and `eventEffectiveScoreExpr()` (SQL).
- **12o.2 ⏳** — Scroll/dwell time analytics. Post-beta.
- **12o.3 ⏳** — Click-through tracking. Post-beta.
- **12o.4 ⏳** — Share feature. Post-beta.
- **12o.5 ⏳** — Ranking v2 with all engagement signals. Post-beta.

### 6.17 Phase 12p ⏳ — Commentary Quality & Feed Editorial Voice (Planned)

**Goal:** Elevate commentary from analytical summaries to editorial hooks. Apply across all ingested events (not just native posts). Make SIGNAL read like a publication, not a feed reader.

**Problem:** Current accessible tier commentary opens analytically ("HBM supply is the constraint throttling your AI model training pipelines right now..."). It does not hook the reader. The first sentence gives a neutral summary rather than a specific, surprising, or tension-creating observation.

**Commentary hook improvement (12n.7, in progress):**
- Accessible tier: Open with a hook — one specific, surprising, or tension-creating observation. First sentence gives the reader something they didn't already know, stated as consequence for their work or portfolio. Banned openers: "This article," "X company announced," "[Source] reports," any restatement of the headline. Write in second person where natural ("your pipeline," "your portfolio"). Thesis must give one concrete, actionable thing: a number to watch, an assumption to question, a risk to price, a tool to try. Not a neutral summary — a stance.
- Briefed tier: Same hook principle, adds one layer of mechanism ("because X is happening in Y").
- Technical tier: Same hook principle, specific to technical practitioners (model architects, chip designers, quant researchers).
- Apply to `commentaryPromptV2.ts` — affects all System B commentary generation going forward.

**Sector mismatch fix (12n.7, in progress):**
- HN repo discovery author prompt: add hard quality gate — only write if tool is directly relevant to AI/ML practitioners, ML engineers, AI researchers, or infrastructure engineers building AI systems. Decline general sysadmin utilities, file sync tools, DNS tools, security/crypto libraries with no AI connection. (Observed issue: openrsync BSD rsync clone was authored and tagged `sector: ai` — file sync tool has no AI relevance.)

**Feed card redesign direction (12j/k/l frontend pass — not yet scoped):**
- Omar's proposal: in the feed card, show SIGNAL commentary hook sentence as the PRIMARY text (SIGNAL voice leads), source headline as secondary attribution below. Makes SIGNAL the entry point, source as validation. Turns every card into a mini editorial stance with a citation. Requires commentary hooks to be strong enough to stand as headlines — directly dependent on 12p commentary prompt work.
- Implementation: new card layout variant with commentary hook as hero text, "— via [Source]" attribution line below. Existing card kept as fallback when commentary is thin.

**Native post detail view redesign (12j/k/l, not yet scoped):**
- Current state: the synthesis body (200-word editorial paragraph Haiku writes for native posts) is not prominently displayed in the detail view. The "FROM THE SOURCE" section shows source metadata but the synthesis text itself is buried or absent. Renders native post detail pages thin/stale.
- Fix: synthesis body should be the hero of the native post detail — displayed prominently above the depth-tier commentary, not in the source metadata section.

> **ADDED June 6 — status update (additive):** The **"feed card redesign direction — commentary-as-primary text" shipped** in Editorial Redesign v2 (§6.19): `splitHook` + `storyTitleAndBrief` lead the card with `generic_commentary`; the source headline renders as "via [Source]" attribution. The **commentary-hook prompt work (System B `commentaryPromptV2.ts`)** is still worth confirming landed for *all* ingested events; the redesign surfaces whatever quality the prompt produces. The **native post detail view (synthesis-as-hero)** remains open — confirm in the right-panel detail reader.

### 6.18 Phase 12q ⏳ — Editorial Identity Improvements (Planned — Soon Before Beta)

**Goal:** Visual and editorial differentiation improvements identified from June 1 competitive audit.

- **Custom illustrations for native posts:** Generate editorial illustrations via image API (Higgsfield MCP is active in chat; backend integration needed). Four style profiles: cross-sector chain → abstract financial/chip composite; arXiv synthesis → scientific abstraction; HN synthesis → practitioner/crowd aesthetic; tool spotlight → mechanical/tooling. Store in `og_image_url` column (already exists on events). Generate on native post insert with fallback to no image if generation fails. Cost: ~$0.04/image × 25/day cap = <$30/month. **Note:** Image generation via Higgsfield is preferable for native posts (chat-connected); for any automated backend pipeline, OpenAI image API (already integrated) is preferred. Label AI-generated images as such in the UI. Never attach AI imagery to real sourced news stories.
- **Branded section labels:** Replace "VIA SIGNAL" with per-generator brand names in the feed card and detail view. Cross-sector chain → "THE CONNECTION"; arXiv synthesis → "THE RESEARCH READ"; HN synthesis → "PRACTITIONER BRIEF"; tool spotlight → "WORTH AN AFTERNOON". One DB column change + frontend label swap. Builds reader habit (WSJ "The Outlook" pattern).
- **Comment counts in feed cards:** Surface comment count badges on every story card in the feed view. Already counted in DB; trivial frontend addition. Social proof signal (WSJ pattern: "988 comments").
- **searchStories / getRelatedStories rewrite:** Currently returns only 20 legacy stories from the `stories` table, ignores all 1,263+ events. Must be rewritten to query the `events` table with the same ranking logic as getFeed. Blocks search relevance and related-story surfacing.
- **SIGNAL native post archive page:** Clean `/archive` route with DATE | TYPE | HEADLINE table of all native posts sorted by published_at DESC. Helps returning readers browse editorial backlog. (Anthropic Newsroom pattern.)

> **ADDED June 6 — status update (additive):**
> - **Branded section labels: ✅ SHIPPED** — done via `feedCardType.ts` brand cards in the redesign (THE CONNECTION / THE RESEARCH READ / PRACTITIONER BRIEF / WORTH AN AFTERNOON / EARNINGS·SEC). The "DB column change" turned out unnecessary on the read path — derived from `generator_type` + `content_type` at render.
> - **Custom illustrations: 🟡 groundwork shipped** — `illustration_url` column exists (migration 0044, supersedes the planned `og_image_url`); ConnectionHero/FeatureExhibit render it with a chain-motif fallback. Automated backend generation still to wire.
> - **Comment counts: 🟡 partial** — practitioner-brief cards surface a "N discussed" count; the general comment-count badge on every card is still open.
> - **searchStories / getRelatedStories rewrite: ⏳ still open** — flagged, unchanged.
> - **Native post archive page: ✅** — `/archive` exists (native archive endpoint + `NativeArchiveItem`); the redesign enriched that endpoint with `generic_commentary` + `image_url`.

### 6.19 Phase 12r ✅ — Editorial Redesign v2 (Shipped + Deployed June 6) — ADDED

**Goal:** Stop rendering every item as the same text row. Lead with the personalized explanation; make format follow content type; surface the moat instead of burying it. Shipped as PR #144 (9 commits) on top of the Swiss Command Center feed (#142) and native engine revival (#143). Live on prod, verified on the real feed. Backend 1286 / Frontend 158 tests green.

**Context — the design arc that led here:** the feed went through several parallel design explorations (Design A "magazine"/MagazineFeed, Design B "Terminal", Swiss+Vintage fusion). The Swiss Command Center (Fusion A, #142) became the primary feed. An 8-advisor board review of the live Swiss feed against the original moat found the engine intact but the surface flattened — every content type rendered as the same row, and THE CONNECTION (the flagship differentiator) was buried mid-stream. Redesign v2 is the presentation-layer fix.

**Frontend (`components/redesign/swiss/*`, `lib/*`, `hooks/*`):**
- `lib/feedCardType.ts` — pure `deriveCardType(story)` → discriminated content type + branded label + `isHero`. Maps `kind` / `generator_type` / `content_type` / `sources.length`. Unit-tested.
- `ConnectionHero.tsx` — the cross-sector chain as a full-width illustrated hero (real `illustration_url`/`image_url`, else an A→B→C chain-motif fallback — the causal-chain idea visualised, not a placeholder).
- `StoryExhibit.tsx` — type-aware rows: branded TypeLabel, og:image thumbnail (falls back to `illustration_url`, then a per-type icon tile), multi-source "covered by …" source-wall, practitioner discussion count, EARNINGS `leadStat` "the number that mattered" block, freshness NEW badge, the locked Pro teaser. `FeatureExhibit` = image-led second-peak card so the scroll crests twice instead of flat-lining.
- `LockedTeaser.tsx` — blurred slice of the real `why_it_matters_to_you` with "Your read as a \<role\> · Pro". **Tier-gated** via `useTier` (renders for free tier only; Pro/pro_trial get the real read).
- `lib/feedFreshness.ts` — `isRecent` / `isAfter` / `freshBoundaryMs`; `lib/leadStat.ts` — pull the lead $/% figure from commentary text (honest, never fabricated; null → terse fallback).
- `hooks/useLastVisit.ts` — **the return-tomorrow loop**: localStorage, session-stable previous-visit boundary captured once per page load (module singleton, no read/write race between the stream and the originals band), 30-min advance gate so a refresh doesn't reset the boundary. Drives "N new since last visit".
- `RankedStream.tsx` — hoists the top Connection into the hero, promotes a mid-stream FeatureExhibit, renders the "N new [since last visit]" cue, threads role + teaser-gate + freshness boundary.
- `SignalOriginals.tsx` — rebuilt on the card system via a `nativeToStory` adapter: flagship THE CONNECTION as illustrated hero on real data, other originals as distinct type cards leading with the explanation. Selecting opens the full read.

**Backend:**
- Migration `0045` (12u) — `events.content_type` (`null | filing | general`) + CHECK + index + idempotent EDGAR backfill.
- `writeEvent.ts` — classify `sec_edgar_json` source → `content_type='filing'` at write time (mirrors the native/ingested split).
- `storyController.ts` — surface `content_type` on the wire (feed + detail + shapeStory null); enrich the **native archive endpoint** (`GET /api/v1/stories/native`) with `generic_commentary` + `image_url` so the Originals band can lead with the explanation and render the flagship as an illustrated hero (not a bare 2-line row).

**Card types live:** THE CONNECTION (hero), THE RESEARCH READ, PRACTITIONER BRIEF, WORTH AN AFTERNOON, EARNINGS / SEC, MULTI-SOURCE, DISPATCH, SIGNAL ORIGINAL.

**Persistence/UX:** persistent right-side detail reader (scan left / read right) retained from the Swiss feed; depth toggle (Accessible/Briefed/Technical) retained; "Simulate personalized roles" affordance retained as the moat demo.

**Known follow-ups (not blockers):** Earnings card only appears when a SEC EDGAR `filing` is ranked into the feed window (data-dependent); `/redesign-preview` dev route should be gated/removed before public launch; the ranked stream is DISPATCH-heavy on real data until the Real-Time Layer (§6.20) diversifies sources; native-post detail synthesis-as-hero still open (carried from 12p/q).

### 6.20 Phase 12R ⏳ — Real-Time Signal Layer (Planned — its own phase) — ADDED

**Goal:** Close the moat gap from the June 6 audit — add the *fast / social / launch* sources so the morning briefing spans every signal a practitioner checks, with the per-reader "why it matters to you" on each. **Full spec: `docs/REALTIME_SIGNAL_LAYER.md`. Cost analysis: §19.**

**The gap (moat audit, June 6):** SIGNAL covers the *structured/slow* web (research, news, community threads, filings). It does NOT cover the *fast/social/launch* layer the practitioner lives in — X takes ("Elon just said this"), new GitHub repos, tool/startup launches, real-time community sentiment. The ingestion adapter enum has `rss`, `arxiv_atom`, `sec_edgar_json`, `hackernews_api`, `reddit_api`, `native_generator` — **no X, IG/TikTok, or LinkedIn adapter.** That maps exactly to the missing source families.

**Architecture fit (verified):** a new source = one pure `AdapterFn` (`(ctx: AdapterContext) => Promise<{candidates: Candidate[]}>`, DB-free) + a seed `ingestion_sources` row + (optionally) a `content_type` set in `writeEvent` and a card treatment. The whole enrichment → personalized-explanation → ranking → cross-source-clustering pipeline is reused. New fetch mechanisms add an `ingestionAdapterTypeEnum` value (schema + migration, split add-value/use-value across two files per the enum rule); RSS-shaped sources reuse the `rss` adapter (no new adapter code).

**Sub-phases:**
- **12R.A 🟢 (mostly free) — Breadth (the cheap, high-value win).**
  - **GitHub:** verify/activate `github-trending-native` (deep-research item — confirm it's producing in prod); broaden the topic list per sector. Optional direct `github_api` adapter for raw repo items, but the *native spotlight* route (SIGNAL explains the repo) is the better UX. Card: WORTH AN AFTERNOON. Cost: free.
  - **Product Hunt:** seed `producthunt.com/feed` as an `rss` source — **zero new adapter code**. Card: NEW **THE LAUNCH** (`content_type='launch'`). Cost: free.
  - **Reddit:** flip `reddit_api: redditAdapter` in `adapters/index.ts` + seed subreddits per sector. Adapter already written. Card: PRACTITIONER BRIEF (community variant). **Cost caveat:** Reddit commercial API access now requires a contract (~$12k/yr) under the Nov 2025 policy; the free tier is non-commercial only. So "free" holds only on the non-commercial free tier during private beta. See §19.
- **12R.B 🔴 (paid) — The real-time social layer.**
  - **X / Twitter:** curated allowlist (~100–150 vetted accounts/sector — the allowlist IS the quality gate, and the moat applied to real-time: "we tell you why a specific take matters to YOU"). New `x_api` adapter; allowlist in `ingestion_sources.config`; steep `fetch_interval` (15–30 min). **Source: X pay-per-use at $0.005/read** (new developers can no longer get the $100/mo Basic tier) — realistically ~$300–600/mo at modest polling, hard cap 2M reads/mo before Enterprise. Bright Data scraping is the cheaper-but-ToS-gray alternative (avoid for a real business). Card: NEW **THE TAKE** (`content_type='take'`). Needs format-aware personalization (short-form, no article body) + steep freshness decay in ranking.
- **12R.C 🟡 — Funding/startup depth.**
  - Funding RSS (TechCrunch, Axios Pro Rata, sector newsletters) → reuse `rss`; HN "Show HN" filter on the existing HN adapter; Crunchbase API later ($99/mo Pro — free tier eliminated 2025). Card: THE LAUNCH.

**Cross-cutting work:** (1) new card types THE TAKE + THE LAUNCH in `deriveCardType` + `StoryExhibit`; (2) a `content_format` (long | short | tool) threaded adapter → facts → Haiku prompt so a tweet isn't explained like a 40-page paper; (3) per-content-type **freshness curves** + per-type diversity cap in `effective_score`/`diversityCap` so the briefing is a *mix* (a take, a repo, a paper, a launch, news) not 10 takes; (4) the **`what_to_do_with_it`** hook variant for repos/tools/skills (Omar's direction — "what you can apply this toward").

**Out of scope:** Instagram / TikTok (low signal-to-noise for this audience, no clean ingestion path; the practitioner's real-time layer is X + GitHub + Reddit + launches, not short-form video). LinkedIn parked (no clean ingestion path; ToS risk).

**Open decisions (need Omar):** X access — pay-per-use (~$300–600/mo, clean) vs Bright Data (ToS-gray) vs defer; **curated X-account + subreddit allowlists** (CC will *draft* starter lists per sector — e.g. AI: @karpathy, @ylecun, r/LocalLLaMA, r/MachineLearning — for Omar's edit/approval); GitHub-trending prod status (deep research); budget ceiling; ship the `what_to_do_with_it` hook (Omar: yes).

**Deep-research pass (gating, before building — §17):** (1) confirm `github-trending-native`/`tool-spotlight-native` are producing in prod; (2) verify current Reddit API terms + free-tier limits for the planned subreddit read volume (commercial-contract trigger); (3) verify current X API pay-per-use mechanics + ToS for the curated-allowlist approach; document Bright Data trade-offs. *(Pricing already gathered June 6 — §19; the remaining research is prod-status verification + ToS confirmation.)*

**Cost summary:** Phase A ~$0 (Reddit non-commercial during beta) · Phase B ~$300–600/mo (X pay-per-use) · Phase C $99/mo (Crunchbase) + funding RSS free. Full model in §19.

---

## 7. Competitive & Editorial Research (June 1, 2026)

### 7.1 Content Strategy Gap Analysis

Research conducted June 1, 2026. Full audit of competitive landscape and content gap map across AI, Finance, and Semiconductor professional media.

**Competitive landscape:**
- **Bloomberg Terminal** ($31,980/yr): Only cross-sector professional intelligence at depth. Pricing kills the TAM; the professionals SIGNAL targets can't expense it.
- **Free options** (Morning Brew, HN, TechCrunch): Zero depth, zero personalization, zero synthesis. No cross-sector framing.
- **SemiAnalysis** (~$3,000/yr): Deep semiconductor analysis. No AI/Finance cross. Targets institutional buyers.
- **The Diff** (Byrne Hobart): Finance/tech synthesis. Strong voice. RSS frozen Nov 2022; removed from SIGNAL sources.
- **Pricing sweet spot identified:** $200–500/yr — above free-shallow, well below Bloomberg/SemiAnalysis. SIGNAL's current $10/month ($120/yr) sits inside this range.

**SIGNAL's defensible moat:**
Behavioral data (what readers actually engage with), editorial consistency (voice + depth tiers), source relationships. Distribution is the unsolved problem. Engineering sophistication is not the moat.

**The 10 content gaps no existing publication fills:**

1. **Inference economics synthesis** — cost-per-token trends across providers, what they mean for builder budgets. Nobody does this regularly.
2. **CoWoS/HBM packaging bottleneck tracking** — supply chain toll-booth maps showing where AI infra actually gets constrained. The physical bottleneck is specific and underreported.
3. **Cross-sector causal chains** — how a Fed hold reshapes semis capex which reshapes AI infra cost which reshapes what a builder pays. No single-sector feed produces this. SIGNAL's cross-sector chain generator directly addresses this gap.
4. **Macro-to-portfolio translation** — what rate decisions, inflation signals, and geopolitical events mean for AI/semis investors specifically. Bloomberg does this for everything; nobody does it for this audience.
5. **"What moved in research this week" synthesis** — arXiv synthesis that tells practitioners what the SET of papers means together, not a list of summaries. SIGNAL's arXiv synthesis generator addresses this.
6. **Open vs. closed model reality check** — periodic reality-testing of the open/closed capability gap for specific use cases, not speculation.
7. **Supply-chain toll-booth maps** — narrative maps of where a chip or model's production chain actually bottlenecks. Deeply valued by practitioners and investors alike.
8. **Private markets tradeoffs** — which AI companies are taking strategic money (NVIDIA, Google, Microsoft) vs. staying independent, and what that means for technology direction.
9. **Tool/repo spotlights with adoption rationale** — "should I spend an afternoon on this tool this week, and why NOW?" Not vetting verdicts. SIGNAL's tool spotlight generator addresses this.
10. **Career-relevant framings** — how this week's AI/semis/finance signal changes what skills matter, what roles are safe, what to learn. Underserved by all professional publications.

> **ADDED June 6:** The moat-coverage audit reframes this gap analysis. SIGNAL strongly covers the *explanation* and *native-editorial* gaps (especially #3 cross-sector chains, #5 research synthesis, #9 tool spotlights). The open frontier is the *real-time/social* source layer — real-time takes, launches, live community sentiment — which the Real-Time Layer (§6.20) targets. The 10 content gaps remain accurate; the new lens is "we have the synthesis gaps; we're missing the speed/breadth of input."

### 7.2 Competitive Editorial Audit (Bloomberg, WSJ, CNBC, Anthropic)

Audit conducted June 1, 2026. Four major news publications reviewed for design patterns, editorial voice, and hook mechanics worth implementing in SIGNAL.

**Bloomberg:**
- Multi-layer information density: video hero with embedded market tickers under the headline
- Right rail "Latest" with minute-level timestamps — creates freshness urgency
- "In Focus" topic chips (War With Iran, Trump's Second Term) — persistent ongoing-story anchoring
- Data dashboards: "Tracking Key Market Moves on Iran War" with directional indicators (-101 ships, ▲27% Brent, etc.)
- Commissioned editorial illustrations for opinion/analysis (Warren Buffett portrait with handwritten-letter background — Chris W. Kim)
- "Live" red dot indicator + "Latest Updates" timeline for developing stories
- Mix of photojournalism (events) + illustration (opinion/analysis)
- Quote-led headline pattern: "Jensen Huang Says 'Nonsense' That AI Hurting Jobs" — name + quote + tension
- Bloomberg Opinion with circular author photos next to bylines

**WSJ:**
- Painted/watercolor portrait illustrations as heroes for opinion/analysis pieces (Bill Gates portrait)
- WSJ headline formula: "[Person/entity] Spent Years [doing X]. Now [dramatic reversal]." — narrative arc in headline, not just event summary
- Comment counts as social proof on every card (988, 200, 67)
- Branded recurring features: "The Outlook," "Free Expression," "The Big Take" — builds reader habit
- One-sentence dek lines below headlines that pull the reader deeper
- Illustrated columnist headshots for opinion section
- "Most Popular News" rail with thumbnails — social validation signal

**CNBC:**
- Dark photo + gradient overlay hero with text on top — high visual impact
- Utility widgets (Quote Finder, Market Movers with US/EUR/ASIA tabs + Top/Bottom sortable lists)
- Colored bullet indicators in Latest rail
- More transactional/trader-oriented than editorial — wrong aesthetic for SIGNAL's audience

**Anthropic Newsroom:**
- Hand-drawn editorial illustrations as hero visuals (Glasswing hand graphic, geometric shapes, paper textures, asymmetric composition)
- DATE | CATEGORY | TITLE clean archive table — no clutter
- Category labels (Product, Announcements) — clear content taxonomy
- Minimal but high-identity — every illustration is recognizably Anthropic's aesthetic
- Served as reference for SIGNAL's planned archive page

**What NOT to steal from any of the above:**
- WSJ's banner ads — SIGNAL's differentiation is ad-free
- CNBC's market ticker chrome — wrong audience (not trading terminal)
- Bloomberg's newsletter rail clutter at top
- Subscription mat patterns

### 7.3 Editorial Design Roadmap (From Audit)

Priority-ranked list of design/editorial patterns to implement in SIGNAL, derived from the June 1 audit:

| Priority | Pattern | Source of inspiration | SIGNAL status |
|---|---|---|---|
| 1 | Custom editorial illustrations for native posts | Bloomberg/WSJ | Phase 12q, planned soon |
| 2 | Quote-led headlines in native post generators | Bloomberg | Phase 12n.7, in progress (prompt change) |
| 3 | Commentary hook improvement (all content) | Bloomberg/WSJ voice | Phase 12p, in progress |
| 4 | Branded recurring feature labels | WSJ "The Outlook" | Phase 12q, planned soon |
| 5 | Comment counts in feed cards | WSJ | Phase 12q, planned soon |
| 6 | searchStories / getRelatedStories rewrite | (internal fix, not audit-derived) | Phase 12q, planned soon |
| 7 | Native post archive page | Anthropic Newsroom | Phase 12q, planned soon |
| 8 | Feed card redesign — commentary-as-primary text | Bloomberg editorial voice | Phase 12j/k/l redesign |
| 9 | Native post detail view — synthesis body as hero | (internal fix) | Phase 12j/k/l redesign |
| 10 | Topic chips / "In Focus" anchors | Bloomberg | Phase 12j/k/l redesign |
| 11 | Editorial typography pass (dek lines, hero overlays) | Bloomberg/WSJ | Phase 12j/k/l redesign |
| 12 | Data dashboards (sector trackers) | Bloomberg data modules | Phase 13+, post-beta |

> **ADDED June 6 — status updates against this table (additive; original rows unchanged above):**
> | # | Pattern | June 6 status |
> |---|---|---|
> | 1 | Custom illustrations | 🟡 column (0044) + render shipped; auto-gen to wire |
> | 2 | Quote-led headlines | ⏳ prompt change (12n.7) — confirm landed |
> | 3 | Commentary hook (all content) | ✅ realized via lead-with-explanation redesign (§6.19) |
> | 4 | Branded feature labels | ✅ SHIPPED (feedCardType brand cards) |
> | 5 | Comment counts | 🟡 practitioner "discussed" shipped; general badge open |
> | 6 | searchStories/getRelatedStories | ⏳ still open |
> | 7 | Native post archive page | ✅ `/archive` |
> | 8 | Feed card — commentary-as-primary | ✅ SHIPPED (redesign v2) |
> | 9 | Native detail — synthesis-as-hero | 🟡 confirm in detail panel |
> | 10 | Topic chips / "In Focus" | ✅ SHIPPED June 14 (LLM extraction → in-focus endpoint → chips bar) |
> | 11 | Editorial typography pass | ✅ largely shipped (Swiss type system) |
> | 12 | Data dashboards | ⏳ Phase 13+, post-beta |

---

## 8. V2 Engineering Detail ⏳

- **Phase 13a** — Inline glossary (~2 sessions). Tier-aware term definitions inline in commentary.
- **Phase 13b** — Concepts in digest (~1 session). "Concepts to know" section in daily email.
- **Phase 13c** — SIGNAL rating v2 (~1–2 sessions). Cross-source corroboration + user feedback signals.

---

## 9. V3 — SCRAPPED / PIVOTED ⛔

The full course platform (course library, Premium tier at $15–20/month, Phase 14a/b/c) has been **pivoted to a standalone independent project** and is no longer part of this roadmap. The inline learning features (V2 glossary, concepts in digest) remain on this roadmap. The two-tier Free/Pro pricing model is permanent for SIGNAL.

---

## 10. V4 Engineering Detail ⏳

- **Phase 15a** — Posting infrastructure.
- **Phase 15b** — Profiles.
- **Phase 15c** — Rating extended to posts.
- **Phase 15d** — Admin moderation.

---

## 11. V5 Engineering Detail ⏳

- **Phase 16a** — Threaded comments.
- **Phase 16b** — Comment moderation.
- **Phase 16c** — Comment ranking + trusted-user moderation.

---

## 12. V6 Engineering Detail ⏳ (Optional)

Co-founder/collaboration discovery. Decision after V5 behavioral data. May never ship.

---

## 13. Parallel Tracks ⏳

- **Phase 18** — Team/Enterprise expansion (7–10 sessions).
- **Phase 19** — Data Layer (15–25 sessions over 6–12 calendar months).

---

## 14. Pre-Launch Operational Work (parallel, non-engineering)

| Item | Status |
|---|---|
| Domain purchase | Not done |
| SendGrid domain authentication (SPF/DKIM/DMARC) | Not done — emails hit spam without this |
| Legal entity formation (LLC) | In progress — no longer blocking Stripe (account activated without it) |
| Business bank account | Blocked on LLC |
| Stripe account | ✅ **Live** — charges_enabled, payouts_enabled, live-mode keys active in Railway (June 16) |
| ToS / privacy / refund policy | ✅ **Shipped June 16** — `/terms`, `/privacy`, `/refund` live; linked from `/upgrade` |
| Support email | Not done — users need a contact point |
| Cookie consent / GDPR | ✅ Shipped June 14 — consent banner + `hasAnalyticsConsent()` gate (analytics opt-in). Privacy-policy link still to add once that page exists. |
| Rollback plan | Not documented |
| Trademark search ("Valo") | Deferred |
| Reddit app registration | Form submitted, awaiting response (#83) |
| Run `backfill-generic-commentary` in prod | Pending |
| Remove `WEEKLY_DIGEST_CRON` from Railway env | Pending |
| First 10 beta users identified | Unknown status |
| Twitter content strategy audit (manual) | ✅ Completed May 30 — full audit doc produced, native post templates built on it |
| npm audit (security check) | ✅ Completed June 1 — drizzle-orm CVE patched, remaining safe vulns cleared |
| Lighthouse audit (performance) | ✅ Completed June 1 — Performance 86, A11y/Best Practices/SEO 100. SI=10.9s is architectural ceiling, deferred. |
| FT Alphaville soak monitoring | Ongoing — RSS passes body gate; watch for downstream paywall thinness |
| EDGAR soak monitoring | Ongoing — sources re-enabled May 30; first poll cycle should have run |
| Competitive editorial audit | ✅ Completed June 1 — Bloomberg/WSJ/CNBC/Anthropic audit, content gap analysis, design roadmap produced. See Section 7. |

> **ADDED June 6 — new operational rows:**
> | Item | Status |
> |---|---|
> | **Moat-coverage audit** | ✅ Completed June 6 — 8-advisor, ~7.5/10. Identified real-time/social source gap (§6.20). |
> | **Editorial Redesign v2 deploy** | ✅ Completed June 6 — PR #144 merged + deployed (Vercel + Railway, migration 0045), verified on prod feed. |
> | **Gate/remove `/redesign-preview` dev route** | Pending — public mock-data route ships in current build; gate before public launch. |
> | **X / Twitter API access decision** | Open — pay-per-use ($0.005/read, ~$300–600/mo) vs Bright Data vs defer. Blocks Real-Time Phase B (§6.20, §19). |
> | **Reddit commercial-access decision** | Open — Nov 2025 policy: commercial use requires contract (~$12k/yr); free tier non-commercial only. Affects Real-Time Phase A economics. |
> | **Curated X-account + subreddit allowlists** | Pending — CC to *draft* starter lists per sector for Omar's edit. |
> | **API cost instrumentation** | Proposed — log real per-day Anthropic/OpenAI spend for ground-truth unit economics (§19). |
> | **Run `backfill-generic-commentary` + remove `WEEKLY_DIGEST_CRON`** | Still pending (carried). |

---

## 15. Deferred / Dead / Parking Lot

### Dead
- Phase 10 (original spec) — inline learning resurrected as V2; full course platform pivoted to own project.
- Weekly digest (Phase 7) — replaced by daily digest in 12i.
- V3 Courses / Premium tier — pivoted to standalone project. See Section 9.
- the-diff source — RSS frozen since Nov 2022, confirmed dead. Removed from active sources June 1.
- 663-consecutive-failure source batch — Anthropic News, AMD, TSMC, Meta AI, Hugging Face, Reuters, ASML, BIS, The Batch. All confirmed no working RSS endpoints June 1.

### Deferred
- Phase 11e (developer dashboard frontend) — post-Phase-19e.
- Phase 11f (public API docs) — same.
- Reddit adapter (#83) — blocked on OAuth credentials. Activate in 12m.3 once received.
- Settings page full design restyle — post-launch.
- Copy fixes ("role-neutral roundup" in onboarding Screen 7, /upgrade footer text) — minor, batch later.
- FRED API, Bluesky firehose, OpenReview/Semantic Scholar, crypto sources, WSJ/FT/Economist/The Information (paywalls) — future source expansion candidates.
- Twitter/X API (paid) — potential future source for social signal. Evaluate post-beta.
- LinkedIn/Instagram scraping — ToS risk, not pursued.
- Timezone-aware digest send times — future enhancement.
- Email-exclusive digest content / bonus picks — future enhancement.
- Configurable digest frequency — future enhancement.
- Stale `repeat:poll:<slug>` BullMQ repeatables for disabled sources — cosmetic noise, low priority cleanup.
- CLAUDE_CODE_OAUTH_TOKEN rotation — deferred (exposed to scrollback during OneDrive audit, May 2026).
- **AI-generated images for native posts (backend pipeline):** Deferred to post-beta for backend automation. `og_image_url` column exists; frontend renders it. For manual/chat generation: Higgsfield MCP (connected in chat) is the active evaluation target. For backend pipeline: OpenAI image API (already integrated) is preferred over Higgsfield MCP (chat-only). Must label AI-generated images in UI. Never attach AI imagery to real sourced news stories. See Phase 12q.
- 12o.2–12o.5 (scroll/dwell/click/share engagement signals) — post-beta.
- Data dashboards (AI Compute Cost Tracker, Semiconductor Supply Index, Macro-to-AI dashboard) — Phase 13+. Post-beta, after behavioral data accumulates. High-value for paid tier justification.
- Live developing-story threads (Bloomberg "Latest Updates" pattern) — requires event-clustering logic. Post-beta.
- Topic chips / "In Focus" anchors — requires topic-extraction on events. Phase 12j/k/l.

> **ADDED June 6 — reclassifications (the originals above are kept; these supersede their status):**
> - **Reddit adapter (#83)** — built, disabled at registry. **Promoted from "deferred someday" to Phase 12R.A** (Real-Time Layer). Economics changed: commercial use now requires a contract (~$12k/yr); run on the free non-commercial tier during private beta only.
> - **Twitter/X API** — **promoted from "evaluate post-beta" to Phase 12R.B** (planned). Path is pay-per-use (~$300–600/mo), not the now-closed Basic tier. See §19.
> - **LinkedIn / Instagram / TikTok** — Instagram/TikTok now **explicitly out of scope** (§6.20: low signal-to-noise, no clean ingestion path). LinkedIn parked (no clean ingestion path; ToS risk).
> - **Crunchbase API** — added as Phase 12R.C funding source ($99/mo Pro; free tier eliminated 2025).
> - **`og_image_url` → `illustration_url`** — the native-illustration column actually shipped as `events.illustration_url` (migration 0044); the redesign renders it. (Earlier roadmap rows reference `og_image_url` — same intent, different final column name.)
> - **`/redesign-preview` dev route** — new deferred cleanup: gate behind a dev flag or remove before public launch.

### Open issues
- **#64** — writeEvent retry mechanism (partially addressed)
- **#66** — Sentry fingerprint grouping (low priority)
- **#67** — worker_failed handler scope (low priority)
- **#77** — teamStoryIdx partial-blind to event comments (V4-adjacent)
- **#81** — BullMQ teardown warning in jest (low priority)
- **#83** — Reddit API adapter (blocked on credentials)
- **#84** — openai package missing from canonical clone node_modules
- **enrichmentJob.test.ts** — ✅ FIXED June 1. Was 6 pre-existing failures (Sentry `captureFailure` called twice vs once in mock-DB tests). Root cause: missing `process.env.OPENAI_API_KEY = ""` in `tests/setup.ts`. Does not affect production behavior.
- **searchStories / getRelatedStories** — ✅ RESOLVED (June 2026 audit found this was already fixed): `searchStories` was migrated to `events` in Phase 12p, `getRelatedStories` in Phase 12q. The only remaining `stories` reads are intentional dual-read **anchor lookups** for legacy story-detail resolution; results come from `events`. This item was stale-flagged as open for weeks — a memory-drift artifact, now corrected.
- **openrsync sector mismatch** — HN repo discovery authored openrsync (BSD rsync clone) with `sector: ai`. Tool has no AI relevance. Author-stage quality gate being strengthened in Phase 12n.7.

> **ADDED June 6 — open items:**
> - **github-trending / tool-spotlight production status** — unverified in prod (deep-research item, §6.20/§17). The Originals band on the live feed showed no tool-spotlight card.
> - **`/redesign-preview`** — public dev route in the shipped build; gate/remove before public launch.
> - **Earnings/SEC card data-dependency** — renders only when a SEC EDGAR `filing` event is ranked into the feed window; not a bug, but means the card is invisible on a no-filing day.

### Workspace hygiene (ongoing)
- Stale registered worktrees in .git/worktrees/ — run `git worktree prune` after clearing leftover directories.
- Untracked at repo root: pr56-diff.txt, OneDrive/ directory.
- OPENAI_API_KEY confirmed in backend/.env — keep billing active.
- Canonical repo path: `C:\dev\signal-app\` (flat). Never launch Claude Desktop from under OneDrive.

> **ADDED June 6 — workspace hygiene:**
> - Local `main` was diverged with 2 stale "board loop" commits (`da56a3c`, `3fe68b4`); resynced to `origin/main` June 6 (commits preserved on `origin/claude/feed-board-fixes-2` + `origin/claude/feed-rank-recenter`).
> - Untracked scratch screenshots at repo root (`redesign-v2-*.png`, `originals-band.png`, `since-last-visit.png`) — `Remove-Item C:\dev\signal-app\*.png` in PowerShell. (CC's sandbox blocks `rm`/`git reset --hard` — run destructive cleanup in Omar's own terminal.)
> - New docs: `docs/REALTIME_SIGNAL_LAYER.md` (real-time layer spec), `docs/handoffs/redesign-v2-handoff.md`.

---

## 16. Carried-Forward Heuristics

### Engineering practice
- One session = one tight slice.
- Three-stage CC prompt sequence: audit → implementation → merge.
- git worktree remove BEFORE gh pr merge --delete-branch.
- Worktree directory leftover (node_modules) expected after removal — flag for manual cleanup.
- Each new worktree needs npm install in backend/ until #84 is fixed.
- Test paths: backend/tests/ingestion/ (not __tests__).
- CC summary claims ≠ committed code — always audit before approving merges.
- UMN campus Wi-Fi blocks port 5432 and Railway TCP proxy — use hotspot or VPN for prod DB connections.
- Prompt delivery: single fenced markdown code block in chat.
- Unexpected state → stop and flag, never improvise silently.
- Local dev requires Redis running (Windows: `C:\dev\redis\redis-server.exe`).
- Local dev DB (Neon) missing migrations past ~0013 — use prod DATABASE_URL temporarily for visual verification, swap back after.
- Shell snippets in chat containing `.md`/`.json` filenames get auto-linked into broken markdown — use globs or quoted strings instead.
- Env-inspection prompts must filter `*_TOKEN|*_KEY|*_SECRET` before emitting output.
- Session CWD pinned via `~/.claude/sessions/<pid>.json` from invocation CWD — always launch Claude Desktop from `C:\dev\signal-app\`.
- PowerShell on Omar's terminal — use `dir`, `Get-Content`, `Select-String` instead of `ls`, `head`, `grep`.
- **Shell-env shadowing trap (CLAUDE.md §12):** Empty `ANTHROPIC_API_KEY=""` in shell silently shadows the real key in `.env` (dotenv won't override). Every Haiku call returns `llm_call_failed`. Fix: `Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue` (PowerShell) before running native generation or any Haiku-dependent script. Check: `echo $env:ANTHROPIC_API_KEY.Length` (PowerShell) — 0 means shadowed.
- **backend/package-lock.json regeneration (CLAUDE.md §15, added June 1):** When backend deps change, Railway deploys can fail with npm ci lockfile mismatch. Root cause: `backend/Dockerfile` uses `backend/` as its build context with a standalone `backend/package-lock.json` separate from the root lockfile. npm in workspace mode will NOT regenerate `backend/package-lock.json` — must run from a scratch dir outside the workspace: `New-Item -ItemType Directory -Force $env:TEMP\signal-lock-tmp`, copy `backend/package.json` there, `npm install --package-lock-only`, copy `package-lock.json` back to `backend/package-lock.json`, commit alongside any backend dep changes.
- **Railway BuildKit Docker layer caching:** Caches persist across redeploys and bust on file content hash change. A cached layer with a stale lockfile can cause deploy failures even after committing the correct lockfile — force a cache bust by making a trivial change to a file in the cached layer if needed.
- **Title-number vs. GitHub issue number:** SIGNAL roadmap uses internal title-numbers ("Issue #26") separate from GitHub's auto-assigned real numbers. Always disambiguate before closing issues in PRs. This caused a real wrong-issue closure (GH #25 closed instead of GH #35). Documented in CLAUDE.md.
- **psql on Windows code page 437:** Em dashes render as `ù`, arrows render as `ΓåÆ`. Data is correct UTF-8; this is a terminal display artifact only. Run `SET client_encoding = 'UTF8';` at session start to prevent errors. Never interpret display artifacts as data corruption.

> **ADDED June 6 — engineering practice:**
> - **CC sandbox guards destructive ops:** `git reset --hard`, `rm`, and some compound shell commands are denied in the CC tooling shell. Run those cleanups (resync local main, delete scratch files) in Omar's own PowerShell.
> - **Prop-rename across a component tree:** when renaming a shared prop (e.g. `nowMs` → `freshSinceMs`), grep every call site; the frontend type-check is the safety net (it flagged all 7 mock factories needing a new required field during the redesign).
> - **Adding a required field to a wire type breaks every mock factory:** the redesign's `content_type` addition forced updates to 7 test factories — run `tsc --noEmit` to enumerate them, then `perl -0pi -e` for the mechanical insert.
> - **SSR-safe client clocks:** anything using `Date.now()`/localStorage for "freshness" must be null on first paint and set in `useEffect`, else hydration mismatch (the `useLastVisit` / `freshSinceMs` pattern).

### Architecture
- Timestamp-per-state > polymorphic boolean.
- Fail-open for throttling, fail-closed for auth.
- Personalization cache-first, generate on-demand.
- Asymmetric max_tokens per tier (300/400/500).
- Strategy B per-tier idempotency: three independent JSONB markers.
- Demote-before-insert ordering in transactions touching partial unique indexes.
- Single UUID namespace for story/event IDs — commentary_cache.story_id carries either (FK dropped migration 0024).
- CHECK exactly-one constraint pattern for nullable FK pairs (user_saves, comments migration 0023).
- Redis fail-open for rate-limiting gates (story cap, search cap) — degrades to "no cap" during outage, acceptable tradeoff.
- Generic commentary pre-generated in writeEvent pipeline — no separate job, no new failure mode.
- **Two commentary systems:** System A (ingestion-time, non-personalized, stored on event row as `generic_commentary` text field — used by Free users and daily digest). System B (per-user, pro/pro_trial, generated via `commentaryService.ts` with full profile context, stored as JSONB `{thesis, support}` in `commentary_cache`). Free users always get System A output. Never conflate the two. System B falls back to tier-3 fallback string if profile missing role/domain/seniority. `commentaryPromptV2.ts` is the active System B prompt file.
- **Native posts — Fork B orchestrator** (`nativeEnrichmentJob.ts`): separate from `enrichmentJob.ts`, calls same seams (facts → tiers → writeEvent), skips relevance/cluster by construction. `source_type='native'` discriminator on events. Global daily cap via DB count (fail-open). All seven generators share the same orchestrator and cap mechanism.
- **Cross-sector chain generator quality gate:** Causal chain must be genuine (cause-and-effect, not correlation-not-causation). Model declines with `{skip: true, reason: "..."}` when no genuine mechanism. A manufactured chain is worse than none. Events feeding the chain: top quality-gated events per sector for last 48h, accessible thesis only — no article text reproduced.
- **Tool spotlight generator quality gate:** "Why now" must be specific — a recent shift, capability gap, or workflow pain. Decline if only reason to write is "it got upvotes." Works from HN title + score + comments only; no GitHub API call.
- **Postgres enum + same-transaction rule:** Cannot use a newly-added enum value in the same transaction that adds it. Split into two migration files (e.g. 0036 adds value, 0037 uses it). Migration runner wraps each file in one transaction.
- **Corroboration count:** No scalar column exists on events — computed as `count(event_sources) per event` (HAVING clause). Do not add a column; aggregate at query time.
- **EDGAR adapter:** `sec_edgar_json` is the correct adapter_type (not `sec_edgar`). `sec-edgar-full` was converted to RSS adapter in migration 0026 — it will never match `adapter_type='sec_edgar_json'` filters. Use `sec-edgar-finance` and `sec-edgar-semis` for EDGAR signals.
- **Events-only feed (as of June 1):** `getFeed` queries the `events` table only — the legacy `stories` table union leg has been removed. **`searchStories` (12p) and `getRelatedStories` (12q) also query `events`** — the only `stories` reads left are intentional dual-read anchor lookups for legacy story-detail pages. (Corrected June 2026 — earlier roadmap text wrongly listed these as "still on stories.")

> **ADDED June 6 — architecture:**
> - **Card-type derivation is now canonical:** `lib/feedCardType.ts` `deriveCardType(story)` maps wire fields (`kind` / `generator_type` / `content_type` / `sources.length`) → discriminated card type + branded label + `isHero`. New sources/types extend this single function (not ad-hoc per-component logic).
> - **`content_type` discriminant (migration 0045):** `events.content_type` (`filing`/null today; `take`/`launch` planned in 12R) — set in `writeEvent` off the source adapter type, surfaced on the wire, drives the card shape. Mirrors how `source_type` discriminates native/ingested.
> - **Freshness / return-loop:** `freshBoundaryMs(previousVisitMs, nowMs)` — the reader's last visit (from `useLastVisit`, localStorage) is the NEW-badge boundary, falling back to a rolling window on a first visit. `isAfter(iso, boundaryMs)` is the per-story predicate.
> - **Native-archive enrichment:** the native endpoint now carries `generic_commentary` + `image_url` so the Originals band can lead with the explanation; a `nativeToStory` adapter maps the lean archive item onto the full Story shape so the shared card components render it.
> - **New-source contract (12R):** a source = pure `AdapterFn` → `Candidate[]` + a seed `ingestion_sources` row; RSS-shaped sources reuse the `rss` adapter; JSON APIs add an `ingestionAdapterTypeEnum` value (two-file add/use split).

### Product
- Cost governance is load-bearing. Haiku worst-case ($80–150/day ingestion) factors into pricing directly.
- Attribution must be prominent. Per-source writer seeding makes this structural.
- Design after features ship, not before.
- Product name: "Valo" is the frontrunner. Codebase stays SIGNAL until an explicit rename pass. Trademark consult deferred.
- Depth tiers: accessible / briefed / technical. Default: accessible. Never reference Beginner/Standard.
- Two-tier paywall at launch and permanently (Free / Pro). Premium tier removed following V3 pivot.
- Paywall conversion pitch anchored on personalization, not content volume. "Pay to read smarter, not pay to read more."
- Daily digest uses generic commentary as click-through hook — personalized commentary lives in-app only.
- **Native posts — Treatment 2 (June 1):** HOOK → SPECIFICS → STAKES → SOURCE → mandatory ACT/WATCH close. Five beats. Say one thing per post. Subtract to the load-bearing sentence. Only ship the non-obvious connection. ACT/WATCH close is required — a post without a concrete action or watch instruction is incomplete. Decline output that merely restates what news already covered.
- **Commentary voice direction (from June 1 audit):** SIGNAL's commentary is the editorial entry point — not a summary of what the article says, but a stance on what it means for the reader. First sentence must be a hook: specific, surprising, or tension-creating. Second person where natural. Concrete consequences over neutral descriptions. This direction applies to all three tiers and to native post prompts alike.
- AI images on native posts: chat-based Higgsfield MCP for manual generation; OpenAI image API (already integrated) for backend pipeline. Label AI-generated images. Never attach AI imagery to sourced news stories.
- Engagement ranking only meaningful with real user data. Saves wired in before beta. Full behavioral ranking post-beta.
- GitHub stars are a gameable signal. Use HN discussion + fork ratio + issues-to-stars + contributor count for repo credibility. A repo with 198K stars and 38 open issues is suspicious — real usage generates real issues.
- **Cross-sector synthesis is SIGNAL's highest-differentiation content.** No RSS feed, no newsletter, no aggregator produces causal chains across sectors. The cross-sector chain generator is the most important native post type and should be the highest-ranked native post in the feed when it fires.

> **ADDED June 6 — product:**
> - **"Design after features ship, not before" — with a caveat the redesign proved:** when the moat is *built but hidden*, a presentation-layer pass is the single highest-leverage move. The redesign added no new capability; it surfaced existing capability (the explanation + native synthesis) and lifted the board's moat-coverage read materially.
> - **The personalized "why it matters to you" is the $10.** Make a *teaser* of it visible to free users (shipped: tier-gated `LockedTeaser`) — hiding it entirely behind the paywall means free users never feel the value, so they never convert.
> - **THE CONNECTION should be the visual hero, not a row** (shipped: promoted to the Originals illustrated hero). It's the highest-differentiation content; it should look it.
> - **The next moat frontier is real-time/social breadth (June 6 audit)** — but a *curated* layer (allowlists), not the firehose. The moat is "we tell you why a specific take matters to YOU," applied to X/GitHub/Reddit/launches.
> - **Unit economics: high fixed cost, near-zero marginal cost per user.** User count barely moves spend; Pro *conversions* are everything. At 100 users you run at a loss; break-even ≈ 60 Pro users (current) / ~245 Pro users (with the real-time layer). Gate paid sources (X, commercial Reddit) until the user base justifies them. Full model: §19.

---

## 17. Immediate Next Actions (updated 2026-06-16)

**Launch gate — billing is now LIVE (test mode):**
1. ✅ **Phase 12h (Stripe billing) — LIVE** — shipped 2026-06-16. Stripe Checkout works end-to-end in **live mode**: `/upgrade` button opens hosted checkout, 7-day trial wired, webhook flips `tier='pro'` on `checkout.session.completed`. Live-mode keys and price IDs deployed to Railway. Legal pages live at `/terms`, `/privacy`, `/refund` and linked from `/upgrade`. ✅ **Legal pages** — `/terms`, `/privacy`, `/refund` shipped June 16 (Human Machine Automation LLC, Minnesota law, 7-day trial + 72h monthly / 14-day annual refund windows).

**Engineering — pre-beta polish: ✅ DONE (June 14 session). The non-blocking engineering queue is now empty.**
2. ✅ **Commentary hook improvement** — verified live in `commentaryPromptV2.ts` (hook + banned openers; wired via `commentaryService`).
3. ✅ **Sector mismatch fix** — verified live in `hnRepoPrompt.ts` (AI-relevance gate declines non-AI tools with `not-ai-relevant`).
4. ✅ **Comment counts in feed cards** — present on every surface (StoryExhibit, StoryCard, SearchResultCard).
5. ✅ **Native post detail view** — synthesis body now leads as "The Briefing" above the personalized read (`nativeSynthesisBody` + `DetailPanel`).
6. ✅ **API cost instrumentation** — `[llm-cost]` per-call logging (`lib/llmCost.ts`) across every Anthropic/OpenAI call site; aggregation recipes in `docs/DEPLOYMENT.md`.
7. ✅ **Onboarding copy + team-feed "Load more"** — dropped internal "role-neutral" jargon from the digest opt-in; wired real team-feed pagination (backend already supported it).

**Decision-gated builds shipped June 14:** (1) **SIGNAL rating v1** — the §1 credibility differentiator, a 0–100 score per event (primary-source tier + quality + corroboration) on the feed kicker + detail. (2) **In Focus topic chips** — LLM entity extraction per event (`events.topics`, off the ingestion hot path) → `GET /api/v1/stories/in-focus` → chips bar atop the ranked stream. Brand stays SIGNAL (Valo deferred to post-trademark). **One-time prod backfill:** `npm run run-topic-extraction --workspace=backend -- --all` (or let the 30-min `TOPIC_EXTRACTION_CRON` scheduler drain it).

What's left is genuinely blocked, not buildable now: **keys** (Reddit-FRED-YouTube activation / X), **real user data** (engagement ranking v2, 12o.2–5), or **live prod observation** (Sentry fingerprint grouping #66). ~~Live Stripe keys~~ — done. Data dashboards remain post-beta. The jest open-handle warning (#81) is an accepted `forceExit` tradeoff; worker-failure handling (#67) and search/related (12p/12q) are already done.

**Engineering — Phase 12R (Real-Time Layer):**
- ✅ **12R.A SHIPPED** (PR #145) — Product Hunt (`rss`, `content_type='launch'` → THE LAUNCH card), direct `github_api` adapter (WORTH AN AFTERNOON), `what_to_do_with_it` hook across all tier prompts. Migrations 0046–0048.
- ⚙️ **Reddit AI/semis** — migration 0058 seeds `reddit-ai` (MachineLearning + LocalLLaMA) and `reddit-semis` (chipdesign + ASML). Adapter is live and key-gated; rows go active once `REDDIT_CLIENT_ID`/`SECRET` are set on Railway.
- ⏸️ **Phase 12R.B (X/Twitter)** — held on Omar's access + budget decision (~$300–600/mo pay-per-use; see §19).

**Operational (Omar's actions, ordered by lead time):**
1. **LLC formation** — longer-term item; no longer blocking Stripe (account activated without it). Still needed for bank account and formal business structure.
2. ✅ **Stripe live-mode cutover — DONE June 16.** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_ANNUAL_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` all set to live values in Railway. Checkout + webhook verified working.
3. **Railway env vars** (four adapters log-and-skip until set — all free-tier keys):
   - `FRED_API_KEY` → fred.stlouisfed.org/docs/api/api_key.html
   - `YOUTUBE_API_KEY` → Google Cloud Console → YouTube Data API v3
   - `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` → reddit.com/prefs/apps (type: script)
4. **Domain purchase** → point at Vercel → update `FRONTEND_URL` + CORS allowlist.
5. **SendGrid domain auth** — SPF/DKIM/DMARC records; emails hit spam without this.
6. ✅ **Privacy policy + ToS + refund policy — DONE June 16.** `/terms`, `/privacy`, `/refund` live and linked from `/upgrade`.
7. **Support email** — users need a contact point before public launch.
8. **X API access decision** — pay-per-use (~$300–600/mo) or defer Phase 12R.B.
9. **First 10 beta users** — identify + outreach in parallel with domain/SendGrid.
10. **Trademark search "Valo"** + brand decision — ship as SIGNAL or rename first.
11. **Stripe Dashboard manual step** — Settings → Business → change display name to "SIGNAL"; add `/terms`, `/privacy`, `/refund` URLs.

**Engineering — later (post-launch):**
- ~~Topic chips / "In Focus" anchors~~ — ✅ shipped June 14 (LLM extraction → in-focus endpoint → chips bar).
- ✅ **Coverage dashboard shipped June 14** (`/dashboard` — events by sector + daily volume + In Focus, recharts). The market-data modules below remain (need gated feeds).
- Data dashboards — market modules (AI Compute Cost Tracker, Semiconductor Supply Index, Macro-to-AI) — need FRED/external feeds.
- Full sourced-article detail view redesign.

---

## 18. Document Notes

**Calendar projection intentionally not included.** Sequence is locked; specific dates are not.

**Document owner:** Omar Elkhateeb
**Last updated:** June 16, 2026 (Stripe billing cut over to live mode. Legal pages (/terms, /privacy, /refund) shipped. §17 Operational items 2 + 6 marked done; item 11 added for Stripe Dashboard manual step. Status line updated: 12h no longer a launch gate. §14 pre-launch ops table updated: Stripe ✅ live, ToS/privacy/refund ✅ shipped. June 16 annotation block added. All prior content retained verbatim.)
**Review cadence:** After each major phase completion, or when scope changes materially.

---

## 19. Unit Economics & Cost Model (ADDED June 6, 2026)

Verified API pricing (June 2026 web research) + a spend-vs-revenue model. **The headline: this is a high-fixed-cost, near-zero-marginal-cost product — user count barely moves spend; Pro conversions are everything.**

### 19.1 Verified data-source API pricing (June 2026)

| API | What it is | 2026 pricing reality |
|---|---|---|
| **X / Twitter API** | Real-time social takes | New devs **cannot get Basic ($100/mo, 10k reads) or Pro ($5,000/mo, 1M reads)** — legacy only. Default is **pay-per-use: $0.005/post read, $0.01/post created, 2M reads/mo cap**. Enterprise $42k+/mo. → SIGNAL path = pay-per-use, ~$300–600/mo at modest polling. |
| **Bright Data** | Third-party scraper (X alt) | Consumption-based: ~$1/1k records (promo $0.75), plans $499/$999/mo. The **ToS-gray** "go around the API" option. |
| **Crunchbase API** | Startup/funding data | Free tier **eliminated 2025**. Basic $49/mo, **Pro $99/mo** ($1,188/yr). |
| **Reddit API** | Community sentiment | Free tier (100 q/min) is **non-commercial only**, pre-approval required (Nov 2025 policy). **Commercial use requires a contract — Standard from ~$12,000/yr.** Above free: $0.24/1k calls. |
| **GitHub API** | Trending repos | **Free** (5k req/hr authenticated). |
| **Product Hunt** | Tool/startup launches | **Free** (RSS / GraphQL). |

### 19.2 AI / infra unit costs (June 2026)

- **Claude Haiku 4.5:** $1/M input, $5/M output. Prompt caching up to 90% savings; batch 50% savings.
- **OpenAI text-embedding-3-small:** $0.02/M tokens (input only); $0.01/M batch.
- **Infra (est.):** Railway ~$20–40/mo + Vercel ~$20/mo + SendGrid ~$20/mo ≈ **$60–100/mo**.

### 19.3 Cost structure — fixed vs variable

- **Variable (scales with users) — tiny.** System B personalized commentary, per active Pro user: ~15 cached calls/day × ~$0.004 ≈ **~$1.80/mo/Pro**. Free users ≈ $0 marginal (pre-generated System A, no per-view call).
- **Fixed (independent of user count) — the real bill.**
  - Ingestion Haiku (relevance on all candidates + facts + 3 depth tiers on survivors): **~$300–600/mo realistic** *(roadmap worst case up to ~$4,500/mo; MEASURE the actual Anthropic invoice — biggest uncertainty, prompt caching can cut 50–90%)*.
  - OpenAI embeddings ~$5–15/mo · Infra ~$60–100/mo.
  - Data APIs: current (RSS/arXiv/HN/EDGAR) **$0**. With real-time layer: X ~$300–600/mo · Reddit $0 (free non-commercial) or ~$1,000/mo (commercial) · Crunchbase $99/mo.

### 19.4 The 100-user P&L

*Assumptions: 100 registered, ~40 daily-active, ~15% Pro conversion (15 Pro × $10/mo = $150/mo revenue).*

| Scenario | Monthly spend | Monthly revenue | Net |
|---|---|---|---|
| **Current V1** (no real-time) | ~$420–730 | $150 | **−$300 to −$580** |
| **+ Real-time layer** (X + commercial Reddit) | ~$1,700–2,300 | $150 | **−$1,550 to −$2,150** |

**At 100 users you run at a loss either way** — costs are fixed-infrastructure; 15 Pro users can't cover them yet. This is normal for this product class; it works at scale.

### 19.5 Break-even & the strategic takeaways

- **Gross margin per Pro user ≈ 82%** ($10 − ~$1.80). Once the fixed-cost hump is cleared, each Pro user is almost pure profit.
- **Break-even (at $10/Pro):** ~**60 Pro users** (≈ 400 total at 15% conversion) for current V1; ~**245 Pro users** (≈ 1,600 total) with the real-time layer.
- **Takeaways:** (1) optimize for *Pro conversions*, not user count — cost barely scales with users. (2) The real-time layer ~4×'s the break-even point (mostly commercial Reddit + X) — **gate Phase B (X) and commercial Reddit until the user base justifies them**; start with the genuinely-free pieces (GitHub + Product Hunt) and run Reddit on the free non-commercial tier during private beta. (3) **Instrument real AI spend** — don't trust estimates; the Anthropic/OpenAI/Railway invoices are knowable ground truth. (4) Prompt caching + batch are real cost levers (50–90% on Haiku/embeddings).

**Sources (June 2026):** X API pricing — xpoz.ai, postproxy.dev · Reddit API — octolens.com, replydaddy.com · Crunchbase — dev.to · Bright Data — costbench.com · Claude Haiku 4.5 — pricepertoken.com, platform.claude.com · OpenAI embeddings — helicone.ai.

---

## 20. June 7, 2026 Session — Imagery, Real-Time Phase A, Illustration Automation (ADDED June 7)

This section is purely additive: it records the June 7 working session. Nothing in §1–§19 is removed; statuses below advance items already described in §6.18 (12q illustrations), §6.19 (redesign), §6.20 (12R Real-Time Layer), §7.3 (design roadmap), and §14 (pre-launch ops). Where this session diverged from the prior plan, the divergence is called out explicitly.

### 20.1 What shipped (and where it lives)

**(1) Image-first detail view — `DetailPanel.tsx` (`components/redesign/swiss/`).** The persistent right-panel reader now renders the story's `image_url` (og:image) or `illustration_url` full-bleed at the top of the detail, before the INTEL DEPTH toggle / kicker / headline / CORE BRIEF. Honest fallback: nothing renders when neither field is present (no placeholder). This is the Bloomberg/WSJ "image leads" pattern from §7.2 applied to the reader surface. Note: this is **complementary to — not the same as** — the still-open "native-post detail synthesis-as-hero" item (§6.18/§6.19 follow-ups); that item (make the 200-word native editorial body the hero of the native detail) remains open.

**(2) Originals band → single Connection hero + interleave — `SwissCommandFeed.tsx`.** Removed the standalone 6-wide `SignalOriginals` band that opened the feed with up to six native posts before any news. `RankedStream` already hoists the highest-ranked THE CONNECTION into the full-width hero and renders the other natives as type-aware rows at their ranked positions, so the band was a redundant second surfacing. Result: the feed opens with one Connection hero, then the ranked stream with Originals woven in. (An 8-advisor board review backed leading with the single flagship over a wall of self-authored posts.) `SignalOriginals.tsx` remains in the tree but is no longer mounted by the primary feed.

**(3) Phase 12R.A breadth — SHIPPED (PR #145, merged + deployed; advances §6.20).**
- **Product Hunt → THE LAUNCH:** seeded as an `rss` source (zero new adapter code); new `content_type='launch'` lights up THE LAUNCH card via `deriveCardType`. Free. ✅
- **GitHub → WORTH AN AFTERNOON:** a direct `github_api` adapter (repo search by sector topic), classified as a tool card. Complements the `tool-spotlight-native` route. Added the `github_api` value to `ingestionAdapterTypeEnum` (two-file add/use split per the enum rule). `GITHUB_TOKEN` is an optional Railway env for rate-limit headroom (unauthenticated works at lower limits). Free. ✅
- **`what_to_do_with_it` hook:** threaded an "actionable" flag (set when a source's `content_type` is `tool`/`launch`) through `tierGenerationSeam` into all three tier prompts (accessible/briefed/technical) so repos/launches lead with "what you can apply this toward," not just "why it matters." ✅
- **Migrations:** 0046 (`content_type` extended), 0047 (`github_api` enum add), 0048 (Product Hunt + GitHub source seeds). Applied cleanly on prod deploy.
- **Reddit:** deliberately **NOT** activated. Commercial Reddit access requires a contract (~$12k/yr, §19); the registry still returns `null` for `reddit_api`. This is consistent with §19's "don't pay for commercial Reddit until the user base justifies it." Dropped from Phase A scope for now (not a blocker; revisit at scale).

**(4) Custom native-post illustrations — AUTOMATED (advances §6.18 "Custom illustrations: 🟡 groundwork shipped → automated generation").** Two layers, and the mechanism diverges from the prior plan:
- **Backend SDK path (built, DORMANT):** `services/illustrationService.ts` wraps the official `@higgsfield/client` v2 SDK (model `flux-pro/kontext/max/text-to-image`), with four brand archetypes — **convergence** (cross-sector-chain-native → THE CONNECTION), **research** (arxiv-synthesis-native), **market** (earnings-reaction-native, supply-chain-synthesis-native), **signal** (github-trending-native, tool-spotlight-native, hn-synthesis-native). `generateAndStoreIllustration` is awaited at the tail of `processNativeEnrichment` (after `writeEvent`), fully soft-fail (missing key / API error / out-of-credits → returns null, never blocks a publish). Ambient shim `backend/src/types/higgsfield-client.d.ts` + `tsconfig` `ts-node.files=true` make the `/v2` subpath resolve under classic moduleResolution. **This path is dormant:** the Higgsfield account has no API/cloud credits (the SDK returns "Not enough credits"), so `HIGGSFIELD_API_KEY` was removed from Railway and the backend cleanly skips illustration. Re-arm instantly if API credits are ever purchased.
- **Live mechanism — membership via SessionStart hook:** because the Higgsfield *membership* (separate from paid API credits) only works through the interactive banana MCP, illustration runs as an automatic agent turn at session start. `.claude/settings.json` → `SessionStart` injects `.claude/hooks/illustrate-on-session-start.md`, which lists native events lacking `illustration_url` (`backfillIllustrations.ts --dry-run`, prod URL from the gitignored `backend/.env`), generates one `nano_banana_pro` 16:9 image per pending event per archetype via the banana MCP, then persists via `applyIllustrations.ts --apply`. No prompting required; runs only while the desktop app is open (computer-off → the designed ConnectionHero three-diamond chain-motif fallback, never a broken image). The 7 existing native posts were illustrated this session via the manual MCP batch.

**Tests:** backend ~1318 passing (+13 illustration tests across the session); type-check + lint clean throughout.

### 20.2 Mechanism divergence from the prior plan (called out honestly)

§6.18 / §15 anticipated automated native-post illustration via the **OpenAI image API backend pipeline** ("preferred over Higgsfield MCP (chat-only)"), at ~$0.04/image. This session instead made the **Higgsfield membership** drive itself automatically through the SessionStart hook — $0 marginal cost, and it sidesteps the "Higgsfield is chat-only" limitation the roadmap flagged (the hook turns the chat/MCP into an automatic step). Both standing rules are respected: illustrations attach to **native posts only** (`source_type='native'` / native generator slugs) and **never to real sourced news stories**. The OpenAI-backend route remains a valid future alternative (and the SDK path is the drop-in paid alternative if credits are purchased).

### 20.3 NEW pre-launch gap introduced this session

**AI-generated images are not yet labeled in the UI.** §6.18, §15, and the §16 Product heuristics all require: *"Label AI-generated images as such in the UI."* The native-post illustrations now rendering on ConnectionHero (and the type-card thumbnails) carry no "AI-generated" marker. This is a stated launch requirement and should be satisfied before any public cut — a small per-image label/badge on native-post art. Tracked as a new pre-launch item (see §20.6).

### 20.4 Reconciliation note — `searchStories` / `getRelatedStories`

External/older snapshots of this roadmap list this as still open. The current on-disk §15 and CLAUDE.md both record it as **RESOLVED** (a June audit found `searchStories` was migrated to `events` in Phase 12p and `getRelatedStories` in Phase 12q; the only remaining `stories` reads are intentional dual-read anchor lookups for legacy story-detail resolution). No further rewrite is owed. Recorded here to stop the item being re-chased.

### 20.5 Real-Time Layer — what's IN vs OUT as of June 7

| Source | Card | Status (June 7) |
|---|---|---|
| GitHub repos | WORTH AN AFTERNOON | ✅ **IN** — direct `github_api` adapter shipped (PR #145), plus the existing `tool-spotlight-native` route |
| Product Hunt | THE LAUNCH | ✅ **IN** — seeded as `rss`, `content_type='launch'` (PR #145) |
| `what_to_do_with_it` hook | (cross-cutting) | ✅ **IN** — shipped across tier prompts (PR #145) |
| Reddit | PRACTITIONER BRIEF (community) | ⛔ **OUT for now** — adapter built, registry returns `null`; commercial access needs a contract (~$12k/yr). Deferred on cost, not capability |
| X / Twitter | THE TAKE | ⏸️ **HELD** — Phase 12R.B, paid (~$300–600/mo pay-per-use); blocked on Omar's access + budget decision |
| Crunchbase / funding | THE LAUNCH | ⏳ **LATER** — Phase 12R.C ($99/mo Pro); funding RSS is free and could come earlier |
| Instagram / TikTok | — | ❌ **OUT of scope** — low signal-to-noise, no clean ingestion path (§6.20) |
| LinkedIn | — | ❌ **PARKED** — no clean ingestion path, ToS risk (§6.20) |

Net: Phase A's genuinely-free pieces are **done**; the paid pieces (X, commercial Reddit, Crunchbase) are intentionally gated until the user base justifies the spend (§19).

### 20.6 New / carried operational items (additive to §14)

| Item | Status |
|---|---|
| ~~**Label AI-generated native-post images in the UI**~~ | ✅ **DONE (June 10 PM).** `AiArtBadge` across all five live illustration renderers (ConnectionHero, DetailPanel, StoryExhibit, FeatureImage, StoryDetail); shown only on AI illustrations, never og:images. See §20 June-10 note (7). |
| **`GITHUB_TOKEN` on Railway** | Optional — rate-limit headroom for the new `github_api` adapter; unauthenticated works at lower limits. |
| **`FRED_API_KEY` + `YOUTUBE_API_KEY` on Railway** | NEW — both gate live (Form D/FRED) or about-to-deploy (YouTube) sources; the adapters log-and-skip until the keys are set. Both are free-tier keys. |
| **Illustration automation is desktop-session-bound** | By design — runs via the SessionStart hook when the app is open (membership, $0). Computer-off → chain-motif fallback. Switch to the dormant SDK path only if Higgsfield API credits are purchased. |
| ~~Run `backfill-generic-commentary` + remove `WEEKLY_DIGEST_CRON`~~ | ✅ **DONE (June 10).** Backfill ran clean (0 rows — already complete); `WEEKLY_DIGEST_CRON` retired from `.env.example` (12i made the digest daily). |
| ~~Gate/remove `/redesign-preview`~~ | ✅ **DONE (June 10).** `notFound()` under `NODE_ENV=production` — the dev-only preview hard-404s in prod builds. |

### 20.7 Memory

A project memory (`image_generation_higgsfield.md`) records the imagery decision so future sessions inherit it: use the Higgsfield **membership** (banana MCP / `nano_banana_pro`) via the SessionStart hook for native-post illustration; the backend `@higgsfield/client` SDK path (`flux-pro/kontext/max`) is dormant pending API credits; never introduce Recraft/DALL-E/Replicate; API credits are separate from the web-app subscription.

# SIGNAL — Unified Product & Engineering Roadmap

**Document purpose:** Single consensus document covering both product strategy (what SIGNAL is, what it becomes over time) and engineering phasing (what we build to get there). Engineering detail level intended for use as a working reference across Claude Code sessions. Non-engineering concerns (financials, customer acquisition, legal structure beyond what blocks engineering) deliberately excluded — covered elsewhere.

**Snapshot date:** April 27, 2026
**Status:** Phases 0–12d shipped. Cluster 1.1–1.4 shipped. Cluster 1 complete. Discovery Session 2 complete (PR #41 — depth tier rename to Accessible/Briefed/Technical merged). Workspace cleanup complete (PR #42). Phase 12e scoped. Pre-V1.

---

## 1. What SIGNAL Is

SIGNAL is a daily intelligence and (eventually) community surface for high-agency professionals in AI, Finance, and Semiconductors who feel both behind and overwhelmed by the pace of their fields. It collapses what's currently fragmented across Twitter, LinkedIn, Reddit, GitHub, Substack, Bloomberg, and a dozen newsletters into one place — but with three things no aggregator combines: per-reader personalized commentary at three depth tiers (Accessible / Briefed / Technical), a credibility/quality scoring layer (SIGNAL rating) that lets users navigate volume without drowning, and over time a learning layer that turns reading SIGNAL into getting smarter at your domain.

Promise: 10–15 minutes a day on SIGNAL beats 60–90 minutes spread across five other sources, because the noise is filtered, the framing is personalized, and the depth meets you where you are.

The differentiation that earns premium pricing: not consolidation alone (which competes with free RSS readers), but the personalized commentary layer + the credibility layer + (later) the educational layer that no other product in the space combines.

---

## 2. Where We Are Today

Phases 0 through 12d shipped. Cluster 1 complete: 1.1 (drizzle journal reconciliation), 1.2 (story detail UX cleanup), 1.3 (12c smoke-test issue cluster), 1.4 (Commentary keyboard a11y verification). Discovery Session 2 complete (April 27, 2026): produced the depth tier rename — `accessible / briefed / technical` replaces `beginner / standard / technical`, default tier `accessible` (was `standard`). Reasoning lives in `docs/decisions/discovery-session-2-accessible-tier.md`. PR #41 shipped the rename across the codebase. Workspace cleanup complete: PR #42 cleaned up the worktree residue from the OneDrive flatten and home-dir-repo work.

Phase 12e is scoped end-to-end (see §5.4 below). The next session is 12e.1 stage 1 — read-only audit of current backend state ahead of schema and worker scaffolding.

What 12d became, vs what the old roadmap said: the original 12d entry described a "depth toggle UI" — segmented control to switch register per story. That spec is dead. Depth is now a profile-level preference (set at onboarding, edited in settings, applied to all commentary). The per-story interaction is expand/collapse — short thesis by default, "Go deeper" reveals additive support inline, thesis stays in place. Continuity of framing was the architectural premise. Implemented as Option C structured output (single Haiku call returning `{thesis, support}` jsonb).

What 1.2 became: clean template diff in one file (+2/−20 in `frontend/src/components/stories/StoryDetail.tsx`). Editorial "Why it matters" cut, SIGNAL Editorial byline cut, "Context" relabeled to "From the source", save button stays right-aligned in the header.

Side win this week: Claude Code permissions reconfigured. `~/.claude/settings.json` allow/deny rules shipped — allow common dev commands, explicitly deny destructive git ops. Auto mode enabled in Desktop settings; bypass mode disabled.

Workspace cleanup complete: both OneDrive flatten and home-dir-repo cleanup shipped. Working tree at `C:\dev\signal-app\OneDrive\Desktop\signal-app\` — out of OneDrive sync scope, plain directory, all gates green at the new path. Old OneDrive paths (`signal-app-12c\`, `sa-imr\`, home-dir signal-app tree) remain pending a few days of stability confirmation before deletion.

What's loaded for the next session is Phase 12e.1 stage 1 — the read-only audit.

---

## 3. The Strategic Versions

Six versions over the lifetime of the product. Each is independently shippable; each leaves the product more complete than the previous; each can be evaluated on its own merits before committing to the next.

### V1 — Launch ("The Signal")

The full feed product. What ships:

- **Multi-source ingestion: 42 curated sources across five adapter types** (RSS/Atom, arXiv Atom API, SEC EDGAR JSON, Hacker News API, Reddit API). High-signal-weighted editorial bar — lab primaries, top-tier analyst newsletters, official government/regulatory feeds, plus a curated tail of community signal.
- **Event-centric data model.** A story in SIGNAL represents an event in the world (e.g., "NVDA reports Q4 earnings"), not an article from a single source. Multiple sources covering the same event attach as linked sources to one canonical event row, with the feed surfacing "covered by SemiAnalysis, Bloomberg, +5 more" attribution.
- Format-aware commentary per source type. A tweet-shaped post gets different treatment than a research paper, which gets different treatment than a GitHub repo release, which gets different treatment than a news article.
- Three depth tiers (Accessible / Briefed / Technical) — already shipped in 12d, applied across all expanded sources.
- Accounts, saved articles, reading history.
- Refresh/feed ranking that pushes already-seen content to the bottom.
- Daily digest email (3–10 stories tier-dependent).
- **SIGNAL rating v1** — every event shows a credibility/quality score. Initially driven by static source-quality scores plus freshness plus user save signal. Visibility on day one matters more than algorithmic complexity.
- Free tier + Standard tier at ~$8/month.

Where commentary references HN/Reddit/community threads, it summarizes the discussion in plain language ("the HN thread is split on whether this scales") without reproducing actual comments. This gives V1 a communal feel without comment infrastructure.

V1 is fuller than the AI-personalized-news-feed apps that have failed (Artifact and similar). It has multi-source pluralism, a credibility layer, accounts, depth tiers, event-level coverage with attribution, and a working business model from day one. It's evaluable: within 60 days of launch you'll know whether the commentary + rating + multi-source thesis is landing.

### V2 — Depth ("Get Smarter")

The inline learning layer. What changes from V1:

- Tier-aware inline glossary. When an Accessible reader sees "MCP server" or "carry trade," tapping it expands a definition. Briefed tier sees a brief parenthetical. Technical tier doesn't see it — they already know.
- "Concepts to know" sections in the digest. Today's three or four core ideas, each anchored to one or two events that illustrate them.
- SIGNAL rating v2 — adds cross-source corroboration scoring (driven by event_sources count from the V1 event model — when more sources attach to an event, the rating reflects corroboration depth) and user feedback signal (thumbs up/down on commentary).

V2 is small to build but huge for positioning. It's what turns SIGNAL from "smart feed" into "the place I'm getting smarter at this field." That's the educational stickiness that drives long-term retention.

V2 features go into the existing Standard tier — they don't gate behind a new paywall. Premium tier doesn't launch yet.

### V3 — Courses ("Learn Here")

The full learning surface. Text-based, interactive (no video production), structured. Modeled on IBM SkillsBuild and Anthropic's lesson format. What changes from V2:

- Course library. Launch with 3–5 short courses: Intro to AI, Intro to LLMs, possibly Intro to Frontier Tooling, plus one finance and one semiconductor primer.
- Course progress tracking, basic completion certificates, bookmarking within lessons.
- Integration with the feed: events about a topic the user is mid-course on get surfaced; finishing a course earns a depth-tier upgrade option ("you've graduated from Accessible to Briefed for AI topics").
- **Premium tier ($15–20/month) launches.** Full course library is Premium-gated. Standard sees course catalog + first lesson preview but cannot complete courses.

V3 establishes the three-tier paywall ladder. Free gets the feed + glossary. Standard gets full feed + concepts + history features. Premium unlocks courses. The course library is the load-bearing differentiator that makes Premium feel like a different product, not just "more of the same."

### V4 — Voices ("Your Take")

User-generated posts. What changes from V3:

- Anyone with an account can write their own post (a take, a tool recommendation, a question, a teardown).
- User posts run through SIGNAL rating like any other source. Low-rated posts sink; high-rated posts surface.
- Profile pages. Bio, posts, saves, optional links. Identity layer for the community to start forming around.
- Personal ranking starts using "what you've engaged with" (saves, dwell time, post engagement) to weight the feed.
- Source curation tools for admin: blacklist users, blacklist domains, content filters.

V4 is when SIGNAL becomes a real social product, but only after the feed itself has proven the thesis.

### V5 — Conversation ("Talk Here")

Comments. What changes from V4:

- Threaded comments on events and on user posts.
- Comments rated by SIGNAL like everything else; low-rated comments collapse, high-rated ones surface.
- Community flagging, automated filters for spam/banned terms, account standing scores so brand-new accounts can't immediately post low-quality content.
- Trusted-user moderation tier (community moderators with elevated privileges).

V5 is the hardest single version in the roadmap. Comments are higher-volume, more reactive, and more emotional than posts. Most online communities die at this jump if moderation is wrong. The version is timed late deliberately — months after V4 — so the posting layer has taught us what the community is actually like before opening the comment floodgates.

### V6 — Connection ("Find Your People")

Optional layer. What changes from V5:

- Co-founder / collaboration discovery surface. Profile signals + interests + posts feed a discovery interface where users can find others working on similar things.
- Optional advisor/mentor connection layer if community behavior in V4–V5 shows pull for it.

V6 is the version that may never ship. It's a transactional product (matching humans for relationships) layered on a content product, and the cost of building it before there's clear pull from V4–V5 community behavior is high. The decision to do V6 is made after V5 has been live for a while, looking at actual usage patterns.

---

## 4. Pricing Ladder Across Versions

| Version | Free | Standard ($8) | Premium ($15–20) |
|---|---|---|---|
| V1 | 10 events/day, role-neutral commentary, 3-event digest | Full feed, full personalization, depth tiers, full digest, save/export | — (not launched) |
| V2 | Same as V1 + glossary | V1 Standard + glossary + concepts + smarter rating | — |
| V3 | Same + course catalog preview | V2 Standard + course preview lessons | Course library (full), tier-upgrade paths |
| V4 | + view user posts | + post own content, profile | + Premium-only posts/AMAs (optional) |
| V5 | + read comments | + comment, flag | + priority response (optional) |
| V6 | — | + standard discovery | + advanced discovery, advisor surfaces |

Pricing finalization: the $8 / $15–20 numbers are working values. Final pricing depends on cost analysis (LLM call costs at scale, infrastructure, support) which is a separate exercise. **Cost note from 12e scoping:** Haiku spend at V1 ingestion volume estimated at $80–150/day worst case (5 calls/event for surviving candidates × ~30–50 events/hour). Factors into pricing analysis.

---

## 5. V1 Engineering Detail

### 5.1 Cluster 1 — Smoke + Cleanup ✅ Complete

**Why before 12e:** 12e adds migrations. The drizzle journal drift surfaced in 12d (had to manually backfill rows 0009 and 0010 in dev) is a recurring failure mode that will block every future migration if not fixed. Plus a few smaller items from the 12c smoke-test pass were still open. Clean foundation before the biggest engineering lift.

**Status:** Complete. All four sub-clusters shipped. Total: 4 sessions.

- **1.1** — Drizzle journal reconciliation (PR #37, April 25). Hand-written `NNNN_phaseXY_slug.sql` migrations under `backend/src/db/migrations/` confirmed as the convention; the `meta/_journal.json` drizzle-kit bookkeeping is retired. Migration runner is the homegrown `backend/src/db/migrate.ts` (advisory-locked, hash-validated, transaction-per-file).
- **1.2** — Story detail page UX cleanup (closes #25, April 26)
- **1.3** — 12c smoke-test issue cluster (PR #40, April 26)
- **1.4** — Commentary keyboard + screen reader verification (audit-only, April 26)

### 5.2 Discovery Session 2 — "What is Accessible depth for?" ✅ Complete

**Date:** April 27, 2026
**Output:** `docs/decisions/discovery-session-2-accessible-tier.md`
**Engineering follow-up:** PR #41 — depth tier rename across the codebase (`beginner` → `accessible` user-facing label and `accessible` enum value, `standard` → `briefed` depth-tier enum value; pricing tier "Standard" untouched). Default depth tier changed from `standard` to `accessible`.

**Resolved interpretations:**
- The "Accessible" tier is for **generalist onboarding + sector novices** (interpretations A and B from the original framing). Time-pressed experts (interpretation C) are served by a future "concise" mode that's not a depth tier — it's an orthogonal length preference, deferred to V2 or later.
- This implies the V2 inline glossary becomes the primary scaffolding mechanism for Accessible readers; glossary terms target Accessible as the floor tier for most domain jargon.
- **Implication for 12e:** story technical-density is **NOT** required as an enrichment field for V1. The depth tiers handle register adaptation at commentary generation time; per-event technical-density signals are not needed to drive that. Excluded from 12e enrichment scope.

### 5.3 Workspace Cleanup ✅ Complete

Two distinct jobs, both shipped April 26–27, 2026. OneDrive flatten + home-dir-repo cleanup. Working tree now at `C:\dev\signal-app\OneDrive\Desktop\signal-app\`. PR #42 cleaned up worktree residue.

Outstanding cosmetic followups: old OneDrive paths (`signal-app-12c\`, `sa-imr\`, home-dir signal-app tree, home-dir `.github\`) pending a few days of stability before deletion. Worktree-creation source remains undiagnosed; periodic cleanup will recur until that's understood. Diagnosis is its own follow-up, not blocking 12e.

### 5.4 Phase 12e — Ingestion & Event Model

**Goal:** Replace manual story seeding with continuous ingestion from 42 curated sources across three sectors and five adapter types, writing into a new event-centric data model where one event in the world is represented as one canonical row with multiple linked sources. Single biggest engineering lift in V1.

**Scope-shift note:** Originally scoped at 5–8 sub-sessions for ~10 RSS sources with a single-article-per-row data model and a manual review UI. Expanded during scoping session (April 27, 2026) to 42 sources, 5 adapter types, event-model architecture, 5-call Haiku enrichment pipeline (relevance + facts + 3 tiers), embedding-based clustering, source-level kill switch (no review UI), per-adapter cadence, and frontend work to surface multi-source attribution. Launch timeline shifts right by an estimated 6–8 weeks. Decision recorded with full cost visibility.

**Dependencies:** Cluster 1 done. Discovery Session 2 done. Workspace cleanup done.

**Estimated total:** 15 implementation sub-sessions + 1 smoke-test cluster (12e.x).

#### 12e.0 Architecture summary — load-bearing decisions

1. **Source surface — 42 curated sources** (full list in §5.4.S — Source registry below).
2. **Five adapter types:** RSS/Atom (32 sources), arXiv Atom API (1), SEC EDGAR JSON (2 logical: full + semis-filtered), Hacker News API (1), Reddit API (1).
3. **Per-adapter cadence:** RSS hourly, SEC EDGAR every 15 min during business hours (9 AM–5 PM ET, M-F) and hourly off-hours, arXiv once daily at 21:00 UTC, Hacker News every 4 hours, Reddit every 4 hours. Five BullMQ repeatable jobs.
4. **Filter chain:** source whitelist + sector tag (deterministic) → heuristic filter (recency, length, noise patterns) → LLM relevance gate (one Haiku call/candidate, structured-JSON output).
5. **Enrichment:** four-stage Haiku pipeline per surviving candidate — fact extraction (1 call, persisted to `events.facts` JSONB) → three tier generations (3 calls, one per Accessible/Briefed/Technical). Total 5 Haiku calls per surviving candidate including the relevance gate.
6. **Cross-source dedup → event model.** New candidates clustered against existing events from the last 72h via embedding similarity (model selection deferred to 12e.6a; embedding column starts as `bytea` placeholder). Match → attach as additional source to existing event. Near-miss → create new event. The `events` and `event_sources` tables are introduced as new tables alongside the existing `stories` table; `stories` is preserved for backward compatibility during 12e and dual-read across `stories ∪ events` in feed/detail/v2 endpoints. Deprecation of `stories` deferred to post-launch.
7. **Per-source writer strategy.** Each `ingestion_sources` row gets a paired `writers` row at seed time. Feed bylines accurately reflect source provenance ("SemiAnalysis", "OpenAI News"), not a synthetic SIGNAL Wire byline. (The `writers` table is the existing one — no new `authors` table is introduced.)
8. **Failure / observability.** Dead-letter queue via BullMQ failed-state with structured metadata. Source-level kill switch on `ingestion_sources.consecutive_failure_count` (extended to include rejection-rate above threshold in trailing 24h, default 80% over 50+ candidates). Sentry tags: `ingestion.stage`, `ingestion.source_slug`, `ingestion.candidate_url`. Read-only `GET /admin/ingestion/status` route gated by env-var allowlist (`ADMIN_USER_IDS`) + new `requireAdmin` middleware. **No review queue UI** — soak in 12e.8 is the de facto pre-launch review.
9. **Default-seed cutover.** No automatic boot-time seed exists today; `seed-data/stories.json` is loaded only via the manual `npm run seed:stories` CLI. 12e.8 adds a `NODE_ENV !== "production"` guard inside that script to enforce dev-only execution. Production stays empty until the first cron cycle.
10. **Worker process model.** Ingestion workers run in-process with the API (matches existing `signal-email` and `signal-aggregation` queue convention from `backend/src/jobs/`). Splitting to a separate process is deferred to "decide on observation."

#### 12e.1 — Schema, source registry, worker scaffolding (~1 session)

- **Two migrations**, kept narrow:
  - `0014_phase12e1_ingestion_sources.sql` — adapter-type enum + `ingestion_sources` table + 42 source/writer seed inserts.
  - `0015_phase12e1_events_and_candidates.sql` — `events`, `event_sources`, `ingestion_candidates` tables + status enum.
- **`events` introduced as a new table alongside `stories`** — no rename. Keeps FKs from `user_saves`, `comments`, `commentary_cache`, `learning_path_stories` pointing at `stories.id` untouched. `stories` is preserved as a read-only legacy surface for the duration of 12e.
- **`facts` lives as JSONB column on `events`**, not a separate table. 1:1 with events; schema-flexible during enrichment iteration; querying individual facts is rare today. GIN-index later if cross-event fact queries become hot.
- **`embedding` column on `events` ships as nullable `bytea` placeholder.** Converted to `vector(N)` in 12e.6a once embedding model and dimensions are picked. Avoids forcing a `pgvector` extension install before the model decision.
- **Per-source writer seeding:** 42 paired `writers` rows (one per source, `writers.name = ingestion_sources.display_name`) inserted alongside `ingestion_sources` rows in the same migration. Existing single `SIGNAL_EDITORIAL` writer row stays — old hand-curated stories keep pointing at it; new ingested events point at source-writer rows.
- BullMQ queue and worker scaffolding under `backend/src/jobs/ingestion/` (matching existing `backend/src/jobs/` convention for `signal-email` and `signal-aggregation`). No live logic; idle pipeline that runs but does nothing.
- **CLAUDE.md note** disambiguating roadmap title-numbers (e.g., "Phase 12e.1") from GitHub issue/PR numbers (e.g., "#35"). Lands as a paragraph under §16 PHASE STATUS heading.

**No external network calls in this session.** Read-only audit (stage 1) precedes implementation (stages 2–3).

#### 12e.2 — Generic RSS/Atom adapter (~1 session)

`fetch-source` worker pulls RSS via `rss-parser`, normalizes items to candidate shape, dedups by URL canonicalization + content hash, persists to `ingestion_candidates`. Tested against 3 of the 32 RSS sources end-to-end. No filtering, no LLM, no clustering. Manual queue trigger only — no cron.

#### 12e.3 — Heuristic filter + body fetch (~1 session)

Heuristic stage: recency cutoff (36h), body length floor, noise pattern detection (link-bait, listicle, paid-content markers). Body extraction via `@mozilla/readability` + `jsdom` for survivors. Candidate status advances to `heuristic_passed` or `heuristic_rejected` with reason. Still no LLM.

#### 12e.4 — LLM relevance gate (~1 session)

One Haiku call per heuristic-survivor with structured-JSON output: `{ relevant: bool, sector: enum, reason: string }`. Status advances to `llm_relevant` or `llm_rejected`. First 100 calls' I/O logged for prompt-quality audit before turning the cron loose.

#### 12e.5a — Fact extraction worker (~1 session)

One Haiku call per relevant candidate. Structured-JSON output extracting 5–8 key facts from the article body. Persisted to `events.facts`. This step is the shared grounding for the three tier generations downstream.

#### 12e.5b — Three tier-generation workers (~1.5 sessions)

Three Haiku calls per candidate, one per tier. Tier-specific prompts under `backend/src/llm/prompts/ingestion/` (`tierAccessible.ts`, `tierBriefed.ts`, `tierTechnical.ts`). Each consumes the persisted facts plus the article body and produces `{thesis, support}` for that tier. Output written to event row's `why_it_matters_template` text-as-JSON column matching the existing `stories` shape: `{accessible: {thesis, support}, briefed: {thesis, support}, technical: {thesis, support}}`.

#### 12e.5c — Story write orchestration, dead-letter, Sentry tags (~1 session)

End-to-end chain: `ingestion-cron → fetch-source → evaluate-candidate (heuristic + relevance) → extract-facts → generate-tiers × 3 → write-event`. Hourly RSS cadence enabled. Dead-letter handling for stage failures. Sentry tags wired through all stages. **No clustering yet** — at this point each candidate creates a new event.

#### 12e.5d — arXiv + SEC EDGAR adapters (~1 session)

Two new adapters under `backend/src/jobs/ingestion/adapters/`. arXiv Atom API with daily cadence (21:00 UTC) and per-cycle volume cap (e.g., 20 most-recent per category). SEC EDGAR JSON with business-hours-aware cadence (every 15 min 9–5 ET, hourly off-hours), filtered to chip-company CIKs for the semis-tagged subset and unfiltered for the full feed. Both adapters chain into the existing filter+enrich pipeline.

#### 12e.5e — Hacker News + Reddit adapters (~1 session)

Two more adapters. Hacker News: pull `topstories`, filter by domain whitelist + minimum score (e.g., 100+), 4-hour cadence. Reddit: OAuth, fixed subreddit list (r/MachineLearning, r/LocalLLaMA, r/SecurityAnalysis, r/investing), top-of-day above score threshold, 4-hour cadence. Both chain into the pipeline.

#### 12e.6a — Embedding service integration + clustering algorithm (~1.5 sessions)

Embedding model selection (OpenAI `text-embedding-3-small`/`-large`, Voyage, Cohere; pinned in this session). Conversion of `events.embedding` from `bytea` placeholder to `vector(N)` with `pgvector` extension install. Per-candidate embedding computation post-relevance-gate. Cosine similarity check against embeddings of events from the trailing 72h window. Threshold tuning surface (configurable, default starts at ~0.85 cosine; adjusted during 12e.8 soak based on observed cluster quality).

#### 12e.6b — Event model write path (~1 session)

Two write paths in orchestration:
- Cluster match found → attach as new `event_sources` row (`role = 'alternate'`) to existing event. Source priority ordering decides primary-source flag (lab blogs / SEC EDGAR > analyst newsletters > news outlets > community).
- No cluster match → create new event row with the candidate as primary source (`role = 'primary'`), run the four-stage enrichment, write tier templates.

#### 12e.6c — Re-enrichment policy when new source joins existing event (~0.5–1 session)

**Open product decision** to be settled at the start of this sub-session, not by CC: when CNBC's coverage joins NVDA's existing earnings event 30 minutes after Reuters', do we regenerate the `why_it_matters_template`? Options range from "never re-enrich" (cheap, biased toward first source) to "re-enrich on every new attached source" (expensive, always-current) to "re-enrich only when the new source's word count exceeds the current primary's by N%" (compromise). Decision drives implementation in this sub-session.

#### 12e.7a — Frontend: event-level feed rendering (~1 session)

Feed cards updated to render events with multi-source attribution ("Covered by SemiAnalysis, Bloomberg, +5 more"). Primary-source byline shown prominently; secondary sources shown as compact attribution element. Feed/detail/v2 endpoints dual-read from `stories ∪ events` for the duration of the migration. Existing feed ranking signals continue to apply at the event level.

The frontend `Story` type at `frontend/src/types/story.ts` will be extended with multi-source attribution (e.g., `sources: Array<{ url, name, role: "primary" | "alternate" }>` + `primary_source_url` convenience field). Two render sites to update (`StoryCard`, `StoryDetail`); duplicated `Story` shape in `frontend/src/types/team.ts` follows.

#### 12e.7b — Frontend: event detail page, depth-tier commentary at event level (~1 session)

Event detail page restructured from the current story-detail layout. Source list visible as a discrete element. Depth-tier commentary (12d's expand/collapse pattern) operates at the event level. Per-source perspective view deferred to V2 or later.

#### 12e.8 — Admin status route, default-seed guard, 24h soak (~1 session)

`GET /admin/ingestion/status` — auth-gated by env-var `ADMIN_USER_IDS` allowlist + new `requireAdmin` middleware. Read-only. Returns per-source last-success, consecutive_failure_count, rejection_rate_24h, queue depths, recent failures (last 50), 24h ingest counts, 24h cluster statistics (events created vs sources attached). `seedStories.ts` gets a `NODE_ENV !== "production"` guard so the script can't accidentally land hand-curated stories on prod. 24h soak with full pipeline live; document anomalies for the smoke-test cluster.

#### 12e.x — Smoke-test cluster (TBD sub-sessions)

Standard pattern: post-soak issues batched into one cluster session. Reserve one slot. Likely areas of issue: clustering threshold tuning, paywalled-source body extraction (Bloomberg, SemiAnalysis preview, Stratechery free tier), volume drift on arXiv, tier output drift on specific source types.

#### Risks for Phase 12e overall

High complexity. Plan for slippage. The 12d session ran 4× longer than expected because of compounding environmental issues. 12e involves multiple new external integrations, embedding-model integration, schema redesign, and frontend changes; expect similar surprise factor. The workspace cleanup recommendation existed specifically to limit this.

Specific risks:
- **arXiv volume.** cs.LG alone gets ~150 new submissions/day. Volume cap is the safety mechanism; if heuristic filter is poorly tuned, the LLM relevance gate becomes the dominant cost driver.
- **Paywalled body extraction.** Bloomberg, SemiAnalysis preview, Stratechery free tier — body fetch will hit paywalls 50–90% of the time. Acceptable for V1 (we work from headline + summary), but tier-template output will be thinner from these sources.
- **Hallucinated tier content.** Haiku may state things not in the source. Mitigation: prompt design with explicit "only use facts present in the source" constraint; first-100-call I/O logging at each stage; soak cluster catches systematic patterns.
- **Clustering miscalibration.** Cosine threshold too tight → duplicate events. Too loose → unrelated stories collapsed into one event. Real signal here only emerges from the 24h soak.
- **Re-enrichment cost.** If 12e.6c lands on "re-enrich on every new source," cost can balloon during news cycles where 10+ outlets cover the same event in quick succession. Backstop with a per-event re-enrich rate limit.
- **`stories` ↔ `events` dual-read complexity.** During 12e, feed/detail/v2 endpoints read from both tables. Risk: ranking signals or pagination cursors that don't compose cleanly across the union. Mitigation: dual-read shipped behind a feature flag; soak validates.

#### 12e.S — Source registry (the 42 sources)

Each source row gets a paired `writers` row (`writers.name = display_name`). Quality scores are initial guesses to be tuned post-launch.

**AI sector (14 sources)**

| slug | display_name | adapter_type | endpoint | sectors | fetch_interval_seconds | quality_score |
|---|---|---|---|---|---|---|
| `anthropic-news` | Anthropic News | rss | https://www.anthropic.com/news/rss.xml | [ai] | 3600 | 9 |
| `openai-news` | OpenAI News | rss | https://openai.com/news/rss.xml | [ai] | 3600 | 9 |
| `deepmind-blog` | Google DeepMind Blog | rss | https://deepmind.google/blog/rss.xml | [ai] | 3600 | 9 |
| `google-research` | Google Research Blog | rss | https://research.google/blog/rss/ | [ai] | 3600 | 8 |
| `meta-ai-blog` | Meta AI Blog | rss | https://ai.meta.com/blog/rss/ | [ai] | 3600 | 8 |
| `arxiv-ai-cl-lg` | arXiv cs.AI + cs.CL + cs.LG | arxiv_atom | https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending | [ai] | 86400 | 9 |
| `huggingface-papers` | Hugging Face Daily Papers | rss | https://huggingface.co/papers/rss | [ai] | 3600 | 8 |
| `import-ai` | Import AI (Jack Clark) | rss | https://importai.substack.com/feed | [ai] | 3600 | 9 |
| `interconnects` | Interconnects (Nathan Lambert) | rss | https://www.interconnects.ai/feed | [ai] | 3600 | 9 |
| `simonwillison` | Simon Willison's Weblog | rss | https://simonwillison.net/atom/everything/ | [ai] | 3600 | 9 |
| `the-batch` | The Batch (DeepLearning.AI) | rss | https://www.deeplearning.ai/the-batch/feed/ | [ai] | 3600 | 7 |
| `mit-tech-review-ai` | MIT Technology Review AI | rss | https://www.technologyreview.com/topic/artificial-intelligence/feed | [ai] | 3600 | 7 |
| `arstechnica-ai` | Ars Technica AI/ML | rss | https://arstechnica.com/ai/feed/ | [ai] | 3600 | 7 |
| `hackernews` | Hacker News (filtered) | hackernews_api | https://hacker-news.firebaseio.com/v0/topstories.json | [ai] | 14400 | 6 |

**Semiconductors sector (13 sources)**

| slug | display_name | adapter_type | endpoint | sectors | fetch_interval_seconds | quality_score |
|---|---|---|---|---|---|---|
| `nvidia-newsroom` | NVIDIA Newsroom | rss | https://nvidianews.nvidia.com/releases.xml | [semiconductors] | 3600 | 9 |
| `amd-newsroom` | AMD Newsroom | rss | https://www.amd.com/en/newsroom/news-releases.xml | [semiconductors] | 3600 | 9 |
| `tsmc-newsroom` | TSMC Newsroom | rss | https://pr.tsmc.com/english/news.xml | [semiconductors] | 3600 | 9 |
| `asml-news` | ASML News | rss | https://www.asml.com/en/news/rss | [semiconductors] | 3600 | 9 |
| `intel-newsroom` | Intel Newsroom | rss | https://www.intel.com/content/www/us/en/newsroom/news.xml | [semiconductors] | 3600 | 8 |
| `ee-times` | EE Times | rss | https://www.eetimes.com/feed/ | [semiconductors] | 3600 | 7 |
| `semi-engineering` | Semiconductor Engineering | rss | https://semiengineering.com/feed/ | [semiconductors] | 3600 | 7 |
| `servethehome` | ServeTheHome | rss | https://www.servethehome.com/feed/ | [semiconductors] | 3600 | 7 |
| `semianalysis` | SemiAnalysis (Dylan Patel) | rss | https://semianalysis.substack.com/feed | [semiconductors] | 3600 | 9 |
| `fabricated-knowledge` | Fabricated Knowledge | rss | https://www.fabricatedknowledge.com/feed | [semiconductors] | 3600 | 8 |
| `asianometry` | Asianometry | rss | https://asianometry.substack.com/feed | [semiconductors] | 3600 | 7 |
| `bis-press` | BIS Press Releases | rss | https://www.bis.doc.gov/index.php?format=feed&type=rss | [semiconductors] | 3600 | 8 |
| `sec-edgar-semis` | SEC EDGAR (semis CIKs) | sec_edgar_json | https://data.sec.gov/submissions/CIK{cik}.json | [semiconductors] | 900 | 9 |

**Finance sector (15 sources)**

| slug | display_name | adapter_type | endpoint | sectors | fetch_interval_seconds | quality_score |
|---|---|---|---|---|---|---|
| `reuters-business` | Reuters Business | rss | https://www.reuters.com/business/feed | [finance] | 3600 | 9 |
| `cnbc-markets` | CNBC Markets | rss | https://www.cnbc.com/id/15839135/device/rss/rss.html | [finance] | 3600 | 7 |
| `bloomberg-markets` | Bloomberg Markets (headlines) | rss | https://feeds.bloomberg.com/markets/news.rss | [finance] | 3600 | 7 |
| `marketwatch` | MarketWatch | rss | https://feeds.marketwatch.com/marketwatch/topstories/ | [finance] | 3600 | 6 |
| `sec-edgar-full` | SEC EDGAR (full feed) | sec_edgar_json | https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom | [finance] | 900 | 9 |
| `fed-press` | Federal Reserve Press Releases | rss | https://www.federalreserve.gov/feeds/press_all.xml | [finance] | 3600 | 9 |
| `bls-press` | BLS Press Releases | rss | https://www.bls.gov/feed/bls_latest.rss | [finance] | 3600 | 8 |
| `money-stuff` | Money Stuff (Matt Levine) | rss | https://www.bloomberg.com/feeds/money-stuff/sitemap_news.xml | [finance] | 3600 | 9 |
| `the-diff` | The Diff (Byrne Hobart) | rss | https://www.thediff.co/feed | [finance] | 3600 | 8 |
| `net-interest` | Net Interest (Marc Rubinstein) | rss | https://www.netinterest.co/feed | [finance] | 3600 | 8 |
| `apricitas` | Apricitas Economics | rss | https://www.apricitas.io/feed | [finance] | 3600 | 8 |
| `marginal-revolution` | Marginal Revolution | rss | https://marginalrevolution.com/feed | [finance] | 3600 | 7 |
| `stratechery-free` | Stratechery (free tier) | rss | https://stratechery.com/feed/ | [finance] | 3600 | 8 |
| `reddit-finance` | Reddit r/SecurityAnalysis + r/investing | reddit_api | r/SecurityAnalysis+investing/top.json?t=day | [finance] | 14400 | 5 |
| `fred-api` | FRED API | rss | (deferred to post-V1 — see §13) | [finance] | — | — |

**Note on the FRED row.** Listed for visibility but `enabled = false` at seed time and adapter not implemented in V1. Deferred per §13 because it's a data-update shape, not an article shape, and deserves its own integration pattern post-launch.

**Note on quality scores.** All scores are initial guesses informed by editorial reputation, not empirical engagement data. Tunable post-launch when reader signal exists.

**Note on RSS feed URLs.** Several feed URLs above are confirmed via web search during scoping; others are best-effort from public source patterns. Validation happens in 12e.2 — sources whose feeds 404 or return malformed XML get flagged for replacement before full pipeline soak.

### 5.5 Phase 12f — Feed Ranking Algorithm (rules-based v1)

**Goal:** Given user profile + available events, return ranked list for the feed.

**Dependencies:** 12e done.

**Work:**
- New `feed_rankings` service: input `user_id` + filters → output ranked event IDs
- Scoring function:

```
score = sector_match_weight * sector_match
      + topic_match_weight * topic_match
      + freshness_weight * freshness_decay(age_hours)
      + source_quality_weight * primary_source_quality
      + corroboration_weight * sources_attached_count
      + content_quality_weight * quality_score
      + signal_rating_weight * signal_rating_v1
      - diversity_penalty * (count_of_same_sector_in_recent_window)
      - already_seen_penalty * (1 if in reading_history else 0)
```

  Note the new `corroboration_weight` term — events with more sources attached get a bump.
- Endpoint: `GET /api/v2/feed?limit=N&before_cursor=X&sectors=[]&filters=[]`
- Cursor-based pagination (event_id + score composite cursor).
- Excludes: already-seen-recently (last 7 days), hidden sources, blacklisted topics, events beyond user's tier daily allowance.
- Tests: scoring function unit tests, diversity behavior, pagination consistency, tier-limit enforcement, corroboration-weight effect.

**Estimate:** 1 session.

**Risk:** Low–medium. Tuning weights is ongoing.

**Explicitly deferred:** ML-based ranking — revisit only after 3+ months of behavioral data.

### 5.6 Phase 12g — Paywall Gating

**Goal:** Enforce tier differences. V1 launches with Free + Standard pricing tiers active; Premium pricing tier infrastructure exists but is dormant until V3.

**Pricing tiers (as implemented at V1):**
- **Free:** 10 events/day, role-neutral commentary only, email digest capped at 3 events
- **Standard ($8/mo):** 100 events/day, full personalization, depth tiers applied (Accessible/Briefed/Technical), full email (3–10 events), save/export, reading history
- **Premium ($15–20/mo):** infrastructure built, tier checks wired, but tier itself returns "Coming soon" at upgrade attempts. Activated at V3.

**Dependencies:** 12e and 12f done.

**Estimate:** 1–2 sessions.

### 5.7 Phase 12h — Payment Integration (Stripe)

**Goal:** Stripe subscription billing. **Legal-blocker phase** — entity, bank, ToS, privacy, refund all required before this can ship to production.

**Estimate:** 2 sessions.

### 5.8 Phase 12i — Daily Digest Email

**Goal:** Morning email with 3–10 personalized events (pricing-tier-dependent) as primary re-engagement mechanism.

**Estimate:** 1 session (existing `signal-email` queue extended).

### 5.9 Frontend Design Phases — 12j, 12k, 12l

When: After 12i is done, before private beta. Sequencing intentional — design after features means designing what actually exists.

**Phase 12j — Design System Foundation** (engineering-heavy, 2 sessions): tokens, primitives, Storybook, typography scale, accessibility primitives, motion primitives, responsive breakpoints.

**Phase 12k — Visual Language Pass** (design-heavy, 2 sessions): brand voice in UI, color system, spatial system, component polish, iconography, empty/loading/error states, information hierarchy patterns, **multi-source attribution UX** (refining the "Covered by SemiAnalysis, Bloomberg, +5 more" pattern landed in 12e.7a), SIGNAL rating UI.

**Phase 12l — Surface-by-Surface Application + Polish** (3–4 sessions): per-surface application, mobile responsiveness, accessibility audit, loading states, error states, empty states, performance audit, animation pass, cross-browser, frontend security pass.

### 5.10 V1 Launch Gate

Between finishing Phase 12l and starting V2:

**Private beta:** 20–50 invited users, all V1 pricing tiers enabled (Free + Standard), free acquisition paused. Stress-test pipeline, validate personalization, catch bugs, measure retention.

**Public launch:** depends on beta going well.

**Post-launch hotfix cluster:** reactive. Bugs from real users. Budget 2–4 sessions before V2 work starts.

---

## 6. V2 Engineering Detail

### 6.1 Phase 13a — Inline Glossary Infrastructure (2 sessions)

Tier-aware inline definitions of terms that appear in commentary. Terms target Accessible as the floor tier in most cases; Briefed sees parentheticals; Technical sees plain text.

### 6.2 Phase 13b — Concepts in Digest (1 session)

"Today's concepts to know" section in digest email — 3 dominant ideas of the day, anchored to illustrative events.

### 6.3 Phase 13c — SIGNAL Rating v2 (1–2 sessions)

**Cross-source corroboration is now native to the event model** — `event_sources` count IS the corroboration count. No separate `story_clusters` table needed.

- New rating formula: `base_v1_rating * (0.7 + 0.075 * min(event_sources_count, 4)) - 0.05 * negative_user_feedback_ratio`
- User feedback integration via `commentary_feedback` table (thumbs up/down on commentary).
- Source quality recalibration based on engagement signal.

---

## 7. V3 Engineering Detail

(Depth tier names use Accessible / Briefed / Technical throughout course content design. Pricing tier "Standard" stays as "Standard.")

- **Phase 14a — Course Platform Infrastructure** (3–4 sessions)
- **Phase 14b — Initial Course Content Production** (1–2 calendar months, parallelizable)
- **Phase 14c — Premium Tier Launch** (1 session)

---

## 8. V4 Engineering Detail

Posts attach to events as a new source type, threading into the existing event model.

- **Phase 15a — Posting Infrastructure** (2–3 sessions)
- **Phase 15b — Profile Pages** (1–2 sessions)
- **Phase 15c — SIGNAL Rating Extended to User Posts** (1 session)
- **Phase 15d — Admin Moderation Tools** (1–2 sessions)

---

## 9. V5 Engineering Detail

Comments attach to events and to user posts.

- **Phase 16a — Threaded Commenting Infrastructure** (2–3 sessions)
- **Phase 16b — Comment Moderation Infrastructure** (2–3 sessions)
- **Phase 16c — Comment Ranking** (1 session)

---

## 10. V6 Engineering Detail (Optional)

- **Phase 17a — Discovery Surface** (2–3 sessions)
- **Phase 17b — Advisor Surface** (optional, post-decision)

---

## 11. Parallel Tracks

- **Phase 18 — Team / Enterprise Product** (7–10 sessions over 2–3 calendar months)
- **Phase 19 — Data Layer** (15–25 sessions over 6–12 calendar months)

---

## 12. Pre-Launch Operational Work (parallel, non-engineering)

Domain purchase, SendGrid domain authentication, legal entity formation, business bank account, Stripe account, ToS / privacy / refund, trademark search on "SIGNAL" / "Valo", final pricing analysis (now informed by 12e Haiku-cost estimate of $80–150/day worst case).

---

## 13. Deferred / Dead / Parking Lot

### Resurrected
- **Phase 10 (learning product)** — was killed; resurrected as V2 (inline glossary) + V3 (course platform).

### Heavily deferred
- **Phase 11e (developer dashboard frontend)** — moved to post-Phase-19e
- **Phase 11f (public API docs)** — same reasoning

### Sources deferred from V1 (added during 12e scoping)
- **FRED API** — different shape (data-update, not article); deserves its own integration phase post-launch. Listed in `ingestion_sources` with `enabled = false` for visibility.
- **Bluesky firehose** — high noise, requires curated-account list and filtering layers we don't have.
- **GitHub trending / new releases** — adapter is its own engineering project.
- **OpenReview / Semantic Scholar / Papers with Code** — arXiv + Hugging Face Daily Papers cover the academic surface for V1.
- **Crypto sources (CoinDesk, The Block, Bankless)** — not in SIGNAL's stated three sectors. Add as a fourth sector post-launch if reader signal demands it.
- **Twitter/X API** — paid tier, defer until post-revenue.
- **WSJ, FT, The Economist, The Information** — paywall renders body extraction useless; relevance gate produces low-value enrichment.

### Still relevant
- **Worktree-creation diagnosis** — Claude Code's worktree-per-session feature continues at the new clone path. Periodic cleanup will recur until diagnosed. Brief follow-up session, not blocking 12e.
- **OneDrive path remnants** — `signal-app-12c\`, `sa-imr\`, home-dir signal-app tree pending stability confirmation.
- **Story detail reactions + share** — V4-adjacent.
- **`stories` table deprecation** — post-12e, post-launch. Currently kept for backward compatibility.

### Parking lot
- Response field additions, API key tiers, webhooks, GraphQL, monthly rollup summaries.

---

## 14. Carried-Forward Heuristics

### Engineering practice
- One session = one tight slice
- Ship less, ship better
- Diagnose before scoping; new cluster sessions open with discovery, not implementation
- Three-stage CC prompt sequence for non-trivial work: audit → implementation → merge
- Pre-decision tools beat prose questions when locking 2–4 product decisions
- Diagnostic queries before destructive ones; every DROP/DELETE preceded by inspection
- Permissions configuration is mid-project work, not setup work

### Architecture
- Timestamp-per-state > polymorphic boolean
- Fail-open for throttling, fail-closed for auth
- Personalization cache-first, generate on-demand; never regenerate cached unless a triggering event demands it
- Architecture continuity is a UX premise; expand affordances preserve framing
- GitHub secret scanners pattern-match on prefixes
- Docker caches lie

### From 12e scoping session (April 27, 2026)
- **Scope decisions cascade.** Source-count expansion (10 → 42) cascaded into adapter-pluralism (1 → 5 types), cadence pluralism (1 → 5 cron jobs), enrichment depth (1 → 5 Haiku calls), and a data-model addition (events alongside stories). One decision unlocked six others.
- **Cross-source duplication failure mode scales nonlinearly with source count.** At 10 sources, a major event = 5 duplicate rows (annoying). At 42 sources, the same event = 15–20 rows (product-breaking).
- **Per-adapter cadence beats single-cadence at >20 sources with mixed source rhythms.** SEC EDGAR (15-min business hours) and arXiv (daily 21:00 UTC) and HN (4-hour) want different polling.
- **Editorial bar drives source list.** "High-signal weighted vs broad-coverage" is a product decision, not engineering.
- **Bundled-tier enrichment risks tier collapse; facts-first + tier-specific calls solves it.** Distinct prompts per tier (sharing extracted-facts grounding) keep the tiers genuinely distinct.
- **Honest pushback over confidence.** Original scope doc made committed calls (RSS-only, no review queue, hourly cadence, tolerated duplication, single Haiku call) at 10-source scale. At 42-source scale, every one needed to be revisited — three retracted, two modified.

### From 12e.1 stage 1 audit (post-scoping)
- **Audit assumptions, not just code.** The scoping output assumed an `authors` table; the actual table is `writers`. The discovery audit caught it before stage 2 introduced a table-name conflict. Read-only audits earn their keep on assumption checks, not just on file inventory.
- **Don't reference docs that don't exist yet.** The kickoff prompt referenced `docs/roadmap/SIGNAL-roadmap.md` which wasn't in the repo. CC bounced it correctly; the roadmap had to be committed before stage 2 could ship the source seed. Generated artifacts (scope docs, source lists) need a home in the repo before downstream sessions cite them.
- **`stories` rename → `events` would have been a footgun.** The rename had non-obvious blast radius across `user_saves`, `comments`, `commentary_cache`, `learning_path_stories` FKs and every controller importing `schema.stories`. CC's "introduce as new table, dual-read during 12e, deprecate post-launch" is the lower-risk path.

### From workspace cleanup, Cluster 1.x, 12d sessions
(Inventory before action, three-stage CC sequence, diagnose before scope, environmental compounding is real, etc.)

### Product
- Cost governance is load-bearing. 12e Haiku worst-case estimate ($80–150/day) factors into pricing analysis directly.
- Content pipeline quality is editorial work disguised as engineering.
- Launch narrow and expand volume.
- Attribution must be prominent. Per-source writer seeding (12e) makes this structural, not cosmetic.
- Don't leak differentiators via the API until intentional.
- Design after features ship, not before.

---

## 15. Immediate Next Actions

In order:

1. **Phase 12e.1 stage 2 — implementation.** Migrations (0014 + 0015), source registry seed (42 paired source/writer rows), worker scaffolding under `backend/src/jobs/ingestion/`, CLAUDE.md note. Stage 2 kickoff prompt is the next paste.
2. **Phase 12e.1 stage 3 — merge.** PR open, gates green, merged.
3. **Phase 12e.2 onward** — generic RSS adapter, then heuristic + body fetch, then relevance gate, then enrichment, then additional adapters, then clustering and event-model write paths, then frontend, then admin status route + soak.
4. **Worktree-creation diagnosis** — its own brief session. Not blocking 12e.

Parallel from now: domain purchase, trademark search, legal entity research, pricing cost analysis (now informed by Haiku worst-case from 12e scoping).

---

## 16. Document Notes

**Calendar projection intentionally not included.** Sequence is locked; specific dates are not.

**Scope-shift acknowledgment:** Phase 12e expanded from 5–8 sub-sessions to 15 sub-sessions during the April 27, 2026 scoping session. Launch timeline shifts right by an estimated 6–8 weeks. Decision recorded with full cost visibility.

**Document owner:** Omar Elkhateeb
**Last updated:** April 27, 2026
**Review cadence:** After each major phase completion, or when scope changes materially.

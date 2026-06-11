# SIGNAL — Real-Time Signal Layer (spec)

> Status: **proposal / for review.** No code written. This closes the moat gap identified in the full-app audit: SIGNAL covers the *structured / slow* web (research, news, community, filings) but not the *fast / social / launch* layer (X takes, new repos, tool/startup launches) that a practitioner actually lives in. The goal is the morning-briefing vision — "this happened today, here's why it matters to **you**" — across **every** signal type, not just RSS news.

---

## 0. The gap, restated

| Signal the reader wants | Today | This spec |
|---|---|---|
| "X just happened in the news — why it matters to me" | ✅ RSS news | unchanged |
| "New research paper just dropped" | ✅ arXiv | unchanged |
| "New GitHub repo that solves \<problem\>" | 🟡 `github-trending-native` generator exists; verify/activate | **promote to first-class** |
| "New tool / Claude skill worth trying" | 🟡 `tool-spotlight-native` | **+ Product Hunt feed** |
| "What do we think of this startup / take" | 🟡 HN only | **+ Reddit (built, disabled) + X** |
| "Elon / Karpathy / the Fed just said this on X" | ❌ none | **NEW — the hard one** |
| "New startup just launched / raised" | ❌ none | **NEW — Product Hunt + funding RSS** |

The architecture is ready: each new signal is **one adapter + one card type**, not a rebuild. The redesign's content-type seam lights up new card shapes automatically.

---

## 1. How a new source plugs in (the reusable scaffolding)

Verified integration contract (Phase 12e ingestion pipeline):

1. **Adapter** — `backend/src/jobs/ingestion/adapters/<name>.ts` exporting an `AdapterFn`:
   ```ts
   type AdapterFn = (ctx: AdapterContext) => Promise<AdapterResult>; // { candidates: Candidate[] }
   ```
   Adapters are **pure of DB access** — fetch from the source, map to `Candidate[]` (`externalId`, `url`, `title`, `summary`, `publishedAt`, `contentHash`, optional `bodyText`, `rawPayload`). The worker persists.
2. **Adapter type** — only if a new *fetch mechanism* is needed. RSS-shaped sources (Product Hunt RSS, funding RSS) **reuse the existing `rss` adapter — no new type**. JSON-API sources (GitHub, X) add a value to `ingestionAdapterTypeEnum` (schema + migration) and `INGESTION_ADAPTER_TYPES`.
3. **Registry** — wire the adapter in `adapters/index.ts` (`REGISTRY[type] = adapterFn`). *(Reddit is already imported here but mapped to `null` — activation is flipping that one line.)*
4. **Seed sources** — a migration inserting `ingestion_sources` rows: `slug`, `adapter_type`, `endpoint`, `sectors`, `priority` (1=lab/SEC, 2=analyst, 3=news, 4=community), `fetch_interval_seconds`, `quality_score`, `config` (JSONB — e.g. the curated account allowlist for X).
5. **Card classification** — two routes:
   - **Ingested-but-distinct** → set a `content_type` in `writeEvent.ts` keyed off the source's adapter type (exactly how `'filing'` works today), then add the type to `deriveCardType` + a treatment in `StoryExhibit` + a brand label.
   - **Editorialized** → a native generator (like `github-trending-native`) where SIGNAL *authors* a spotlight. Better UX for "here's a repo and why it matters."
6. **Free reuse** — heuristic filter → LLM relevance gate → fact extraction → tier/commentary generation (the per-reader "why it matters to you") → embedding + **cross-source clustering** → ranking. Every new source inherits all of it, including dedup (a tweet + a news article about the same event cluster into one MULTI-SOURCE card).

**Implication:** Layer 1 (ranking) and Layer 2 (personalized explanation) already work for any candidate. The new work per source is: the adapter, the seed rows, the card treatment, and — see §4 — prompt/ranking tuning for *format*.

---

## 2. Per-source specs

### 2A. GitHub repos — "WORTH AN AFTERNOON" / "SHIPPED" 🟢 free
- **Want:** "new repo that makes your cloud not forget memory."
- **Source:** GitHub REST `GET /search/repositories?q=topic:{ai|llm|inference|...}+created:>{date}&sort=stars` (also stars-velocity for "trending"). Authenticated: 5,000 req/hr — ample.
- **Build:** `github-trending-native` generator already exists — **first verify it's producing**; if dormant, activate + broaden its topic list per sector. Optionally add a direct `github_api` adapter for raw repo items, but the *native spotlight* route is the better UX (it explains the repo, which is the moat).
- **Card:** `WORTH AN AFTERNOON` (exists). "Why now for you" hook.
- **Cost/risk:** none.

### 2B. Product Hunt + tool/startup launches — "THE LAUNCH" 🟢 free
- **Want:** "new tool / Claude skill / startup that just solved \<problem\>."
- **Source:** Product Hunt **RSS** (`producthunt.com/feed`) → **reuse the `rss` adapter, zero new adapter code.** (Or the PH GraphQL API for richer metadata later.)
- **Build:** seed PH as an `rss` source with a sector tag + `content_type='launch'` set in `writeEvent` for PH-origin events (or a dedicated `producthunt` slug the writer keys on).
- **Card:** **NEW `THE LAUNCH`** — product-style: name, one-line "what it does," "the problem it solves," "why it's relevant to your role." `content_type: 'launch'`.
- **Cost/risk:** none.

### 2C. Reddit — community sentiment → "PRACTITIONER BRIEF" 🟢 free (low volume)
- **Want:** "what do we think about this," practitioner threads.
- **Source:** Reddit OAuth API. **Adapter already written** (`adapters/reddit.ts`); registry maps `reddit_api: null`.
- **Build:** (1) flip `reddit_api: redditAdapter` in `adapters/index.ts`; (2) seed subreddits per sector (e.g. `r/MachineLearning`, `r/LocalLLaMA`, `r/hardware`, `r/semiconductors`, `r/investing`); (3) the existing HN-synthesis pattern (`hn-synthesis-native`) extends to a Reddit community brief.
- **Card:** `PRACTITIONER BRIEF` (exists) — community-synthesis variant.
- **Cost/risk:** Reddit's 2023 API pricing applies above free thresholds; low-volume read for a curated subreddit set stays free. Confirm current terms before enabling.

### 2D. X / Twitter — "THE TAKE" 🔴 the hard, paid one
- **Want:** "Elon / Karpathy / the Fed / SemiAnalysis just said this — why it matters to you."
- **The product decision: a curated ALLOWLIST, not the firehose.** ~100–150 vetted high-signal accounts per sector (labs, execs, researchers, quants, analysts). The allowlist *is* the quality gate — it's also the moat applied to real-time (anyone can read X; nobody tells *you* why a specific take matters to *your* role).
- **Source options (pick one):**
  - **X API v2 "Basic"** — ~$200/mo, ~10k post reads/mo. Poll allowlist user timelines a few times/day. The legitimate path; stable; ToS-clean.
  - **Bright Data** (plugin already connected) — cheaper/broader scraping, but **ToS-gray** and brittle. Acceptable for an MVP, riskier for a real business.
- **Build:** new `x_api` adapter type; adapter reads the allowlist from `ingestion_sources.config`; one source row per sector (or per curated list). Steep `fetch_interval` (e.g. 15–30 min) for the real-time feel.
- **Card:** **NEW `THE TAKE`** — compact quote treatment: author + handle, the take verbatim, then the personalized "why this matters to you." `content_type: 'take'`.
- **Personalization caveat:** a 280-char take has no article body — the "why it matters" leans on *author authority + the claim*, not a long-form summary. See §4.
- **Ranking caveat:** a take is stale in hours — needs a steep freshness decay. See §5.
- **Cost/risk:** $200/mo (API) or scraping infra; ToS exposure with scraping; curation labor for the allowlist.

### 2E. Funding / startup depth — "THE LAUNCH" (shared) 🟡 free→paid
- **Want:** "new startup just raised / launched."
- **Source now:** funding RSS (TechCrunch, Axios Pro Rata, sector newsletters) → reuse `rss` adapter; HN "Show HN" filter on the existing HN adapter.
- **Source later:** Crunchbase API (paid) for structured funding data.
- **Card:** `THE LAUNCH` (shared with 2B).
- **Cost/risk:** RSS free; Crunchbase deferred (paid).

---

## 3. New card types (frontend)

Add to `deriveCardType` (`lib/feedCardType.ts`) + a treatment in `StoryExhibit`:

| Type | Trigger | Treatment |
|---|---|---|
| **THE TAKE** | `content_type='take'` (X) | Compact quote card: author + handle + avatar, verbatim take, fast-decay freshness, "why it matters to you" lead |
| **THE LAUNCH** | `content_type='launch'` (PH / funding) | Product card: name, one-liner, "problem it solves," "why now for your role" |
| **SHIPPED** (optional) | `github-*` | Repo card: lang, stars, "what it does in one line" — or keep under WORTH AN AFTERNOON |

These compose with the existing THE CONNECTION / RESEARCH READ / PRACTITIONER BRIEF / EARNINGS / MULTI-SOURCE / DISPATCH. **This is also what finally makes the redesign's variety real on live data** — today the stream is DISPATCH-heavy because the sources are homogeneous.

---

## 4. Personalization across formats (Layer 2 — the moat)

The per-reader "why it matters to you" must read right for **heterogeneous content lengths**:
- **Long-form** (paper, filing, article): summary-led, as today.
- **Short-form** (a take, a repo, a launch): there's no article body. The fact-extraction + tier-generation prompts need a **`format` signal** so the model leans on *the claim + the author's authority + the reader's role* instead of summarizing a body that doesn't exist.
- **Action-oriented** (repo, tool, skill): the hook should be "what you can *apply* this toward" — the user's exact phrasing — not just "why it matters." Consider a per-type hook template (`why_it_matters` vs `what_to_do_with_it`).

**Work:** thread a `content_format` (long | short | tool) from the adapter → candidate → fact seam → the Haiku prompt. Modest, but required for quality — a tweet explained like a paper reads wrong.

---

## 5. Ranking across velocities (Layer 1)

The 12f `effective_score` has a freshness bonus + EDGAR penalty. Real-time signals need **per-content-type freshness curves**:
- **Takes:** steep decay (half-life hours) — a take from this morning, not yesterday.
- **Launches / repos:** medium (days).
- **Papers / filings / news:** current behavior (slower).

Plus a **source-priority slot** so a high-authority take (priority 2 analyst) outranks a low-signal one, and a **per-type diversity cap** so the morning briefing is a *mix* (a take, a repo, a paper, a launch, news) rather than 10 takes. The diversity-cap machinery already exists (`feed/diversityCap`); extend it to balance by content type.

---

## 6. Quality & noise control

- **X:** the curated allowlist is the gate — no firehose, no engagement-bait. Curation is ongoing human work.
- **Reddit/HN:** existing heuristic + LLM-relevance filters apply unchanged.
- **Dedup:** cross-source embedding clustering already merges the same event across sources → a take + a news article + a Reddit thread about one event become a single MULTI-SOURCE card with the take attached. This is a feature: it's the "all of it in one place" promise realized.
- **Spam/low-signal launches:** PH/funding need a minimum-traction threshold (upvotes / raise size) in the heuristic seam.

---

## 7. Phasing & cost

| Phase | Sources | New adapters | Cost | Outcome |
|---|---|---|---|---|
| **A** | GitHub (verify/activate), Product Hunt (RSS), Reddit (flip on) | 0–1 (PH reuses RSS; Reddit exists) | 🟢 $0 | Morning feed becomes heterogeneous: news + repo + tool + community + research. Proves multi-source briefing. |
| **B** | **X curated allowlist** | 1 (`x_api`) | 🔴 ~$200/mo or scraping | The real-time "THE TAKE" layer — the emotional core of the gap. |
| **C** | Funding RSS, Crunchbase | 0 now (RSS) / later | 🟡 free→paid | Startup/funding depth. |

**Recommended order: A → B → C.** Phase A is near-zero-cost and is where the feed *visibly* becomes the vision; it also de-risks Phase B (prove the briefing works before paying for X).

---

## 8. Open decisions (need your call before building)

1. **X access:** X API Basic ($200/mo, clean) **vs** Bright Data scraping (cheaper, ToS-gray)? Or defer X entirely until Phase A proves out?
2. **Curated allowlists:** who's on the X account list and the subreddit list, per sector? This is human curation — I can draft a starter list per sector for your edit.
3. **GitHub:** is `github-trending-native` currently producing in prod? (Determines verify-vs-build for 2A.)
4. **Budget ceiling** for paid sources (X, later Crunchbase).
5. **New hook template:** add a `what_to_do_with_it` variant alongside `why_it_matters` for action-oriented types (repos/tools/skills)? (Your "what you can apply this toward.")

---

## 9. What does NOT change

- Both personalization layers (ranking + per-reader explanation) — already built, reused wholesale.
- The redesign card system — new types slot into the existing seam.
- The paywall, tiers, digest, auth — untouched.
- Instagram / TikTok are **out of scope** — low signal-to-noise for this audience and no clean ingestion path; the practitioner's real-time layer is X + GitHub + Reddit + launches, not short-form video.

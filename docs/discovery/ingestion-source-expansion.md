# Ingestion Source Expansion — Plan & Source Slate

**Status:** planning → build (Tier 0 first)
**Date:** 2026-06-08
**Owner:** Omar + Claude
**Supersedes:** the `ingestion_source_strategy.md` memory note (decisions captured here in durable form)

---

## 0. Goal

Widen the top-of-funnel so the feed has *enough true signal per day* across the three sectors (AI, Finance, Semiconductors) to deliver "the 10 stories that matter" — without dropping low-quality noise at the top. **Every new source is subject to the existing feed ranking + diversity cap**, so breadth never costs us the front page. Adding sources is mostly a seeding exercise, not a rewrite — the 12e pipeline already does fetch → candidate → relevance/heuristics → facts → tier commentary → embedding → cluster-dedup → write.

The guiding rule Omar set: **"don't let dumb stuff sit at the top."** That is enforced structurally (see §5), not by withholding sources.

---

## 1. What's live today (baseline)

**Adapter framework** (`backend/src/jobs/ingestion/adapters/`) — raw source → candidate rows:

| adapter_type      | status      | what it pulls |
|-------------------|-------------|---------------|
| `rss`             | ✅ active   | any RSS/Atom feed (the workhorse — zero code per new feed) |
| `arxiv_atom`      | ✅ active   | arXiv category feeds |
| `sec_edgar_json`  | ✅ active   | SEC EDGAR filings (10-K/10-Q/8-K → `content_type='filing'`) |
| `hackernews_api`  | ✅ active   | HN top/best stories |
| `github_api`      | ✅ active   | GitHub Search API (trending repos → WORTH AN AFTERNOON) |
| `reddit_api`      | ⚠️ **stub** | throws "not yet implemented" — registry slot is `null` |
| `native_generator`| ✅ active   | no poll; AI-authored posts via the generator registry |

**Native generators** (`generators/index.ts`) — Haiku-authored editorial posts (7): HN repo discovery, arXiv weekly synthesis, HN community synthesis, EDGAR earnings reaction, semiconductor supply-chain synthesis, cross-sector causal chain, tool spotlight.

**Seeded RSS sources today** (from migrations 0014/0034/0035/0041 + `fixBrokenSources` registry):
- **AI labs/news:** Anthropic, Meta AI, The Batch (deeplearning.ai), HuggingFace Papers
- **Semis:** AMD, ASML, Intel, TSMC newsrooms
- **Finance/policy:** Reuters Business, BIS press (Bureau of Industry & Security — export controls), Money Stuff (paywalled → disabled)

> **Correction (2026-06-08 live audit).** An earlier draft claimed OpenAI/DeepMind/Perplexity were "absent" — that was an inference error from reading the `fixBrokenSources` *repair-list* as the live-source list. The real `ingestion_sources` table holds **~40 enabled sources**. `openai-news`, `deepmind-blog`, `google-research`, `nvidia-newsroom`, `fed-press`, and the two SEC EDGAR feeds are all **live and healthy** (last success 2026-06-08). The feed is **not** source-starved.
>
> The real gap was **9 high-value feeds disabled with `fails=663, lastOK=NEVER`** — seeded but never once worked: `anthropic-news`, `meta-ai-blog` (both p1 labs), `bis-press` (export controls), `huggingface-papers`, `amd/asml/tsmc-newsroom`, `the-batch`, `reuters-business`. See §3 Tier 0 for what was recoverable.
>
> **Genuinely absent (net-new, still wanted):** macro/rates data (FRED) · SEC Form D · Bluesky · YouTube/podcast transcripts · a live Reddit · Perplexity (no public RSS — needs a bridge).

---

## 2. Architecture we build on (so each addition has a known shape)

There are exactly **four shapes** a new source can take. Every item in §3 is tagged with one:

- **[RSS]** — a feed exists → **zero code**, just insert an `ingestion_sources` row (`adapter_type='rss'`, endpoint, sectors, priority, quality_score). The bulk of the free wins.
- **[ADAPTER]** — no feed, but a clean API/JSON → a new `adapter_type` enum value + an adapter fn in `adapters/` + registry wire-up. Small, self-contained.
- **[GENERATOR]** — we don't want the raw item as a card; we want a *synthesized* post from it (e.g. a long podcast → a DISPATCH brief) → a new `NativeGenerator` in `generators/`. Reuses the Haiku author path.
- **[DEFER]** — real engineering or paid/ToS-blocked → parked with a reason.

Every source carries `priority` (1=lab/SEC, 2=analyst, 3=news, 4=community) and `quality_score` (0–10), which feed ranking + dedup. New sources default conservatively (community → priority 4).

---

## 3. The source slate (what we're adding)

### Tier 0 — Resurrect dead feeds — **DONE 2026-06-08**

Tier 0 turned out to be a *repair* job, not an *add* job (see §1 correction). The live audit found OpenAI/DeepMind already healthy; the win was reviving disabled p1 feeds via the `fixBrokenSources` probe.

| feed | outcome | endpoint |
|------|---------|----------|
| **amd-newsroom** (p1 semis) | ✅ **resurrected** | `ir.amd.com/rss/news-releases.xml` |
| **meta-ai-blog** (p1 lab) | ✅ **resurrected** | `research.facebook.com/feed/` |
| **bis-press** (p1 export controls) | ✅ **resurrected + upgraded** | Federal Register BIS API RSS (`/api/v1/documents.rss?conditions[agencies][]=industry-and-security-bureau`) — the rulemaking/enforcement primary, replacing the dead `bis.doc.gov` press feed |
| **intel-newsroom** (p1) | ✅ re-confirmed | `newsroom.intel.com/feed/` |
| **money-stuff** (p2 finance) | ⚠️ regression caught + fixed | `--apply` wrongly disabled this *healthy* source (empty `CANDIDATE_URLS` → disable). Re-enabled; removed from the repair registry so it can't recur. |

**Genuinely dead — no working public RSS (left disabled, need a bridge/alt later):** `anthropic-news` (lab — high value, no RSS), `asml-news`, `tsmc-newsroom` (anti-bot 403), `the-batch` (404/500), `huggingface-papers` (401; the blog feed works but is title-only → rejected by the body seam), `reuters-business` (Reuters killed public RSS).

**Lesson:** `fixBrokenSources --apply` disables any slug whose candidates all fail — including currently-healthy sources listed with empty candidates. Audit live state first; never list a working source in the repair registry.

### Tier 1 — New adapters — small, self-contained builds

| source | shape | sectors | priority | notes |
|--------|-------|---------|----------|-------|
| **SEC Form D** (private placements / VC & PE raises) | [ADAPTER] | finance, ai, semis | 1 | **the Crunchbase replacement.** Form D is the official "we raised a round" filing. Likely an extension of `sec_edgar_json` (different form-type filter) rather than a brand-new adapter. Maps to `content_type='filing'` / THE LAUNCH-adjacent treatment. |
| **FRED macro series** (rates, CPI, unemployment, etc.) | [ADAPTER] | finance | 2 | new `fred_api` adapter; free API key. Each release → a compact data card (filing-style). Pick a small, high-signal series set (§7). |

### Tier 2 — New generator — authored long-form synthesis

| source | shape | sectors | priority | notes |
|--------|-------|---------|----------|-------|
| **YouTube / podcast transcripts (Dwarkesh first)** | [GENERATOR] | ai, finance, semis | 2 | Omar's favorite. We do **not** post the raw transcript — a generator fetches the transcript and authors a DISPATCH-style "what was said + why it matters" brief. Needs a transcript source (§7). Start with a hand-curated channel list (Dwarkesh, then expand). |

### Tier 3 — Real builds — deferred (not blocking launch)

| source | shape | reason deferred |
|--------|-------|-----------------|
| **Reddit** | [ADAPTER] (finish stub) | the stub throws; needs OAuth, a fixed subreddit list, top-of-day-above-threshold, ~4h cadence. Community-priority (4). Worth doing, but after Tier 0–2. |
| **X / Twitter** | [DEFER] | **paid API.** Park until there's budget; highest-noise source so it must land *after* ranking is proven on calmer sources. |

### Parked / rejected (with reasons — don't re-litigate without a trigger)

- **Crunchbase** — cost; **replaced by SEC Form D**, which is the primary-source version of the same signal.
- **Instagram / TikTok** — no clean API; scraping is a ToS/stability risk. *(Open question §7: is a sanctioned scraper ever worth it? Default: no.)*
- **LinkedIn** — no usable API + aggressive anti-scraping. Hard park.

---

## 4. The "what does an EDGAR/Form D/FRED card look like" question

These are **data-led cards** (`content_type='filing'`), already a first-class card type in the redesign-v2 feed (EARNINGS/SEC). Form D and FRED reuse that treatment: reader-friendly title (the #86 humanizer pattern — "Anthropic — new financing (Form D)"), a plain-English excerpt, and the data point. No new card type needed.

---

## 5. Ranking & quality guardrails (the "no dumb stuff at the top" guarantee)

Breadth is safe because four mechanisms sit between ingestion and the front page:

1. **`priority` (1–4)** — community sources (Bluesky, Reddit, X) are priority 4; on a cluster match they never outrank a lab/SEC primary.
2. **`quality_score`** — per-source multiplier into `effective_score`.
3. **Diversity cap** (the Batch 4 work) — per-source + per-content-class caps prevent any one noisy source from flooding a run.
4. **Cluster dedup** (12e.6) — the same event from 5 sources collapses to one card with the highest-priority primary.
5. **Engagement signal** (the 3D work) — once data flows, click-through/share feed back into the score, so genuinely-read sources rise and ignored ones sink automatically.

**New-source default:** start `enabled=true` but `priority=4`, `quality_score` low, and watch the admin status route before promoting. A bad source is one `UPDATE ingestion_sources SET enabled=false` away.

---

## 6. Per-source seeding recipe (the repeatable checklist)

To add any [RSS] source:
1. Insert a migration `NNNN_phaseXY_<slug>_source.sql` → `INSERT INTO ingestion_sources (...)`.
2. Fields: `slug`, `display_name`, `adapter_type='rss'`, `endpoint`, `sectors[]`, `priority`, `quality_score`, `fetch_interval_seconds`, `config` (incl. `contentType` if filing/launch), optional `paired_writer_id`.
3. Run `fixBrokenSources --dry-run` to confirm the endpoint resolves to a real feed (it probes candidates).
4. `npm run run-ingestion-poll -- --slug=<slug>` once to smoke a real pull.
5. Watch the admin status route for first-success + relevance pass-through.

[ADAPTER]/[GENERATOR] add a code step (enum value + adapter/generator fn + registry wire + tests) ahead of seeding — but the seeding recipe is identical.

---

## 7. Open questions (need an answer before the relevant tier)

1. **Bluesky bridge** — which path? (a) `openrss.org`/`rss.app` style bridge on a curated author list, (b) Bluesky's own `app.bsky.feed` API via a small adapter (more robust, more code), or (c) a firehose sampler. *Default proposal: start with a curated-author RSS bridge (Tier 0), upgrade to an API adapter later if signal is good.*
2. **Podcast/YouTube transcripts** — source + cost? YouTube auto-captions (free, scrape-ish), a transcript API, or Whisper on the audio (compute). *Default proposal: start with YouTube caption fetch for a hand-picked channel list; Dwarkesh first.*
3. **FRED series set** — which indicators? *Default proposal: Fed funds rate, CPI, 10Y treasury, unemployment, PCE — finance-sector only, low cadence.*
4. **IG/TikTok** — confirm hard-park, or is there a sanctioned-scraper appetite? *Default: hard-park.*

---

## 8. Proposed build order

1. ✅ **Tier 0 — resurrect dead feeds** (amd, meta, bis-press→Federal Register; intel re-confirm; money-stuff regression fixed). *(done 2026-06-08)*
2. **SEC Form D adapter** — extends EDGAR; highest-value net-new signal (private-capital intent).
3. **FRED adapter** — macro data cards. (A disabled `fred-api` placeholder row already exists, mis-typed as `rss`; the real build adds a `fred_api` adapter.)
4. **Dwarkesh/transcript generator** — the authored-synthesis path.
5. **Reddit** — finish the stub (a `reddit-finance` placeholder row already exists, disabled).
6. **Bluesky** + **Anthropic/Perplexity via RSS bridge** — community/bridge sources once a bridge path is chosen (§7 Q1).
7. *(parked)* X, IG/TikTok, LinkedIn.

Each step is independently shippable, tested, and gated; none blocks 12h (Stripe), which remains the real launch gate.

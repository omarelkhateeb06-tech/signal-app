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
| **SEC Form D** (private financings) | [ADAPTER] | ai, finance, semis | 1 | ✅ **SHIPPED 2026-06-08.** New `sec_form_d` adapter (not an extension — it's a *discovery* stream, unlike the CIK-watch `sec_edgar_json`). See "Form D notes" below. |
| **FRED macro series** (rates, CPI, unemployment, etc.) | [ADAPTER] | finance | 2 | ✅ **SHIPPED 2026-06-10.** New `fred_api` adapter; series set = FEDFUNDS / CPIAUCSL / DGS10 / UNRATE / PCEPI. See "FRED notes" below. |

**Form D — build notes & the volume reality (learned from live data).** Form D is a firehose (~190 filings/day) that is mostly real-estate / EB-5 / generic LP-fund / SPV noise. The adapter discovers recent filings via EDGAR full-text search (EFTS), fetches each filing's `primary_doc.xml`, and pre-filters on **(a)** industry group ∈ operating-tech only (Computers / Other Technology / Telecommunications / Manufacturing — fund categories deliberately excluded; a live sample was ~85% LP/SPV noise) and **(b)** a **disclosed** offering ≥ $5M (null / "Indefinite" / 0 dropped — no size signal). The Haiku relevance gate then assigns the ai/finance/semis sector and rejects what's still off-topic. Net: a **precision source, ~1–2 candidates/day pre-gate, not a firehose** — it surfaces the occasional genuine "operating company raised $X" scoop. All knobs (`minOfferingUsd`, `industryAllowlist`, `maxFilings`, `lookbackDays`) live in the source `config`, so widening coverage (lower the floor, re-add fund categories) is a data change, not a code change. `content_type='filing'` → EARNINGS/SEC card. SEC fair-access respected (descriptive UA, 150ms inter-request, transient-5xx retry).

**FRED — build notes.** Not a stream of articles: each configured series yields at most **one candidate per poll** (its latest reading), so a release becomes a single compact data card; re-polls re-emit and the candidate-row dedup (`externalId = SERIES:date`) drops them, same as the RSS adapters. Two requests per series — `/series` metadata (title, units, frequency, and `last_updated`, which doubles as `publishedAt` and the stale-series gate) and `/series/observations` (desc, limit 15). The index-level series (CPI, PCE) headline the **YoY % change** ("CPI Inflation: 2.4% YoY (May 2026)") since a raw index level means nothing to a reader; missing YoY baseline falls back to metadata-driven generic presentation. `bodyText` carries the last ~6 readings + provenance so the body seam never fetches the chart-chrome FRED page. Config knobs (`seriesIds`, `lookbackDays`) live in source `config`; **lookbackDays=45, not 14** — monthly series publish ~2–6 weeks after the observation period, so a 14-day bound would drop current readings for most of each cycle. Requires `FRED_API_KEY` (free, email-registration); logs-and-skips when unset (native-scheduler pattern), and the key rides in query strings so logs carry series IDs, never URLs. Migrations 0052 (enum value) / 0053 (repoint the 0014 placeholder row: `rss`→`fred_api`, enable, priority 2, quality_score 8). `content_type='filing'` → EARNINGS/SEC card.

### Tier 2 — New generator — authored long-form synthesis

| source | shape | sectors | priority | notes |
|--------|-------|---------|----------|-------|
| **YouTube / podcast transcripts (Dwarkesh first)** | [GENERATOR] | ai, finance, semis | 2 | ✅ **SHIPPED 2026-06-10.** Five `youtube-*-native` generator instances (Dwarkesh, Asianometry, TechTechPotato, No Priors, Acquired). See "YouTube dispatch notes" below. |

**YouTube dispatch — build notes.** One NativeGenerator **instance per channel** (factory over `YOUTUBE_CHANNELS` in `generators/youtubeTranscript.ts`; the registry is one-slug-per-generator, and per-channel source rows give independent dedup spaces + enable/disable). Per run each channel authors **at most one** DISPATCH brief from its newest qualifying upload: Data API v3 (`channels?forHandle` → uploads playlist → `playlistItems` → `videos` duration check, ~4 quota units/channel/run) qualifies uploads inside a 7-day window, above a 10-minute duration floor (kills Shorts/clips), and not already posted (`external_id = youtube:{videoId}`). Captions come from the **unofficial timedtext endpoint** (`kind=asr` then manual-track fallback) — when it yields under 500 chars the brief is authored **description-only**, and the prompt instructs Haiku to DECLINE when the description can't support something concrete (same skip-JSON contract as toolSpotlight). We never post the raw transcript. Card brand: **DISPATCH** (5 slug entries in `feedCardType.ts` `GENERATOR_TYPE`); illustration archetype falls back to `signal`. Migration 0054 seeds the five source rows (0042's native shape: SIGNAL writer, priority 2, quality 7, interval 0). Requires `YOUTUBE_API_KEY` (free Google Cloud read quota) — logs-and-skips per channel when unset; key rides in query strings so logs carry handles, never URLs. Known risk, accepted for v1: timedtext is unofficial and increasingly gated — the description-only mode is the designed degradation, and `yt-dlp` in the Railway image is the documented upgrade path if caption coverage gets bad.

### Tier 3 — Real builds — deferred (not blocking launch)

| source | shape | reason deferred |
|--------|-------|-----------------|
| **Reddit** | [ADAPTER] (finish stub) | the stub throws; needs OAuth, a fixed subreddit list, top-of-day-above-threshold, ~4h cadence. Community-priority (4). Worth doing, but after Tier 0–2. **← next on the track.** |
| **Bluesky** | [ADAPTER] (`bluesky_api`) | **the zero-code RSS bridge is NOT viable — verified 2026-06-10 (see §7 Q1 below).** A real build needs an AT-Protocol adapter that carries the post text as `bodyText` (HN-self-post pattern) **plus** a per-source exemption from the 500-char body floor, and a design call on whether 300-char takes are standalone cards or a trending/clustering signal. Tier-3, deferred. |
| **X / Twitter** | [DEFER] | **paid API.** Park until there's budget; highest-noise source so it must land *after* ranking is proven on calmer sources. |

### Parked / rejected (with reasons — don't re-litigate without a trigger)

- **Crunchbase** — cost; **replaced by SEC Form D**, which is the primary-source version of the same signal.
- **Anthropic news via RSS bridge** — *parked 2026-06-10 (verified):* Anthropic exposes no native RSS (`/rss.xml`, `/news/rss`, `/feed.xml` → 404; `/news` is HTML only) and `openrss.org` does not auto-generate a feed for arbitrary URLs (it serves its own HTML landing page, which the adapter rejects as `wrong_content_type`). A real bridge needs a paid/account scraper (rss.app) or a self-hosted one — fragile single-source dependency, not worth it now. Revisit if Anthropic ships a feed or we already run a scraper for another reason.
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

1. ~~**Bluesky bridge** — which path?~~ — *resolved 2026-06-10: the RSS-bridge path (a) is DEAD on arrival. Two hard blockers, verified against the live code + endpoints: (i) the heuristic body seam requires extracted article text ≥ `BODY_LENGTH_FLOOR_CHARS` (500), and a Bluesky post is capped at 300 chars; (ii) a Bluesky RSS item's `<link>` is the `bsky.app` post permalink, a JS app shell from which `@mozilla/readability` extracts ~nothing → `body_parse_error`/`body_too_short`. So a plain `rss` source over Bluesky just manufactures failing candidates. The only real path is (b) a `bluesky_api` AT-Protocol adapter that carries the post text as `bodyText` (HN-self-post pattern) AND adds a per-source body-floor exemption — Tier 3, deferred. Open sub-question for that build: is a 300-char take a standalone enriched card, or better consumed as a trending/clustering signal? Likely the latter. Anthropic-via-bridge is separately parked (no native RSS; openrss serves HTML, not a feed) — see Parked/rejected.*
2. ~~**Podcast/YouTube transcripts**~~ — *resolved 2026-06-10: shipped with the default proposal — Data API v3 listing + timedtext caption fetch, hand-picked 5-channel roster (Dwarkesh / Asianometry / TechTechPotato / No Priors / Acquired), description-only fallback when captions are unavailable. Whisper/yt-dlp remain the upgrade path if timedtext coverage degrades.*
3. ~~**FRED series set**~~ — *resolved 2026-06-10: shipped with the default proposal (FEDFUNDS, CPIAUCSL, DGS10, UNRATE, PCEPI — finance-sector only, hourly poll with dedup). Series set is a `config.seriesIds` data change to widen.*
4. **IG/TikTok** — confirm hard-park, or is there a sanctioned-scraper appetite? *Default: hard-park.*

---

## 8. Proposed build order

1. ✅ **Tier 0 — resurrect dead feeds** (amd, meta, bis-press→Federal Register; intel re-confirm; money-stuff regression fixed). *(done 2026-06-08)*
2. ✅ **SEC Form D adapter** — new `sec_form_d` discovery adapter, operating-tech + disclosed-size pre-filter, content_type='filing'. *(done 2026-06-08)*
3. ✅ **FRED adapter** — macro data cards (FEDFUNDS/CPIAUCSL/DGS10/UNRATE/PCEPI), migrations 0052/0053, `FRED_API_KEY`-gated. *(done 2026-06-10)*
4. ✅ **Dwarkesh/transcript generator** — five `youtube-*-native` DISPATCH generators, migration 0054, `YOUTUBE_API_KEY`-gated. *(done 2026-06-10)*
5. **Reddit** — finish the stub (a `reddit-finance` placeholder row already exists, disabled). **← next**
6. ~~**Bluesky** + **Anthropic/Perplexity via RSS bridge**~~ — *RSS-bridge path retired 2026-06-10 (see §7 Q1 + Parked/rejected). Bluesky returns only as a Tier-3 `bluesky_api` adapter if/when the design call is made; Anthropic returns only if it ships a real feed.*
7. *(parked)* X, IG/TikTok, LinkedIn.

Each step is independently shippable, tested, and gated; none blocks 12h (Stripe), which remains the real launch gate.

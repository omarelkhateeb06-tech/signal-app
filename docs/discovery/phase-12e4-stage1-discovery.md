# Phase 12e.4 — Stage 1 discovery audit

**Date:** 2026-04-28
**HEAD at audit:** `485e93f feat(ingestion): Phase 12e.3 — heuristic filter + body fetch + enrichment dispatch (#50)`
**Scope:** read-only discovery for the LLM relevance gate; recency investigation folded in (per the 12e.3 smoke's 97% recency rejection observation).

## Pre-flight

- **CWD:** `C:\dev\signal-app` ✓
- **Branch:** `main`, clean working tree ✓
- **HEAD:** `485e93f` (PR #50 squash-merge) ✓
- **Prior docs read:** roadmap `docs/roadmap/SIGNAL-roadmap.md` §5.4 (12e.0 through 12e.5c verbatim), `docs/discovery/phase-12e3-stage1-discovery.md`, `docs/discovery/phase-12e3-smoke-test.md`, `backend/src/db/schema.ts`.

## A. Roadmap spec read

### Verbatim spec for 12e.4

> **#### 12e.4 — LLM relevance gate (~1 session)**
>
> One Haiku call per heuristic-survivor with structured-JSON output: `{ relevant: bool, sector: enum, reason: string }`. Status advances to `llm_relevant` or `llm_rejected`. First 100 calls' I/O logged for prompt-quality audit before turning the cron loose.

### What the roadmap commits to

- **One Haiku call per heuristic-survivor** (no batching). Per §12e.0 #5, that's call #1 of the 5-call enrichment chain (relevance → fact extraction → 3× tier).
- **Structured-JSON output** with three fields: `relevant: bool`, `sector: enum`, `reason: string`.
- **Status enum values mentioned:** `llm_relevant` (positive), `llm_rejected` (negative).
- **Observability gate:** "First 100 calls' I/O logged for prompt-quality audit before turning the cron loose." This is a prompt-quality acceptance criterion — 12e.4 ships the gate; the audit/refinement window is on the user-side review of those 100 logs before cron is enabled (12e.5c).
- **Model:** roadmap doesn't pin a Haiku model id, but CLAUDE.md §3 and the existing `haikuCommentaryClient.ts` lock to `claude-haiku-4-5-20251001` (dated string). The relevance gate is request-path; the dated pin is the right fit.

### Boundaries

- **Inherits from 12e.3:** rows at `status='heuristic_passed'` with `body_text` populated (and possibly `status_reason='body_truncated'` informational).
- **Hands off to 12e.5a:** rows that get `relevant: true` advance to … `enriching` (per current schema) or `llm_relevant` (per roadmap; not in schema yet). Either way 12e.5a fact extraction reads from that state.

### Cost / rate-limit guidance

Roadmap §12e.0 #5 mentions "Total 5 Haiku calls per surviving candidate including the relevance gate" but doesn't quantify rate limits. §12e.0 #8 names a kill switch on rejection-rate >80% over trailing 24h with a 50+ candidate floor — relevant to ingestion as a whole, not just 12e.4. No explicit retry policy specified in the roadmap.

## B. Schema state (post-0017)

### Current `ingestion_candidate_status` enum (verified live in §F's diagnostic DB)

```
{discovered, heuristic_passed, heuristic_filtered, llm_rejected, enriching, published, duplicate, failed}
```

- `llm_rejected` is present ✓
- `llm_relevant` is **absent** — analogous to the 12e.3 §F1 enum mismatch. The 12e.1 enum design uses `enriching` as the post-LLM-pass intermediate state; the roadmap names `llm_relevant` as a positive marker.
- This is decision point §G1 (mirror of 12e.3 F1).

### `ingestion_candidates` shape

Verbatim columns post-0017: `id`, `ingestion_source_id`, `external_id`, `url`, `raw_title`, `raw_summary`, `raw_published_at`, `raw_payload`, `content_hash`, `body_text`, `status`, `status_reason`, `resolved_event_id`, `discovered_at`, `processed_at`.

**Columns available for LLM output: NONE relevant.** No `sector`, no `relevance_reason` (separate from `status_reason`), no `llm_response_json`. 12e.4 needs migration 0018 to add at minimum:
- `sector text` (or `sector enum`) — for the LLM's classification.
- A reason store. Either reuse `status_reason` (single field for all rejection causes) or add a separate column.
- Optionally: `llm_response_json jsonb` — for the "first 100 calls audit" requirement to inspect raw I/O.

Decision point §G2.

### Migration 0018 needs (placeholder summary)

- Add `llm_relevant` enum value (or accept the `enriching`-as-positive convention; see §G1).
- Add `sector` column (text or enum-typed; see §G3).
- Optionally `llm_judgment_raw jsonb` for the 100-call audit (see §G6).

## C. Existing LLM infrastructure

### Anthropic SDK usage in repo

Located via `grep` for `@anthropic-ai/sdk` and `Anthropic`:

| file | purpose | pattern |
|---|---|---|
| `backend/src/services/haikuCommentaryClient.ts` | **The reuse target.** 12c per-user commentary client. | Dated model `claude-haiku-4-5-20251001`, AbortController 10s timeout, discriminated-union return (never throws), `assistantPrefill` for JSON-prefill, lazy module-level Anthropic instance. |
| `backend/src/services/depthVariantGenerator.ts` | 12a offline regeneration. | Alias `claude-haiku-4-5`, throws on missing key. CLI-driven one-shot only. |
| `backend/src/services/commentaryPromptV2.ts` | Prompt builder for 12c. | Pure prompt-construction, not a client. |
| `backend/src/services/commentaryService.ts` | 12c orchestration. | Calls `callHaikuForCommentary`, parses JSON from response, handles tiered fallback. |
| `backend/src/scripts/regenerateDepthVariants.ts` | CLI entry for 12a. | Wraps `depthVariantGenerator`. |

### Reuse target details: `haikuCommentaryClient.ts`

**Surface:**
```ts
export const COMMENTARY_MODEL = "claude-haiku-4-5-20251001";
export const HAIKU_TIMEOUT_MS = 10_000;
export const HAIKU_MAX_TOKENS = 800;

export type HaikuFailureReason = "timeout" | "empty" | "api_error" | "no_api_key";
export type HaikuResult = { ok: true; text: string } | { ok: false; reason: HaikuFailureReason; detail?: string };

export async function callHaikuForCommentary(
  prompt: string,
  deps?: { client?: Pick<Anthropic["messages"], "create">; model?: string; timeoutMs?: number },
  opts?: { assistantPrefill?: string; maxTokens?: number },
): Promise<HaikuResult>
```

**Properties relevant to 12e.4:**
- **Never throws** — every error becomes a discriminated-union failure result. Matches the existing 12e.3 idiom for `processEnrichmentJob` (return failureReason, don't throw).
- **`assistantPrefill: "{"`** is the canonical way to bias Haiku toward valid JSON output. Documented in the file's header. Direct fit for 12e.4's `{ relevant, sector, reason }` shape.
- **Module-level Anthropic instance is lazy** — tests can inject a mocked `client` via `deps.client`. Already exercised by the 12c test suite.
- **Timeout 10s, max_tokens 800** — both reasonable defaults for a relevance gate (output is short; one boolean + one short string + one short reason ≈ 100 tokens).

### Gaps for 12e.4

1. **Function name says "Commentary".** `callHaikuForCommentary` is bound by name to the commentary use case. Two options for 12e.4:
   - (a) Add a thin wrapper `callHaikuForRelevance` that delegates to `callHaikuForCommentary` (same shape; just name disambiguation).
   - (b) Rename `callHaikuForCommentary` → `callHaiku` (generic) and add use-case wrappers above. More invasive — touches 12c code paths.
   - **Default lean:** (a). Stays scoped.
2. **JSON parsing is the caller's responsibility.** `callHaikuForCommentary` returns raw `text`; commentaryService does its own JSON parse and trip-wire scan. 12e.4 will need a similar parse-and-validate step (probably a Zod schema for `{ relevant: boolean, sector: string, reason: string }`).
3. **No native retry on parse failure.** commentaryService's tiered fallback is the existing pattern. For 12e.4: malformed JSON could either retry once with a stricter prompt (one extra Haiku call), or land as `llm_rejected` with `status_reason='llm_parse_error'`. Decision point §G4.
4. **No native rate-limit handling.** The Anthropic SDK surfaces rate-limit errors as `api_error`. Matches 12c. 12e.4 should treat 429 as `llm_rejected` with `status_reason='llm_rate_limited'` (or rely on BullMQ retries — but BullMQ is configured at 2 attempts/60s exponential, possibly insufficient for sustained rate limiting; tune in 12e.5c).

## D. Sector enum

### Existing sector definitions

Located via `grep`:

| location | shape | values | notes |
|---|---|---|---|
| `backend/src/constants/onboardingTopics.ts:13–14` | `SECTORS = ["ai", "finance", "semiconductors"] as const; type Sector = ...[number]` | `["ai", "finance", "semiconductors"]` | The canonical TS-side const. Imported by `domainOptions.ts`. |
| `backend/src/scripts/seedStories.ts:39–40` | local-scoped `const SECTORS = ["ai", "finance", "semiconductors"]` | same three | Duplicates (legacy; predates `onboardingTopics`). |
| `backend/src/jobs/aggregationJob.ts:8–9` | `AGGREGATED_SECTORS = ["ai", "finance", "semiconductors"]` | same three | Aggregation rollup constraint. |
| `events.sector` (DB column) | `varchar(50)` | (no constraint) | Schema relies on app-side validation. |
| `stories.sector` (DB column) | (legacy) | same three by convention | Pre-12e. |
| `ingestion_sources.sectors` (DB column) | `text[]` | same three | Multi-sector — sources can be tagged with multiple. |

**No Postgres enum** for sectors anywhere in the schema. The values are TS const-narrowed at the application boundary.

### LLM output expectation

The roadmap names it `sector: enum`, not specifying the value space. CLAUDE.md §1 hard-locks `VALID_SECTORS = ["ai", "finance", "semiconductors"]` and explicitly says "changing it is a product decision, not a code tidy-up." So the LLM's `sector` value should be one of those three.

But: the LLM might disagree with the source's sector tags, or land on "this article is finance about a semiconductor company — could go either way." Two design questions:

1. **Should the LLM's prompt constrain output to `{ai, finance, semiconductors}`** (forcing one), or **allow `other`/`unrelated` for genuinely-out-of-scope content** (which is also a rejection signal)?
2. **What if LLM returns a value outside the locked set?** Treat as parse-error → reject? Or coerce to the source's primary tag?

Decision points §G3 (storage column type) and §G5 (prompt vocabulary).

## E. Seam contract for `runRelevanceGate`

### Current type (verbatim, `enrichmentJob.ts:61–63`)

```ts
runRelevanceGate?: (
  candidateId: string,
) => Promise<{ relevant: boolean; sector?: string; reason?: string }>;
```

### Inputs and outputs

- **Input:** `candidateId: string` only. Same as `runHeuristic` — the seam loads its own row and reads `body_text` (which 12e.3 populated for survivors).
- **Output:**
  - `relevant: boolean` — required.
  - `sector?: string` — optional, free-text. The roadmap says `sector: enum`; the seam shape says `sector?: string`. Slight type drift — could tighten to `sector?: Sector` but that pulls in a schema dep.
  - `reason?: string` — optional. Matches the roadmap's `reason: string` (not a controlled vocabulary like the heuristic reasons; this is LLM-generated free text describing why the article is/isn't relevant).

### Orchestration body call site

`enrichmentJob.ts:138–139` — comment placeholder only:

```ts
// FUTURE (12e.4): if seams.runRelevanceGate is provided, continue
// with the relevance gate here rather than terminating.
```

### Extension needed?

**Yes, modest extension.** Two questions for stage 2 to resolve:

1. **`sector` typing.** Does the seam contract tighten `sector?: string` → `sector?: Sector` (or keep `string` and let the orchestration body do the runtime check)? Current `runHeuristic` already exemplifies tight-typed return values — `reason?: HeuristicReason` (typed). Mirror that pattern.
2. **Where does the raw LLM JSON go?** The seam shape doesn't return the raw response. If the "first 100 calls audit" requires preserving raw I/O, either: (a) seam writes to `raw_payload` / new `llm_judgment_raw` column as a side effect, or (b) seam returns `raw?: string`/`raw?: Record<string, unknown>` so the orchestration body persists. Decision point §G6.

These are smaller than the 12e.3 §F3 extension (which added a whole `body` field). The seam contract's mental model — `{ relevant, sector?, reason? }` — already matches the spec.

## F. Recency investigation

### Setup

- Brought up ephemeral `signal-audit-12e4-pg` (postgres:16-alpine) on `127.0.0.1:5432`, ready in 3s.
- Created `backend/.env` with `DATABASE_URL` + minimal companions (no `REDIS_URL` — the bridge logs "queue unavailable" warnings but doesn't fail; per 12e.3 fail-soft design).
- Applied migrations through 0017.
- Polled all three target sources via `npm run run-ingestion-poll --workspace=backend -- --source=<slug>`.

Container removed and `.env` deleted before commit. `git status` confirmed clean.

### Q1 — pubDate distribution per source

```
     slug     | total | with_pubdate | null_pubdate |         oldest         |         newest         | avg_age_hours
--------------+-------+--------------+--------------+------------------------+------------------------+---------------
 cnbc-markets |    30 |           30 |            0 | 2026-04-16 09:44:16+00 | 2026-04-27 22:53:46+00 |           145
 import-ai    |    20 |           20 |            0 | 2025-11-17 14:20:40+00 | 2026-04-20 12:30:19+00 |          1851
 semianalysis |    20 |           20 |            0 | 2025-12-04 19:06:20+00 | 2026-04-24 22:15:46+00 |          1666
```

**All 70 candidates have non-null `raw_published_at`.** Hypothesis 3 (null fallthrough) ruled out immediately.

### Q2 — cnbc-markets pubDate vs raw_pubdate (top 8 by recency)

```
                       title                        |    raw_published_at    |   age_hours   |          raw_pubdate          |       raw_isodate
----------------------------------------------------+------------------------+---------------+-------------------------------+--------------------------
 Domino's Pizza stock falls on disappointing sales  | 2026-04-27 22:53:46+00 |    1.9        | Mon, 27 Apr 2026 22:53:46 GMT | 2026-04-27T22:53:46.000Z
 Procter & Gamble earnings beat estimates as sales  | 2026-04-27 17:20:33+00 |    7.5        | Mon, 27 Apr 2026 17:20:33 GMT | 2026-04-27T17:20:33.000Z
 P&G's solid quarter, confident outlook proves why  | 2026-04-24 17:29:50+00 |   79.3        | Fri, 24 Apr 2026 17:29:50 GMT | 2026-04-24T17:29:50.000Z
 L'Oreal stock pops 9% after 'impressive' earnings  | 2026-04-24 08:08:11+00 |   88.7        | Fri, 24 Apr 2026 08:08:11 GMT | 2026-04-24T08:08:11.000Z
 Intel's stock soars 20% as results top estimates   | 2026-04-23 22:34:23+00 |   98.2        | Thu, 23 Apr 2026 22:34:23 GMT | 2026-04-23T22:34:23.000Z
 Honeywell disappoints on quarterly results         | 2026-04-23 18:58:54+00 |  101.8        | Thu, 23 Apr 2026 18:58:54 GMT | 2026-04-23T18:58:54.000Z
 Overlooked industrial Dover gets the market's atte | 2026-04-23 18:14:47+00 |  102.6        | Thu, 23 Apr 2026 18:14:47 GMT | 2026-04-23T18:14:47.000Z
 IBM shares drop as company beats but opts to maint | 2026-04-23 14:38:36+00 |  106.2        | Thu, 23 Apr 2026 14:38:36 GMT | 2026-04-23T14:38:36.000Z
```

**`raw_pubdate` (verbatim feed string) matches `raw_published_at` (DB timestamptz) byte-for-byte across all sampled rows.** Both reference the same wall-clock time; `raw_isodate` (rss-parser's parsed canonical) also matches. **Hypothesis 2 (timezone bug) ruled out.**

CNBC's pattern: 2 items within 36h (today's earnings releases), 28 items >36h (back to 11 days old). High-frequency news; the 36h cutoff lets exactly today's articles through.

### Q3 — Substack feeds (import-ai, semianalysis) full pubDate listing

```
     slug     |                     title                     |    raw_published_at    | age_hours |          raw_pubdate
--------------+-----------------------------------------------+------------------------+-----------+-------------------------------
 import-ai    | Import AI 454: Automating alignment research; | 2026-04-20 12:30:19+00 |     180.3 | Mon, 20 Apr 2026 12:30:19 GMT
 import-ai    | Import AI 453: Breaking AI agents; MirrorCode | 2026-04-13 10:02:22+00 |     350.8 | Mon, 13 Apr 2026 10:02:22 GMT
 import-ai    | Import AI 452: Scaling laws for cyberwar      | 2026-04-06 12:31:31+00 |     516.3 | Mon, 06 Apr 2026 12:31:31 GMT
 ... (16 more items, all weekly Monday cadence, oldest 2025-11-17) ...
 import-ai    | Import AI 435: 100k training runs             | 2025-11-17 14:20:40+00 |    3874.5 | Mon, 17 Nov 2025 14:20:40 GMT

 semianalysis | The Coding Assistant Breakdown                | 2026-04-24 22:15:46+00 |      74.6 | Fri, 24 Apr 2026 22:15:46 GMT
 semianalysis | How Much Do GPU Clusters Really Cost?         | 2026-04-20 14:21:59+00 |     178.5 | Mon, 20 Apr 2026 14:21:59 GMT
 semianalysis | ISSCC 2026: NVIDIA & Broadcom CPO              | 2026-04-15 17:55:22+00 |     294.9 | Wed, 15 Apr 2026 17:55:22 GMT
 ... (17 more items, oldest 2025-12-04) ...
 semianalysis | AWS Trainium3 Deep Dive                       | 2025-12-04 19:06:20+00 |    3461.7 | Thu, 04 Dec 2025 19:06:20 GMT
```

**Same byte-exact match between `raw_pubdate` string and `raw_published_at` timestamp on every row.** Substack's RSS feeds publish a long sliding window of archived posts (5 months observable in this snapshot for both sources):
- import-ai: 20 items spanning 2025-11-17 → 2026-04-20. Newest item is 7.5 days old (180h).
- semianalysis: 20 items spanning 2025-12-04 → 2026-04-24. Newest item is 3.1 days old (74.6h).
- Both source's newest items are still >36h old today.

### Verdict

**Hypothesis 1 (archival content). Confirmed.** The 36h recency cutoff is correctly rejecting genuinely-old articles. The 97% recency rejection observed in the 12e.3 smoke is a real-data property of these specific feeds at the moment they were polled, not a bug in the parser or the recency function.

**Implications:**

- **Substack-style sources publish whole archives.** A typical poll of import-ai or semianalysis returns 20 items, of which 0–1 are within the 36h cutoff (depends on whether they published within the last 36h). When a new post drops, exactly 1 item passes recency until that post ages out at hour 37.
- **High-frequency news (CNBC-style)** sees 2–10 items per fetch within 36h, depending on news cycle.
- **Across the 32 RSS sources**, the steady-state survivor rate is ~10–25 candidates per day per cluster: a rough estimate, since the 32-source mix isn't fully exercised yet. Today's 70 candidates produced 2 heuristic-passers; on a different day, that number scales with whatever's been published in the last 36h.
- **Dedup carries the load.** Every poll of a Substack feed re-discovers the same 19–20 items; only the new one passes the unique-key constraint. The `(source_id, external_id)` UNIQUE + `onConflictDoNothing` is doing significant work here.

### Cost-model implication for 12e.4

**Initial steady-state Haiku call volume estimate** (for the relevance gate alone):
- ~10–25 unique heuristic-survivors per day across the 32 RSS sources (early estimate; arXiv / SEC / HN / Reddit are deferred to 12e.5d/e).
- One Haiku call each → 10–25 calls/day for 12e.4 alone.
- 5 calls per surviving candidate downstream (gate + facts + 3× tier) → 50–125 calls/day total enrichment chain at full deployment.
- Comfortably under any reasonable rate-limit ceiling. Cost at Haiku pricing is rounding error.

**No bug to fix.** The recency filter is correctly designed for the dominant feed pattern. The 12e.4 cost model should reflect the small steady-state survivor cohort, not the 70-candidate poll volume.

## G. Open decision points

### G1. Status enum: roadmap vs schema mismatch (mirror of 12e.3 F1)

**Question:** Roadmap says status advances to `llm_relevant` or `llm_rejected`; schema has `llm_rejected` plus `enriching` (the implicit "in flight" state). Same shape as 12e.3's heuristic_passed/heuristic_filtered question.

**Options:**
- (a) **Schema wins** — relevance pass advances directly to `enriching` (no new enum value). Mirrors the 12e.1 mental model and leaves no enum sprawl.
- (b) **Roadmap wins** — migration 0018 adds `llm_relevant`. Symmetric with the 12e.3 F1 hybrid (which added `heuristic_passed`).
- (c) **Hybrid** — add `llm_relevant` only as a positive marker post-LLM-gate; `enriching` stays as the post-fact-extraction-started marker. Two distinct states for two distinct stages of the pipeline.

**Default lean:** **(b) — symmetric with 12e.3 F1.** The previous session locked the hybrid pattern (`heuristic_passed` exists alongside `heuristic_filtered`). Adding `llm_relevant` alongside `llm_rejected` keeps the pattern consistent and makes downstream queries trivial: `WHERE status = 'llm_relevant'` for fact-extraction worker pickup. The cost is one more enum value (still cheap on PG 12+).

**Trade-off:** (a) zero migration friction but encodes a non-obvious convention readers must learn (the same critique that drove the 12e.3 F1 hybrid). (b) explicit. (c) middle ground; debatable whether the extra granularity earns its complexity.

### G2. Storage shape for LLM output

**Question:** Where do `sector`, `reason`, and (optionally) raw LLM JSON go on `ingestion_candidates`?

**Options:**
- (a) **Add only `sector text`** — reason flows into the existing `status_reason` column (so on rejection, `status_reason = relevance_<llm_reason>` or similar). Tightest schema.
- (b) **Add `sector text` + `relevance_reason text`** — separate column for LLM-generated reason text, freeing `status_reason` for a vocabulary-controlled rejection class (`llm_rejected`, `llm_parse_error`, `llm_rate_limited`, etc.).
- (c) **Add `sector text` + `llm_judgment_raw jsonb`** — single JSON blob with `{ relevant, sector, reason, model_id, latency_ms, ... }`. Most flexible for the "first 100 calls audit" + future fields.
- (d) **(c) plus `relevance_reason text` projected** — both raw and a denormalized text column.

**Default lean:** **(b) — text + text.** Matches the 12e.3 pattern (`status_reason` is a controlled vocabulary; specific text is in adjacent columns when needed). The "first 100 calls audit" can be served by selectively logging to console + Sentry breadcrumbs without persisting JSON; if persistence is wanted later, (c)/(d) is a forward-compatible additive migration.

**Trade-off:** (a) cheapest schema but loses the distinction between "rejection class" and "free-text rationale". (c)/(d) most powerful but introduces JSON-shape churn questions (one query later to see `sector`, two columns to keep in sync).

### G3. Sector column typing

**Question:** Is the `sector` column a `text`, a Postgres enum, or a `varchar(50)`?

**Options:**
- (a) **`text`** with app-side validation. Matches the existing `events.sector`/`stories.sector` pattern.
- (b) **Postgres enum `sector_t` with values `ai | finance | semiconductors | other`**. Stronger typing at the DB boundary; "other" is the explicit out-of-scope sentinel.
- (c) **`varchar(50)` matches `events.sector`** — pure consistency with the existing column.

**Default lean:** **(a) text.** Existing `events.sector` and `stories.sector` use unconstrained `text`/`varchar`. Adding a new enum here would be the only enum constraint on sector in the entire schema — inconsistent. Keep app-side validation as the source of truth, mirror existing pattern.

**Trade-off:** (a) inconsistent strictness — events.sector and ingestion_candidates.sector both rely on app validation, so a buggy app could write garbage. (b) caught at DB. (c) zero additional value.

### G4. Malformed JSON / parse failure handling

**Question:** When the Haiku response doesn't parse as the expected `{ relevant, sector, reason }` shape, what does the seam do?

**Options:**
- (a) **Reject as `llm_rejected` with `status_reason='llm_parse_error'`.** No retry. The LLM produced something we can't trust; safer to reject than to retry into a possibly-cascading parse failure.
- (b) **Single retry with stricter prompt.** Add `assistantPrefill: "{"` (already supported by the client). If retry also fails, reject as in (a).
- (c) **Reject without a parse-error variant** — single `status_reason='llm_rejected'` regardless of cause. Loses observability.

**Default lean:** **(b) single retry with prefill.** The prefill is the canonical Anthropic technique for biasing toward valid JSON; the existing client supports it. One extra Haiku call per malformed response is cheap. If the second call also fails, fall through to (a).

**Trade-off:** (b) occasional 2x cost on parse failures, but parse failures should be rare (~<1% with prefill). (a) cheaper but loses one signal.

### G5. Sector vocabulary in the prompt

**Question:** Does the prompt force the LLM to choose from `{ai, finance, semiconductors}`, or include an `other`/`unrelated` escape hatch?

**Options:**
- (a) **Forced 3-way classification.** Prompt says "sector must be exactly one of: ai, finance, semiconductors". Rejection signal is `relevant: false` (not the sector value).
- (b) **4-way with `other`.** Prompt says "sector must be one of: ai, finance, semiconductors, other". `sector='other'` is a soft rejection signal independent of the `relevant` field.
- (c) **`relevant: false` is the only rejection path; sector is informational on accepts only.**

**Default lean:** **(a) forced 3-way.** Per CLAUDE.md §1, only those three sectors are in scope. An "other" sector value isn't actionable — there's nowhere downstream that handles non-{ai,finance,semis} content. If the LLM thinks an article is genuinely off-topic, it should set `relevant: false` and put the off-topic-ness in the `reason` field. This keeps the data model crisp.

**Trade-off:** (a) might force the LLM to pick the closest of three sectors when an article is genuinely cross-cutting (e.g., AI + finance fintech). The resulting sector tag may be noisier; the `relevant` signal is what actually gates the pipeline.

### G6. "First 100 calls audit" surface

**Question:** The roadmap requires logging the first 100 LLM I/O pairs for prompt-quality audit. Where do those logs land?

**Options:**
- (a) **Console-only logs** (`[ingestion-llm-relevance:audit]` prefix) — same pattern as `[ingestion-poll]`/`[ingestion-enrich]`. Visible in the worker process stdout. Operator scrolls / `grep`s.
- (b) **Persist `llm_judgment_raw jsonb` column** for the first N candidates (or all of them); query post-hoc.
- (c) **Both — logs for ops visibility, jsonb column for queryable audit.**

**Default lean:** **(a) console-only.** Matches every other ingestion stage's logging idiom; doesn't require schema work; the 100-call audit is a one-time gate before cron-enabling and the operator can capture logs to a file for review. If later cohorts (12e.8 soak) want sustained queryability, add the column then.

**Trade-off:** (a) console logs require the operator to pipe to a file or grep. (b)/(c) DB-queryable but adds a column with a possibly short-lived purpose.

### G7. Prompt location

**Question:** Where does the relevance-gate prompt live?

**Options:**
- (a) **Constant in the seam module** (`backend/src/jobs/ingestion/relevanceSeam.ts`) — single file, simple.
- (b) **Separate prompt file** `backend/src/llm/prompts/ingestion/relevanceGate.ts` — matches the location 12e.5b will use for tier prompts.
- (c) **JSON config, loaded at runtime** — over-engineered for a single prompt.

**Default lean:** **(b)** — one extra file at a documented location, matches what the roadmap names for tier prompts ("`backend/src/llm/prompts/ingestion/`"). Cheap to set up the directory now even though only one prompt lives there until 12e.5b.

**Trade-off:** (a) tightest scope but creates a path-divergence with 12e.5b's expected layout. (b) adds a directory but matches the roadmap.

### G8. Body-text input scope

**Question:** What does the prompt see — `body_text` only, `body_text + raw_title`, `body_text + raw_title + raw_summary`?

**Options:**
- (a) **`body_text` only** — the readability extraction is the canonical content.
- (b) **`raw_title + body_text`** — title gives the LLM an immediate framing.
- (c) **`raw_title + raw_summary + body_text`** — full feed metadata; redundant since `body_text` typically contains the title and summary content.

**Default lean:** **(b)** — title is short, costs ~10 tokens, and gives the LLM a framing that may help with edge cases (semantic drift between body and headline). `raw_summary` is redundant with body extracted content.

**Trade-off:** (a) cleanest. (c) most context but ~50–100 extra tokens per call for marginal benefit.

### G9. Concurrency / rate-limit guardrails

**Question:** Does 12e.4 add any concurrency limits beyond BullMQ's existing 2-attempt retry, or rely on the existing `INGESTION_ENRICH_CONCURRENCY` env var (default 2)?

**Options:**
- (a) **Use existing `INGESTION_ENRICH_CONCURRENCY=2` default.** Inherits whatever 12e.5c tunes.
- (b) **Add a per-stage cap** (e.g., max 10 concurrent relevance-gate calls).
- (c) **Add a cohort-rate-limit** (e.g., 100/minute, throttled).

**Default lean:** **(a).** The worker concurrency is already env-tunable. The roadmap's call-volume estimate (≤25/day) is way below any rate-limit. Don't pre-build limits we won't use; add when soak shows real pressure (12e.8).

**Trade-off:** (a) might burst beyond Haiku rate limits if 32 sources happen to publish simultaneously. Worst case: BullMQ retries handle the 429s.

### G10. `enrichmentWorker.ts` seam injection — do we close the 12e.3 gap now?

**Question:** The 12e.3 smoke surfaced that `enrichmentWorker.handle()` calls `processEnrichmentJob(job.data)` without injecting seams (so all worker-drained jobs return `terminalStatus: failed`). 12e.5c is the named session for chain orchestration. But 12e.4 ships an LLM call that should be exercisable via the worker path, not just the CLI. Decision: close the gap in 12e.4 or wait for 12e.5c?

**Options:**
- (a) **Close in 12e.4.** Update `enrichmentWorker.handle()` to inject `runHeuristic` + `runRelevanceGate` (and any other seams that 12e.4 ships). Minimal scope creep — one file, one line of injection logic. Lets the worker drain real work.
- (b) **Keep the deferral.** 12e.5c handles all chain wiring including the worker. 12e.4 dev surface remains the CLI.
- (c) **Partial close — inject only `runRelevanceGate` and `runHeuristic`.** Other seams (`extractFacts`, `generateTier`, `resolveCluster`) stay null until their respective sessions wire them.

**Default lean:** **(c).** Minimal-impact close: the worker becomes useful for end-to-end smoke verification of the heuristic + LLM pipeline without waiting for 12e.5c. As subsequent sessions ship their seams, they each add one line to the worker's injection block.

**Trade-off:** (a)/(c) pull seam-wiring scope into a sub-session that's nominally about LLM work; (b) keeps separation pure but means the worker remains a no-op stub that no smoke can verify against.

## H. Followups & inherited state

- **#47 (libuv shutdown assertion):** still open. The 12e.3 CLI (`runIngestionEnrich.ts`) sidesteps it via `process.exitCode = 1` idiom. 12e.4's new CLI (likely `runIngestionRelevance.ts` or merged into `runIngestionEnrich.ts`) should follow the same idiom.
- **#48 (registry mislabel + 35-vs-32 source count + semianalysis seed URL):** still open. Doesn't affect 12e.4 logic; CNBC's "Earnings" feed continues to feed actual articles into the relevance gate without issue.
- **#49 (dev-DB standardization):** still open. 12e.4 stage 3 will need ephemeral Postgres + Redis again, plus `ANTHROPIC_API_KEY` in the smoke `.env` (tightening the secret-handling story for stage 3 — revisit before then).
- **Worker seam-wiring gap:** see §G10. Surfaced in 12e.3 smoke; decision pending here.
- **Recency rejection** (this audit's §F): not a bug. **No follow-up issue needed.** The 12e.4 cost model accounts for the small steady-state survivor cohort.
- **10 broken HEAD-sweep feeds** (from 12e.2 audit): still excluded; 12e.4 only operates on heuristic-survivors, so broken-feed sources contribute zero candidates to the LLM gate by construction.
- **12e.3 noise-pattern starter list:** unchanged in 12e.4 scope. Still slated for 12e.8 soak refinement.

## Verdict

**Ready for planner review.** 10 decision points enumerated; recency hypothesis resolved (Hypothesis 1, archival content; no fix needed); LLM infrastructure reuse target confirmed (`haikuCommentaryClient.ts`); seam contract already typed and only needs minor extension. The schema additions (migration 0018) are straightforward — extend enum + add 1–2 columns depending on §G2/§G3.

The biggest open question is §G10 (worker seam wiring). Resolving it determines whether 12e.4 stage 2 ships a CLI-only verification surface (mirroring 12e.3) or also closes the worker-injection gap that 12e.3 deliberately deferred. Defaults lean toward closing the gap in 12e.4 with minimal scope creep, but the planner should explicitly confirm.

**Decision-point count: 10.** Recency verdict: **Hypothesis 1 (archival content) — no bug, no fix needed.** No stop conditions encountered during the audit.

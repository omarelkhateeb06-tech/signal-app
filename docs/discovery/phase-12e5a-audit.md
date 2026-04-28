# Phase 12e.5a — Stage 1 discovery audit

**Date:** 2026-04-27
**HEAD at audit:** `0226763 chore(docs): clarify migrations path in CLAUDE.md` (1 commit past `2a3459c feat(ingestion): Phase 12e.4 — LLM relevance gate (#52)`)
**Scope:** read-only discovery for the fact-extraction worker (one Haiku call per `llm_relevant` candidate, structured-JSON facts persisted for the downstream tier generators).

## Pre-flight

- **CWD:** `C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\worktrees\lucid-williams-b3a2c7` ✓
- **Branch:** `claude/lucid-williams-b3a2c7`, clean working tree ✓
- **HEAD:** `0226763` ✓
- **Prior docs read:** `docs/roadmap/SIGNAL-roadmap.md` §12e.0, §12e.1, §12e.5a–c verbatim; `docs/discovery/phase-12e4-stage1-discovery.md` (recovered from commit `47b0e7d` — file isn't in `main`'s working tree but is reachable via `git show`); `docs/discovery/phase-12e4-smoke-test.md`; `docs/discovery/phase-12e3-smoke-test.md`; `backend/src/db/schema.ts`; `backend/src/jobs/ingestion/*`; `backend/src/services/haikuCommentaryClient.ts`; `backend/src/services/haikuRelevanceClient.ts`; `backend/src/llm/prompts/ingestion/relevanceGate.ts`.

## A. Roadmap spec read

### Verbatim spec for 12e.5a

> **#### 12e.5a — Fact extraction worker (~1 session)**
>
> One Haiku call per relevant candidate. Structured-JSON output extracting 5–8 key facts from the article body. Persisted to `events.facts`. This step is the shared grounding for the three tier generations downstream.

### Surrounding architectural commitments (from §12e.0)

- §12e.0 #5 — "Enrichment: four-stage Haiku pipeline per surviving candidate — fact extraction (1 call, persisted to `events.facts` JSONB) → three tier generations (3 calls, one per Accessible/Briefed/Technical). Total 5 Haiku calls per surviving candidate including the relevance gate."
- §12e.1 — "`facts` lives as JSONB column on `events`, not a separate table. 1:1 with events; schema-flexible during enrichment iteration; querying individual facts is rare today. GIN-index later if cross-event fact queries become hot."
- §12e.5b (downstream) — tier prompts under `backend/src/llm/prompts/ingestion/` (`tierAccessible.ts`, `tierBriefed.ts`, `tierTechnical.ts`); each "consumes the persisted facts plus the article body".
- §12e.5c (downstream) — chain orchestration: `… → extract-facts → generate-tiers × 3 → write-event`. Worker seam-wiring lives here.

### What the roadmap commits to

- **One Haiku call per relevant candidate** (no batching).
- **Structured-JSON output** with **5–8 key facts**. Schema beyond "5–8 facts" is unspecified.
- **Persisted to `events.facts`** (JSONB, 1:1 with the event).
- **Acts as shared grounding for all three tier generators downstream** — the same fact set is fed to each tier prompt in 12e.5b.
- **No model is pinned in the roadmap.** Cluster-wide CLAUDE.md §3 + the existing 12c/12e.4 request-path convention pin the **dated** string `claude-haiku-4-5-20251001` for any feed-path / request-path Haiku call. 12e.5a is request-path (cron-triggered enrichment, not a one-time offline regeneration), so the dated pin is the right fit. Reuse `COMMENTARY_MODEL` from `haikuCommentaryClient.ts` rather than re-declaring.

### Boundaries

- **Inherits from 12e.4:** rows at `status='llm_relevant'`, `sector` populated (∈ `{ai, finance, semiconductors}`), `body_text` populated (from 12e.3's readability extraction; informationally `status_reason='body_truncated'` if the 200 KB cap was hit), `llm_judgment_raw` populated, `resolved_event_id IS NULL`.
- **Hands off to 12e.5b:** persisted facts + the same `body_text`. 12e.5b reads the facts blob and feeds it to each of three tier prompts.
- **Hands off to 12e.5c:** end-to-end chain orchestration. 12e.5c also handles the candidate→event write (no event row exists at 12e.5a/12e.5b time — see §B/§E below).

### Cost / rate-limit guidance

Roadmap §12e.0 #5 quantifies "5 Haiku calls per surviving candidate" (gate + facts + 3× tier). §12e.0 #8 names the per-source rejection-rate kill switch but no per-stage rate limit. §12e.4 stage 1 audit estimated ~10–25 surviving candidates/day across the 32 RSS sources at full deployment — that's the cohort 12e.5a sees. Verified small. No retry policy specified in the roadmap.

## B. Schema state (post-0018)

### Current `ingestion_candidate_status` enum (per `schema.ts:50–60`)

```
{discovered, heuristic_passed, heuristic_filtered, llm_rejected, llm_relevant, enriching, published, duplicate, failed}
```

- `llm_relevant` is present (12e.4 added it via `ALTER TYPE ADD VALUE`) ✓
- `enriching` is present but has no live producers/consumers yet — it was carved out in 12e.1 as the "in-flight enrichment" intermediate marker.
- `published`/`duplicate` are 12e.6b territory.
- **No `facts_extracted` value yet.** Decision point §G1.

### `ingestion_candidates` shape (post-0018, schema.ts:631–666)

```
id, ingestion_source_id, external_id, url,
raw_title, raw_summary, raw_published_at, raw_payload, content_hash,
body_text, sector, llm_judgment_raw,
status, status_reason, resolved_event_id,
discovered_at, processed_at
```

**Columns relevant to 12e.5a I/O: NONE present yet.** No `facts`, no `facts_extracted_at`, no `fact_extraction_raw` (mirror of `llm_judgment_raw`). Migration 0019 will need to add at minimum:
- A persisted facts blob — see §G2.
- An idempotency / "already extracted" marker — see §G3.
- Optionally raw model I/O for auditing — see §G6.

### `events` shape (schema.ts:575–597) — the eventual home for facts

```
id, sector, headline, context, why_it_matters, why_it_matters_template,
primary_source_url, primary_source_name, author_id,
facts (JSONB notNull default {}),
embedding (bytea placeholder),
published_at, created_at, updated_at
```

`events.facts` already exists, JSONB, default `{}`. **But the events row doesn't exist at 12e.5a time.** Per the roadmap, event-row creation is deferred to 12e.5c (no clustering yet — each candidate creates a new event in its own write step). So `events.facts` is the *eventual* destination; 12e.5a needs a *staging* location on `ingestion_candidates`.

### Migration 0019 needs (placeholder summary)

- Add a `facts` JSONB column on `ingestion_candidates` (nullable; 12e.5c orchestration copies the blob to `events.facts` at event-write time). Or: add `facts_extraction_raw jsonb` and emit the structured facts somewhere derivable.
- Add `facts_extracted_at timestamptz` (nullable) — idempotency marker, mirrors how 12c uses cache freshness; or piggyback on a new `facts_extracted` enum status (see §G1/§G3 trade-offs).
- Optionally: extend the `ingestion_candidate_status` enum with a `facts_extracted` value (mirror of the 12e.3 `heuristic_passed` and 12e.4 `llm_relevant` precedent).
- File name per the existing pattern: `0019_phase12e5a_fact_extraction.sql`. **Lives at `backend/src/db/migrations/`** — homegrown runner reads from there exclusively (CLAUDE.md §6); don't accidentally drop it under `backend/drizzle/`.

## C. Existing LLM infrastructure (carryover from 12e.4)

12e.4 already established the two reusable layers. 12e.5a should extend, not duplicate.

| layer | file | role for 12e.5a |
|---|---|---|
| transport | `backend/src/services/haikuCommentaryClient.ts` (`callHaikuForCommentary`) | Same client. Discriminated-union return, AbortController 10s timeout, lazy module-level Anthropic instance, dated model pin (`claude-haiku-4-5-20251001`). |
| use-case wrapper | `backend/src/services/haikuRelevanceClient.ts` (`callHaikuForRelevance`) | **Pattern to mirror.** 12e.5a should add a peer wrapper (`haikuFactsClient.ts` exporting `callHaikuForFacts`) that delegates to `callHaikuForCommentary` with facts-specific defaults (max-tokens, prefill). |
| prompt | `backend/src/llm/prompts/ingestion/relevanceGate.ts` | **Layout to mirror.** 12e.5a's prompt lives at `backend/src/llm/prompts/ingestion/factExtraction.ts` (matches §G7-style decision already locked for the relevance gate; the directory is the roadmap-named home for tier prompts as well). |
| seam | `backend/src/jobs/ingestion/relevanceSeam.ts` (`runRelevanceSeam`) | **Pattern to mirror.** 12e.5a adds `factsSeam.ts` (`runFactsSeam`) — pure of `enrichmentJob.ts`, owns the LLM call + JSON parse + retry policy + raw audit blob, returns a structured non-throwing result. |

### Defaults that carry forward without re-deciding

- **Model pin:** `COMMENTARY_MODEL = "claude-haiku-4-5-20251001"`. Reuse the export.
- **Timeout:** `HAIKU_TIMEOUT_MS = 10_000`.
- **Body cap:** the relevance gate uses `RELEVANCE_GATE_BODY_CAP_CHARS = 8000`. Same body, same cost concerns; reuse the same cap with a per-prompt re-export. Decision point §G5.
- **Assistant prefill `"{"`:** canonical JSON-prefill. Stricter retry prefill is a parse-retry technique already exercised by `relevanceSeam.ts`.
- **Failure mapping:** 12e.4's `RELEVANCE_REASONS` vocabulary (`llm_rejected, llm_parse_error, llm_rate_limited, llm_timeout, llm_no_api_key, llm_empty, llm_api_error`) is the right shape; 12e.5a re-uses this taxonomy under a `FACTS_REASONS` constant prefixed `facts_*`. Decision point §G4 (whether facts-stage failures are terminal-reject or simply skip-fact-extraction-and-keep-going).

### Gaps for 12e.5a

1. **`max_tokens` budget.** Relevance verdict is ~100 output tokens (RELEVANCE_DEFAULT_MAX_TOKENS = 400). Facts at 5–8 entries with reasonable detail is closer to 400–600 output tokens — propose 800, matching `HAIKU_MAX_TOKENS`. Generous headroom; truncation mid-JSON is the costly failure mode.
2. **Output schema is more complex.** Relevance is a 3-field flat object; facts is an array of 5–8 entries. JSON-prefill `{` works for both. Zod schema needs a new shape — see §G2.
3. **Failure semantics differ.** Relevance failure = rejection (`llm_rejected`). Facts failure could either reject the candidate (gives up tier generation) or skip facts and let downstream tier generators work from `body_text` alone. Decision point §G4.
4. **Persistence target is staged.** Relevance writes directly to the candidate's `sector`/`llm_judgment_raw`. Facts write to a staging column on the candidate; 12e.5c later copies to `events.facts`. The seam contract should treat this as a write-to-candidate side effect, with the events-side copy being 12e.5c's responsibility.

## D. Seam contract for `runFactsSeam` / `extractFacts`

### Current type (verbatim, `enrichmentJob.ts:75`)

```ts
extractFacts?: (candidateId: string) => Promise<Record<string, unknown>>;
```

And the consumer (12e.5b's `generateTier`) at `enrichmentJob.ts:76–80`:

```ts
generateTier?: (
  candidateId: string,
  tier: "accessible" | "briefed" | "technical",
  facts: Record<string, unknown>,
) => Promise<{ thesis: string; support: string }>;
```

### Issues with the current shape

- `Record<string, unknown>` is too loose. Mirror the relevance seam's discriminated-result pattern so the orchestration body can route by outcome without try/catch.
- No way for the seam to indicate "extraction failed but candidate is still valid; downstream may continue without facts" vs "extraction failed terminally; reject".
- No surface for the `facts_extraction_raw` audit blob (mirror of `llm_judgment_raw`).

### Proposed extension (mirrors `RelevanceSeamResult`)

```ts
export interface FactsSeamResult {
  ok: boolean;
  facts?: ExtractedFacts;        // populated when ok=true
  rejectionReason?: FactsReason; // populated when ok=false
  raw?: FactsSeamRaw;            // model+prompt+response+latency+attempts (audit)
}
```

Type for `ExtractedFacts` is the open schema-design question — see §G2.

### Orchestration body change

Currently at `enrichmentJob.ts:213–214`:

```ts
// FUTURE (12e.5a): if seams.extractFacts is provided, continue
// with fact extraction here rather than terminating.
return { ... terminalStatus: "llm_relevant" ... };
```

12e.5a fills this in: on `runFactsSeam` success, persist facts + idempotency marker, advance status (per §G1), return non-terminal `terminalStatus` (e.g., `"facts_extracted"` or stay at `"llm_relevant"` with the new column populated). On failure, persist `facts_extraction_raw` if present and either reject or short-circuit per §G4.

## E. Where do the facts actually live?

This is the schema-decision crux of the audit.

The roadmap says "persisted to `events.facts`". But at 12e.5a's point in the chain, **no event row exists**. The chain is:

```
discovered → heuristic_passed → llm_relevant → [12e.5a: extract facts] → [12e.5b: × 3 tier] → [12e.5c: write event]
                                                                                                  ^
                                                              event row is created HERE (12e.5c)
```

So `events.facts` is the *eventual* home; the *immediate* home is on `ingestion_candidates`. Three sub-options trade off how much we stage:

- **(a) Stage facts only (recommended).** Add `ingestion_candidates.facts jsonb` + idempotency marker. 12e.5b reads candidates.facts. 12e.5c copies candidates.facts → events.facts at write time, then leaves the candidate row's facts column populated as a tombstone (or clears it).
- **(b) Stage facts + tiers separately on candidate.** 12e.5b also stages `why_it_matters_template` on the candidate. 12e.5c copies both blobs to the event row. Cleanest separation but pre-allocates 12e.5b decisions.
- **(c) Create the event row early at 12e.5a.** Write facts directly to `events.facts`, set `event_sources.role='primary'`, leave `why_it_matters_template` null until 12e.5b. Avoids the staging column but couples 12e.5a to event-write semantics that 12e.5c is supposed to own (clustering, source-priority arbitration, etc.).

**Default lean:** **(a).** Smallest blast radius for 12e.5a. Decouples facts persistence from event-row lifecycle (which 12e.6a/b explicitly redesigns when clustering lands). 12e.5c orchestration copies the blob across.

**Trade-off:** facts live in two places transiently (candidate + event) for the lifetime of the candidate row. Tolerable — `ingestion_candidates` is already a wide table designed as a staging ledger.

## F. Volume / cost re-estimate

### Inputs to the estimate (carried forward from §F of the 12e.4 stage 1 audit)

- 32 RSS sources at full deployment.
- Steady-state cohort post-recency-cutoff + post-relevance-gate: **~10–25 candidates/day** (early estimate; arXiv / SEC EDGAR / HN / Reddit deferred to 12e.5d/e and will lift this number).
- The 12e.4 smoke (sample of 70 candidates from 3 sources on a single weekday evening) saw **2 candidates pass to llm_relevant**. At 32-source scale that scales to roughly the upper end of the 10–25 range.

### Per-call token estimate for 12e.5a

- **Input.** Same body as 12e.4, capped at 8000 chars. ~2500 input tokens at Haiku tokenization. Add ~150 tokens for the system instruction + few-shot example (if any). Call it ~2700 input tokens per call.
- **Output.** 5–8 facts × ~30–60 tokens each + JSON envelope ≈ 300–500 output tokens. Set `max_tokens=800` for headroom.

### Per-day estimate at full deployment

- Calls/day: 10–25 (one per `llm_relevant` candidate).
- Tokens/day: 27,000–67,500 input + 3,000–12,500 output = 30k–80k tokens.
- At Haiku 4.5 list pricing (publicly $1/M input, $5/M output as of cluster time) — **~$0.05 to $0.10 / day** for 12e.5a alone. Sanity check, not a budget request.

### 12e.5b is 3× this volume

12e.5b runs three tier-generation calls per candidate. At the same ~2700 input tokens (each tier sees the same body + facts) and similar output sizes, **per-candidate cost in 12e.5b ≈ 3×12e.5a**. The per-call 12e.5a cost matters more for cumulative-pipeline cost than the per-day total. Output token budget (the more expensive side) dominates; 12e.5a's 300–500 output tokens × 3 tiers + 12e.5a's own ≈ 1200–2000 output tokens per candidate end-to-end. Not a constraint at 25/day.

### Concurrency / rate-limit headroom

12e.5a piggybacks on `INGESTION_ENRICH_CONCURRENCY` (default 2 — same as 12e.3/12e.4). At 25 candidates/day and 2 concurrent enrichments, no rate-limit concerns. No new guardrails needed.

## G. Open decision points

### G1. Status enum: add `facts_extracted` or stay at `llm_relevant`?

**Question:** After fact extraction succeeds, does the candidate's `status` advance to a new `facts_extracted` enum value, or stay at `llm_relevant` with the new `facts`/`facts_extracted_at` columns indicating progress?

**Options:**
- (a) **Stay at `llm_relevant`.** Fact extraction state is encoded entirely in the new column(s). Status advance happens at 12e.5c when the event is written (`status='published'`).
- (b) **Add `facts_extracted` enum value.** Mirrors the 12e.3 `heuristic_passed` and 12e.4 `llm_relevant` precedent — every successful stage gets a positive marker.
- (c) **Add `enriching` re-purposed.** The enum already has `enriching`; treat it as "facts extracted, awaiting tier generation". Avoids enum sprawl but leaves the meaning of `enriching` slightly ambiguous (does it mean "facts done" or "facts in progress"?).

**Default lean:** **(b).** Symmetric with the prior two stages. Downstream queries become trivial (`WHERE status='facts_extracted'` for tier-worker pickup). One more enum value is cheap on PG 12+.

**Trade-off:** (a) zero schema friction but encodes a non-obvious convention readers must learn. (c) reuses the existing `enriching` slot but makes the slot's meaning depend on which sub-stage you're in.

### G2. Output schema for the facts blob

**Question:** What's the exact shape of the persisted facts? The roadmap says "5–8 key facts" — open beyond that.

**Options (in order of structure):**
- (a) **Flat array of strings.** `{ facts: ["fact 1", "fact 2", ...] }`. Simplest. No category, no source-grounding, no priority.
- (b) **Array of objects with category.** `{ facts: [{ text, category }] }` where category ∈ `{actor, action, metric, timeframe, market_reaction, technical_detail, ...}`. Adds analytic surface; 12e.5b can prioritize by category per tier.
- (c) **Object with named fact slots.** `{ who, what, when, how_much, why_it_matters_signal, ... }`. Forces a 5W-style template.
- (d) **(b) + per-fact source span.** Each fact carries an offset/quote into `body_text` so 12e.5b can ground tier output more tightly. Most powerful, most prompt-heavy.

**Default lean:** **(b).** Adds one ergonomic field over (a) without committing to a rigid template. Categories useful for 12e.5b prioritization (technical tier weights `technical_detail`/`metric`; accessible tier weights `actor`/`action`). Open vocabulary for category — Zod accepts free-text — keeps the LLM unconstrained.

**Trade-off:** (a) easiest to validate, hardest to differentiate tier outputs. (c) overly structured; many articles don't have crisp 5W answers. (d) most powerful but doubles output token cost and complicates the prompt.

### G3. Idempotency marker

**Question:** What column or signal guarantees a re-run skips already-extracted candidates?

**Options:**
- (a) **`facts_extracted_at timestamptz` column** (default null). Cheap, queryable, mirrors how 12c uses `commentary_cache.created_at` and how the existing seams use `processed_at`. Re-run filter: `WHERE facts IS NULL OR facts_extracted_at IS NULL`.
- (b) **Status enum value** (per §G1 (b)). Re-run filter: `WHERE status='llm_relevant'`. Concise.
- (c) **Both.** Status moves to `facts_extracted`; timestamp recorded. Belt + braces — useful if future code wants to recompute facts (e.g., model upgrade) without losing the original timestamp.

**Default lean:** **(c).** The pattern in 12e.4 is "status advances + timestamp updates" (`processed_at` is set on every stage completion). Mirroring that gives the operator both an SQL filter and a queryable "when was this extracted" signal. Cost is one nullable timestamp column.

**Trade-off:** (b) is sufficient as long as we don't care about re-extraction. (a) without the enum advance is sufficient but breaks the symmetric pattern across stages.

### G4. Failure handling: terminal reject or skip-and-continue?

**Question:** When fact extraction fails (parse error, timeout, rate-limit, no_api_key), what does the seam do?

**Options:**
- (a) **Terminal reject.** Status advances to `failed` with `status_reason='facts_<class>'`. Candidate doesn't reach tier generation. Simple but loses the candidate.
- (b) **Skip facts, advance to next stage.** Persist whatever raw audit blob we have, leave `facts` null, advance status. 12e.5b gracefully degrades when facts is null (uses body_text alone). Most permissive.
- (c) **Single retry on parse error (mirror 12e.4 G4); terminal-reject on transport-class failure.** Hybrid.

**Default lean:** **(c).** Matches 12e.4's pattern. Parse errors are likely fixable with stricter prefill; transport errors need a session-level remedy (key rotation, network) and shouldn't burn cycles re-trying. Terminal-reject preserves observability — operators see exactly which stage rejected and why.

**Trade-off:** (b) maximizes published throughput at the cost of degraded tier output for facts-missing candidates. (a) cleanest data shape; loses ~0–2% candidates to transient errors. (c) middle.

### G5. Body-text input cap and shape

**Question:** What does the prompt see — `body_text` only? `raw_title + body_text`? Same 8000-char cap as the relevance gate?

**Options:**
- (a) **Same as relevance gate** — `raw_title + body_text` truncated at 8000 chars. Reuses `RELEVANCE_GATE_BODY_CAP_CHARS`.
- (b) **Larger cap** — 12000 or 16000 chars. Facts extraction benefits from more body context (the relevance gate makes its judgment from the lede; facts may be scattered through the body).
- (c) **Title + body + sector hint.** Pass the 12e.4-validated `sector` as an extra prompt prefix so the LLM tunes its fact selection by sector.

**Default lean:** **(a) for stage 2; revisit in 12e.8 soak.** Same cap is the cheapest call shape. If the soak shows 12e.5a missing facts that live past char 8000, lift the cap then. (c) is a nice ergonomic extra at marginal token cost; adopt if planner agrees.

**Trade-off:** (b) more costly per call (~1.5–2× input tokens) for marginal gain on a small per-day cohort. (c) cheap; possibly noisy if the LLM over-anchors on the sector hint when the article is cross-sector.

### G6. "First 100 calls audit" surface for 12e.5a

**Question:** 12e.4 logs to console + persists to `llm_judgment_raw jsonb`. Does 12e.5a get a similar surface, given the roadmap doesn't explicitly require one for fact extraction?

**Options:**
- (a) **Persist `facts_extraction_raw jsonb`** (mirror of 12e.4's `llm_judgment_raw`). Console-log alongside. Tightest auditability.
- (b) **Console-only logs.** The persisted `facts` blob is itself the audit surface — query it directly to read what the LLM extracted.
- (c) **No audit surface.** Trust the unit tests + first-100 manual eyeballing during smoke.

**Default lean:** **(a).** Cheap (one nullable JSONB column), matches 12e.4 precedent, and gives the planner the same retroactive prompt-quality knob. The 12e.5a-specific concern is that fact-quality issues (hallucinated facts, irrelevant facts) won't surface in `facts` alone — operators need the original prompt text to debug. The audit blob includes prompt+response; the `facts` blob is just the parsed result.

**Trade-off:** (a) one column of bookkeeping. (b)/(c) leaner but harder to debug fact-quality regressions.

### G7. Few-shot vs zero-shot prompt design

**Question:** Does the prompt include few-shot examples ("here's a sample article + sample facts"), or zero-shot ("extract 5–8 facts from this article")?

**12e.4 precedent:** zero-shot. The relevance gate prompt is a 9-line system instruction, no examples (`backend/src/llm/prompts/ingestion/relevanceGate.ts:49–59`). It works on the small smoke sample (2/2 reasonable judgments).

**Options:**
- (a) **Zero-shot.** Mirror 12e.4. Small risk that fact extraction is more shape-sensitive than relevance.
- (b) **Few-shot with one curated example.** ~200 extra input tokens per call, a clearer steering signal for the JSON shape. The example would live inline in the prompt module (no separate fixture file).
- (c) **Two examples — one AI, one finance.** ~400 extra tokens per call. Tightest steering but most costly.

**Default lean:** **(a) zero-shot for stage 2; revisit in 12e.8 soak.** The shape is well-served by Zod validation + retry-with-stricter-prefill (mirroring 12e.4's parse-retry path). If the soak shows shape drift, add (b).

**Trade-off:** (b)/(c) tighter quality at 7–14% token-cost increase; (a) cheapest with the longest debug feedback loop if it doesn't work.

### G8. CLI dev surface — extend `runIngestionEnrich.ts` or add `runIngestionFacts.ts`?

**Question:** Per the spec ("CLI entrypoint as documented dev surface, per the 12e.5c deferral"), where does the dev-side trigger live?

**Options:**
- (a) **Extend `runIngestionEnrich.ts`.** Already runs heuristic + relevance; injecting `extractFacts` lets one CLI exercise heuristic → relevance → facts in one shot. Filter widens to `status IN ('discovered', 'heuristic_passed', 'llm_relevant')`. One CLI grows; still small.
- (b) **Add `runIngestionFacts.ts`.** Separate CLI scoped to `status='llm_relevant'`. Keeps each stage debuggable in isolation.
- (c) **Both.** `runIngestionEnrich.ts` runs the full chain; `runIngestionFacts.ts` runs just the facts stage on a candidate.

**Default lean:** **(a).** The 12e.4 precedent already extended `runIngestionEnrich.ts` rather than splitting; 12e.5c's chain orchestration is the natural endpoint for that growth. One CLI is easier to discover; isolation is achievable via `--candidate-id=<uuid>` on a candidate at the desired status.

**Trade-off:** (a) one CLI does many things. (b) stage isolation but more CLIs to remember. (c) maximalist; likely unnecessary.

### G9. Worker seam-wiring — confirm the deferred-wiring pattern

**Spec brief explicitly says:** "Do not wire into `enrichmentWorker.ts`. The worker seam-wiring deferral is explicit — 12e.5c handles chain orchestration. Note in the audit that 12e.5a follows the same deferred-wiring pattern as 12e.4."

**Confirmed.** 12e.4 stage 2 deliberately did **not** wire `runRelevanceGate` into `enrichmentWorker.handle()` — the worker remains a stub that returns `{ terminalStatus: "failed", failureReason: "runHeuristic seam not provided" }` for any drained job. The CLI is the verification surface. 12e.5a follows the same pattern: `factsSeam.ts` exists, the orchestration body wires it when the seam is provided in deps, and the worker stays unwired until 12e.5c.

No decision needed; recorded for the planner so the deferral is explicit in the audit trail.

### G10. Re-extraction policy — model upgrades, schema bumps

**Question:** If we ship 12e.5a with `claude-haiku-4-5-20251001` and later (12e.8 or post-launch) want to upgrade the model or evolve the facts schema, how do we re-extract for old candidates?

**Options:**
- (a) **Don't design for it now.** Model + schema upgrades trigger a one-off `regenerateFacts.ts` script (mirror of `regenerateDepthVariants.ts` from 12a). Out of scope for 12e.5a.
- (b) **Add a `facts_schema_version` int column** on candidates. Re-run logic filters `WHERE facts_schema_version < CURRENT_FACTS_SCHEMA_VERSION`. Forward-compatible.
- (c) **Add a `facts_model` text column** on candidates. Re-run logic filters by model.

**Default lean:** **(a).** YAGNI for the launch milestone. The 12a precedent (`regenerateDepthVariants.ts`) is the proven shape — model-bump scripts are one-shots, not cron-loop concerns. Defer to the actual model-upgrade session.

**Trade-off:** (b)/(c) add a column today for a need that may never materialize. (a) means a future regeneration script will need to scan-and-re-extract everything; for ~10–25 candidates/day cohort that's trivial.

## H. Test surface

### Unit boundaries (mockable)

| layer | mock target | test file (proposed) |
|---|---|---|
| prompt builder | none — pure | `backend/tests/llm/prompts/ingestion/factExtraction.test.ts` |
| Haiku wrapper | inject `client` via `HaikuClientDeps` | `backend/tests/services/haikuFactsClient.test.ts` |
| seam | inject `callHaiku` via `FactsSeamDeps`; mock-DB via `tests/helpers/mockDb` | `backend/tests/ingestion/factsSeam.test.ts` |
| orchestration | extend `enrichmentJob.test.ts` with the new seam | `backend/tests/ingestion/enrichmentJob.test.ts` (expand) |

### Integration test (no live LLM)

Fixture-based, mirroring 12e.4's `relevanceSeam.test.ts`:
- Seed an `ingestion_candidates` row at `status='llm_relevant'` with a fixture `body_text`.
- Mock `callHaikuForFacts` to return a known-good JSON facts payload.
- Run `runFactsSeam(candidateId)` and assert: facts persisted, idempotency marker set, status advance per §G1, raw audit blob populated.
- Negative cases: malformed JSON → retry → terminal `facts_parse_error`; transport-class `api_error` with "429" detail → `facts_rate_limited`; `no_api_key` → graceful no-op.

The 12e.4 seam test has **268 lines covering parse-retry, sector-vocabulary retry, all 7 rejection classes, and idempotency.** Mirror that surface area. Sample size for the test fixtures: 1 happy-path payload + 5 error-class payloads.

### Smoke test (stage 3 — live Haiku)

- **Sample size:** match 12e.4's smoke pattern. The 12e.4 smoke ran on 2 live candidates (the only ones that survived the recency cutoff at smoke time on 3 sources). 12e.5a smoke would run on whatever cohort the smoke-time DB has at `status='llm_relevant'` after a re-run of the 12e.3+12e.4 pipeline. Expected sample size: **2–10 live candidates**, depending on the smoke's poll-day news cycle.
- **Cost ceiling:** the dedicated low-spend-cap Workbench API key from 12e.4's smoke is reusable. At 2–10 calls × ~$0.005/call ≈ $0.05 worst case. Far under any reasonable cap.
- **Verdict criteria:** facts JSON parses, `5 ≤ |facts| ≤ 8`, persisted blob matches the parsed result, idempotency holds (re-run is a 0-call no-op), raw audit blob round-trips.
- **Branches not exercised at small sample:** terminal parse failure, rate-limit detection, sector-tagged-but-empty-body edge cases. Same observation 12e.4 made — flag for the planner that smoke validates plumbing, not the prompt at scale.

**Flag for planner to confirm:** target sample size for 12e.5a smoke. Default lean is "whatever survives the chain at smoke time, no minimum"; planner may want a 5-call-minimum gate before merging.

## I. Followups & inherited state

- **#47 (libuv shutdown assertion):** open. 12e.5a CLI work follows the `process.exitCode = 1` idiom from `runIngestionEnrich.ts`. No new exposure.
- **#48 (registry mislabel + 35-vs-32 source count + semianalysis seed URL):** open. Doesn't affect 12e.5a logic.
- **#49 (dev-DB standardization):** open. 12e.5a stage 3 will need ephemeral Postgres + Redis again, plus `ANTHROPIC_API_KEY` in the smoke `.env` (same secret-handling story as the 12e.4 smoke).
- **dotenv override quirk** (12e.4 anomaly §1): open. Same `unset ANTHROPIC_API_KEY` pre-CLI workaround applies to any 12e.5a CLI runs that piggyback on `runIngestionEnrich.ts`.
- **jsdom log pollution** (12e.4 anomaly §2): open. Doesn't affect 12e.5a directly — facts extraction reads `body_text` (already extracted in 12e.3); jsdom isn't re-invoked.
- **Worker seam-wiring deferral** (12e.4 G10 → confirmed in §G9 above): the `enrichmentWorker.handle()` call site stays unwired through 12e.5a. 12e.5c is the named owner.

## Verdict

**Ready for planner review.** 10 decision points enumerated. The schema-decision crux (§E — facts staged on `ingestion_candidates` vs created-early on `events` vs split-into-tiers-later) leans clearly toward (a) staging on the candidate; planner should confirm before stage 2 writes the migration. Most other decision points have low blast radius — clear default leans, easy reversibility.

The 12e.4 transport + wrapper + seam scaffolding is directly reusable; **12e.5a is mostly a pattern application**, not a new design.

**Decision-point count: 10.** Default leans across the 10: (b), (b), (c), (c), (a), (a), (a), (a), confirmed, (a) — i.e. mirror 12e.4's pattern wherever it exists.

## Open questions for planner

1. **§E / §G2 — facts schema and persistence target.** The roadmap says "persisted to `events.facts`" but no event row exists at 12e.5a time. Default lean is to stage `facts jsonb` on `ingestion_candidates` and let 12e.5c copy across. **Confirm.** Also confirm the per-fact shape: flat strings (G2 (a)), categorized objects (G2 (b), default lean), or named slots (G2 (c)).
2. **§G1 / §G3 — status enum value vs timestamp marker.** Default lean is to add `facts_extracted` enum value AND `facts_extracted_at` timestamp (belt + braces, mirrors 12e.4). Planner: confirm the enum-value addition.
3. **§G4 — failure handling.** Default lean is single retry on parse error, terminal-reject on transport-class. Planner: confirm or pick (b) skip-and-continue if maximal published throughput matters more than data crispness.
4. **§G5 — body-text cap.** Default lean is reuse 8000-char cap; revisit in 12e.8 soak if facts are missing past the cap. Planner: confirm or pre-emptively raise to 12000.
5. **§G7 — few-shot vs zero-shot.** Default lean is zero-shot mirroring 12e.4. Planner: confirm or pre-bake a few-shot example for shape steering.
6. **§G8 — CLI surface.** Default lean is extend `runIngestionEnrich.ts` (one CLI grows). Planner: confirm or split into `runIngestionFacts.ts`.
7. **§H — smoke sample size.** Default lean is "whatever survives the chain at smoke time, no minimum." Planner: confirm or set a floor (e.g. 5 calls).
8. **Any prompt-text review desired before stage 2?** 12e.4 the prompt was written in-session with no pre-review; the 100-call audit gate is the sanctioned review point. Same default for 12e.5a unless planner wants a pre-stage-2 prompt review.

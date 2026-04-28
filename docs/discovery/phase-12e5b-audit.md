# Phase 12e.5b — Stage 1 discovery audit

**Date:** 2026-04-27
**HEAD at audit:** `e97bc35 feat(ingestion): Phase 12e.5a — fact extraction worker (#55)`
**Branch:** `claude/epic-banach-de0c78`
**Scope:** read-only discovery for the three tier-generation workers (one Haiku call per tier × `accessible | briefed | technical`, consuming 12e.5a's persisted facts + article body, producing `{thesis, support}` per tier, written to a `why_it_matters_template`-shaped column).

This audit is mostly pattern-application from 12e.5a — same transport, same wrapper shape, same idempotency mechanism — and surfaces only the cruxes that the three-tier shape forces deliberate divergence on.

---

## 1. Roadmap §5.4 12e.5b spec — verbatim

Roadmap is at `docs/roadmap/SIGNAL-roadmap.md` (verified via Glob — the brief said "expected name `SIGNAL_ClaudeCode_BuildPlan.md` at repo root"; that filename does not exist). Snapshot date in the file header: April 27, 2026. §5.4 is the Phase 12e ingestion section.

§5.4 12e.5b verbatim (lines 218–220):

> **#### 12e.5b — Three tier-generation workers (~1.5 sessions)**
>
> Three Haiku calls per candidate, one per tier. Tier-specific prompts under `backend/src/llm/prompts/ingestion/` (`tierAccessible.ts`, `tierBriefed.ts`, `tierTechnical.ts`). Each consumes the persisted facts plus the article body and produces `{thesis, support}` for that tier. Output written to event row's `why_it_matters_template` text-as-JSON column matching the existing `stories` shape: `{accessible: {thesis, support}, briefed: {thesis, support}, technical: {thesis, support}}`.

Surrounding architectural commitments:

- §5.4 ¶5 (line 181): "Enrichment: four-stage Haiku pipeline per surviving candidate — fact extraction (1 call, persisted to `events.facts` JSONB) → three tier generations (3 calls, one per Accessible/Briefed/Technical). Total 5 Haiku calls per surviving candidate including the relevance gate."
- §5.4 12e.5c (line 222): "End-to-end chain: `ingestion-cron → fetch-source → evaluate-candidate (heuristic + relevance) → extract-facts → generate-tiers × 3 → write-event`. … Dead-letter handling for stage failures. Sentry tags wired through all stages. **No clustering yet** — at this point each candidate creates a new event."
- §5.4 12e.0 ¶5 also notes per-source quality scores via initial guesses.

### Drift between this brief's framing and the spec

The brief frames 12e.5b as worker scaffolding that **stages on candidates**. The spec literally says output is "written to event row's `why_it_matters_template`". Side-by-side:

| brief framing | spec text |
|---|---|
| "where tier outputs land" presented as an open question, with "stage on candidates first vs land directly on events" called out as a crux because "the `events` row may not exist at 12e.5b runtime" | Spec text says output goes to the event row. |
| "12e.5c owns chain orchestration" | Spec 12e.5c says `… → generate-tiers × 3 → write-event`. The arrow ordering implies tier generation precedes event creation in the chain. |

Reading these together: 12e.5b runs the three Haiku calls and produces the templated string; 12e.5c is the orchestrating step that creates the event row and writes the bundle. So the events row genuinely does not exist at 12e.5b runtime, and a staging column is the only viable persistence target. The brief's framing of the crux is correct; the spec's "written to event row" is shorthand for "the data destined for the event row, produced by 12e.5b, persisted to the event row by 12e.5c". This audit treats it that way and recommends accordingly in §3.

This is an issue worth flagging to the planner: the spec wording is ambiguous about the staging step, and 12e.5c's "write-event" arrow is the only place it's resolved. **Recommend: planner adds a one-line clarification in 5.4 12e.5b that tier outputs stage on `ingestion_candidates` until 12e.5c writes the event row.**

---

## 2. 12e.5a wrapper shape (the template 12e.5b will pattern-apply from)

`backend/src/llm/` contents:
```
backend/src/llm/prompts/ingestion/factExtraction.ts
backend/src/llm/prompts/ingestion/relevanceGate.ts
```

Companion files in `backend/src/services/`: `haikuCommentaryClient.ts` (transport), `haikuRelevanceClient.ts` (12e.4 wrapper), `haikuFactsClient.ts` (12e.5a wrapper). And in `backend/src/jobs/ingestion/`: `relevanceSeam.ts`, `factsSeam.ts`, `enrichmentJob.ts` (orchestration).

### Call signature and return type (`callHaikuForFacts`, file `backend/src/services/haikuFactsClient.ts`)

```ts
export async function callHaikuForFacts(
  prompt: string,
  opts: HaikuFactsCallOptions = {},
  deps: HaikuClientDeps = {},
): Promise<HaikuResult>
```

`HaikuResult` (from `haikuCommentaryClient.ts`):
```ts
export type HaikuResult =
  | { ok: true; text: string }
  | { ok: false; reason: HaikuFailureReason; detail?: string };
```

The wrapper is a thin shim that delegates to `callHaikuForCommentary` with facts-specific defaults (max-tokens, prefill). Its sole job is to swap defaults and re-export the discriminated union.

### Transport, retry, timeout

- Transport: `callHaikuForCommentary` (single shared client, lazy module-level Anthropic instance). Dated model pin `COMMENTARY_MODEL = "claude-haiku-4-5-20251001"`.
- Timeout: `HAIKU_TIMEOUT_MS = 10_000` (10s, AbortController). Caller can override via `opts.timeoutMs` but 12e.5a inherits the default.
- Retries at the transport layer: **zero**. "No retries here. The caller (commentaryService) handles parse-failure retries; transport-level failures fall straight through to the tiered template" (haikuCommentaryClient.ts:13–15).
- Retry at the seam layer: 12e.5a uses **one** parse-retry with stricter prefill (`{"facts":` instead of `{`). No retries on transport failures (timeout, no_api_key, api_error, empty) — these are mapped directly to a terminal `FACTS_*` rejection class.

### Prompt module import + parameterization

```ts
// factsSeam.ts
import {
  buildFactExtractionPrompt,
  FACTS_PROMPT_ASSISTANT_PREFILL,
  FACTS_PROMPT_ASSISTANT_PREFILL_STRICT,
} from "../../llm/prompts/ingestion/factExtraction";
```

Prompt module exports:
- A pure builder function `buildFactExtractionPrompt(inputs): string` (no I/O, no DB, no mutable state).
- Prefill constants (`FACTS_PROMPT_ASSISTANT_PREFILL`, `FACTS_PROMPT_ASSISTANT_PREFILL_STRICT`).
- A body-cap constant (`FACTS_PROMPT_BODY_CAP_CHARS = 8000`) and a max-tokens default (`FACTS_DEFAULT_MAX_TOKENS = 800`).

The seam constructs `inputs` from the loaded candidate row, calls the builder, hands the string to `callHaikuForFacts`.

### Idempotency

- Column: `ingestion_candidates.facts_extracted_at` (timestamptz, nullable). Schema added by 12e.5a (verified at `schema.ts:651`).
- Pre-call predicate: **the seam itself does NOT short-circuit on already-extracted candidates** (factsSeam.ts:24–27). Idempotency lives at the **row-selection layer** in the CLI: `eq(status, 'llm_relevant') AND isNull(factsExtractedAt)` (runIngestionEnrich.ts:106–109).
- Written on success: `facts` (JSONB), `facts_extracted_at` (now), `facts_extraction_raw` (audit blob), `status` advances to `facts_extracted`.
- Written on failure: `status = 'failed'`, `status_reason = facts.rejectionReason ?? 'facts_parse_error'`, `facts_extraction_raw` populated when at least one Haiku call returned text. **`facts_extracted_at` is NOT set on failure**, so the row stays selectable for re-try.

### Failure-mode classification

`FACTS_REASONS` constants in factsSeam.ts:79–86:
```
FACTS_PARSE_ERROR, FACTS_RATE_LIMITED, FACTS_TIMEOUT,
FACTS_NO_API_KEY, FACTS_EMPTY, FACTS_API_ERROR
```

Mapping from `HaikuFailureReason` → `FactsReason` (factsSeam.ts:142–165): timeout/no_api_key/empty pass through; api_error is heuristically split into FACTS_RATE_LIMITED vs FACTS_API_ERROR by string-matching `"429"` or `"rate"` in `detail`. Parse failures (JSON.parse + Zod) become FACTS_PARSE_ERROR after the parse-retry attempt fails.

Propagation: failure classes flow back via `FactsSeamResult.rejectionReason` (typed). The orchestration body in `enrichmentJob.ts:252–266` writes `status = 'failed'` and `status_reason = facts.rejectionReason ?? 'facts_parse_error'`.

### Logging / telemetry

Plain `console.log` / `console.warn` lines with structured kv-shape strings (factsSeam.ts:183–204):
```
[ingestion-facts] candidate=<id> ok=true fact_count=<n> latency_ms=<ms> attempts=<n>
[ingestion-facts] candidate=<id> rejected reason=<class> attempts=<n>
```
No Sentry integration; that's deferred to 12e.5c per the roadmap.

### Decision surfaced

For 12e.5b, this whole shape pattern-applies. Recommendation: build `haikuTierClient.ts` (one wrapper, parameterized by tier) + `tierGenerationSeam.ts` (one seam, takes a tier arg) rather than three of each. The tier label is the only parameter that changes call-to-call; the transport, prefill discipline, retry policy, and failure-class taxonomy all carry forward unchanged. Three near-identical wrappers and three near-identical seams would be a code-smell redundancy.

---

## 3. Schema landing for tier outputs (the 12e.5b schema crux)

### What §5.4 says

> Output written to event row's `why_it_matters_template` text-as-JSON column matching the existing `stories` shape: `{accessible: {thesis, support}, briefed: {thesis, support}, technical: {thesis, support}}`.

### Current schema state

`backend/src/db/schema.ts`:

`events` (lines 577–599):
```
id, sector, headline, context, why_it_matters, why_it_matters_template (TEXT),
primary_source_url, primary_source_name, author_id,
facts (JSONB notNull default {}), embedding (bytea placeholder),
published_at, created_at, updated_at
```

`ingestion_candidates` (lines 633–671):
```
id, ingestion_source_id, external_id, url,
raw_title, raw_summary, raw_published_at, raw_payload, content_hash,
body_text, sector, llm_judgment_raw,
facts (JSONB nullable),                          ← 12e.5a
facts_extracted_at (timestamptz nullable),       ← 12e.5a
facts_extraction_raw (JSONB nullable),           ← 12e.5a
status, status_reason, resolved_event_id,
discovered_at, processed_at
```

`ingestion_candidate_status` enum (lines 50–61):
```
discovered, heuristic_passed, heuristic_filtered,
llm_rejected, llm_relevant, facts_extracted,
enriching, published, duplicate, failed
```

**What's already provisioned for tier output:** nothing on `ingestion_candidates`. `events.why_it_matters_template` exists (TEXT, comment at lines 571–573 confirms it mirrors `stories.why_it_matters_template` and is consumed via the same parser at `backend/src/utils/depthVariants.ts`). But the events row doesn't exist at 12e.5b runtime — 12e.5c creates it.

The enum already has `enriching` (a placeholder marker carved out in 12e.1 for "in-flight enrichment"). It has not been used by any prior phase.

### Design decisions surfaced

**Decision 3a: three new columns vs one JSONB blob with three keyed entries**

The events-side destination is `why_it_matters_template` — a single TEXT-as-JSON column matching the 12a `WhyItMattersTemplate` shape. The candidate-side staging mirror should match that shape so 12e.5c's copy step is a one-liner (`UPDATE events SET why_it_matters_template = ic.tier_template`).

Three options for the candidate-side staging:

| option | description | pros | cons |
|---|---|---|---|
| A | one TEXT column `tier_template` (JSON-stringified `{accessible, briefed, technical}`) | mirrors final events shape exactly; copy is one-liner; fits existing `WhyItMattersTemplate` parser | partial-tier writes are awkward — must read-modify-write to merge a single-tier success |
| B | one JSONB column `tier_outputs` keyed by tier name | natively supports partial writes (`jsonb_set`); same one-liner copy via `tier_outputs::text` | introduces JSONB↔TEXT type mismatch at the copy boundary unless events column is changed too |
| C | three TEXT columns `tier_accessible`, `tier_briefed`, `tier_technical` | partial writes are trivial (independent column writes); independent retries surface naturally | copy step assembles three columns into one JSON blob; three columns clutter the table |

**Recommendation: B (one JSONB column on `ingestion_candidates`)**. Rationale:
- Partial-tier writes via `jsonb_set` (or Drizzle's `set({ tierOutputs: sql\`jsonb_set(...)\` })`) keep the per-tier idempotency story clean (see §7).
- The JSONB↔TEXT mismatch at the copy boundary is one cast in 12e.5c: `whyItMattersTemplate: candidate.tierOutputs::text`. Trivial.
- Mirrors the existing `facts` column (also JSONB nullable). Keeps the candidate staging area uniform.
- Avoids the cluttered-table trap of option C.

Companion staging columns (mirror facts shape):
- `tier_outputs JSONB` — `{accessible, briefed, technical}` partial object; entries appear as each tier completes.
- `tier_outputs_completed_at TIMESTAMPTZ` — set when **all three** tiers have succeeded (the all-or-nothing marker that gates status advance to `enriching` or a new `tier_generated` value).
- `tier_outputs_raw JSONB` — array (or three-keyed object) of audit blobs, mirroring `facts_extraction_raw`.

**Decision 3b: stage on candidates first vs land directly on events**

The events row does not exist at 12e.5b runtime. Spec 12e.5c is the step that creates events (`… → generate-tiers × 3 → write-event`). Therefore staging on candidates is the only viable path; the "land directly on events" option is not actually open. **Recommend: stage on `ingestion_candidates`. Add a §5.4 12e.5b clarification line per §1 above.**

### Status enum question

Should there be a new `tier_generated` enum value between `facts_extracted` and `enriching`? Pattern from 12e.4 (added `llm_relevant`) and 12e.5a (added `facts_extracted`) suggests yes — each LLM-stage success gets its own enum value to make the status diagram legible. Recommend: **add `tier_generated`** to the enum in migration 0019 (or whatever NNNN this lands at — current head is post-0015 per CLAUDE.md §3).

### Open questions for the planner

- Confirm column name `tier_outputs` (alternatives: `why_it_matters_template`, `tier_template`).
- Confirm migration adds `tier_generated` to the enum, or whether `enriching` is meant to absorb this state.
- Confirm `tier_outputs_completed_at` semantics — written only when all three tiers succeed (recommended) vs written whenever any tier succeeds.

---

## 4. Prompt-module organization

`backend/src/llm/prompts/ingestion/` contents:
```
factExtraction.ts   (12e.5a, 113 lines)
relevanceGate.ts    (12e.4,   84 lines)
```

Both export the same shape: a `build*Prompt(inputs)` function, prefill constants (`*_PROMPT_ASSISTANT_PREFILL` and `*_PROMPT_ASSISTANT_PREFILL_STRICT`), a body-cap constant, and a max-tokens default.

The 12e.5a author noted at the top of `factExtraction.ts`:
> "Hard cap on body chars passed to the model. Reuses the relevance-gate cap (8000 chars ≈ 2500 input tokens at Haiku tokenization). Re-export under a facts-specific alias so a future divergence (e.g. 12e.8 soak shows facts hide past char 8000 and we lift the cap for 12e.5a only) is a one-line change."

The pattern is explicit: **per-prompt copies of constants**, even when identical, so independent tuning is a one-line edit.

### Design decision

Spec line says: `(`tierAccessible.ts`, `tierBriefed.ts`, `tierTechnical.ts`)`. So the spec has already chosen **three files**.

Three options against the spec:

| option | shape | argument |
|---|---|---|
| A — three files (spec) | `tierAccessible.ts`, `tierBriefed.ts`, `tierTechnical.ts`, each exporting its own `build*TierPrompt` and constants | matches spec; per-tier redline surface in stage 1.5 is clean (one diff per file); per-tier prompt iteration in 12e.8 audit is a small surface area |
| B — one file three exports | `tierPrompts.ts` exporting `accessiblePrompt`, `briefedPrompt`, `technicalPrompt` | shares the system-instruction scaffolding and the input schema in one place; reduces three copies of `truncateBody` to one |
| C — one file, one builder, tier as parameter | `tierGeneration.ts` exporting `buildTierPrompt(inputs, tier)` with a per-tier mini-config | tightest DRY; matches the wrapper-side recommendation in §2 |

**Recommendation: A (three files), per spec.** Rationale beyond "match the spec":
- Stage 1.5 redline. The planner is going to write three different system prompts that diverge meaningfully on register, jargon assumption, and audience framing. Three files surfaces those differences cleanly in `git diff` (one file ≈ one tier's voice). One file with three exports forces stage 1.5 reviewers to context-switch repeatedly between tiers within a single hunk.
- 12e.8 100-call audit. When the soak surfaces "the technical tier hallucinates more than the others," the prompt edit is to one file. The blast radius is per-tier.
- The shared bits (input shape, body cap, prefill constants) are shareable via a small `_shared.ts` peer module without forcing the prompts themselves into one file.

The wrapper side (one parameterized client + one parameterized seam, §2) and the prompt side (three files) are not in tension: the wrapper imports the right `build*TierPrompt` based on a tier argument. Three prompt files, one wrapper, one seam.

### Open questions

- Confirm spec-named filenames (`tierAccessible.ts` etc.) or rename to `tier-accessible.ts` (kebab-case, matches Next.js convention but not the existing `relevanceGate.ts` / `factExtraction.ts` camelCase).
- Confirm whether to extract a `_shared.ts` module for the body-cap + prefill constants, or accept the per-file copies pattern that 12e.5a established.

---

## 5. `max_tokens` budgeting per tier

### Anchors

From `backend/src/services/commentaryPromptV2.ts:46–68`, the established per-tier word budgets for the existing 12c/12d Haiku commentary path:

| tier | thesis | support | total target words |
|---|---|---|---|
| accessible | 2 sentences, ~35 words | 3–4 sentences, ~70 words | ~105 |
| briefed | 2 sentences, ~40 words | 3–5 sentences, ~90 words | ~130 |
| technical | 1–2 sentences, ~40 words | 4–6 sentences, ~130 words | ~170 |

12c/12d sizing context (`haikuCommentaryClient.ts:42–47`):
> "12d: bumped from 600 → 800. Technical depth at 20% over budget (~210 words) × ~1.5 tokens/word for jargon-heavy output + JSON envelope ≈ 330 tokens; 600 was tight on tail cases and the failure mode (silent truncation mid-JSON) is much worse than 200 wasted tokens per call."

Existing constants for reference:
- `HAIKU_MAX_TOKENS = 800` (12d, sized for the worst-case technical depth)
- `FACTS_DEFAULT_MAX_TOKENS = 800` (12e.5a)
- `RELEVANCE_DEFAULT_MAX_TOKENS = 400` (12e.4)
- `depthVariantGenerator.ts:87` uses `max_tokens: 600` for the offline regeneration (older, narrower budget; not request-path)

### Tokens-per-word working assumptions

- Plain English (accessible): ~1.3 tokens/word (Haiku tokenization, content words mostly in vocabulary).
- Briefed (light jargon): ~1.4 tokens/word.
- Technical (jargon-heavy, model names, numbers): ~1.5 tokens/word.

### Computed per-tier ceilings

Per-tier output = (target words × tokens/word) + JSON envelope (~30 tokens for `{"thesis":"…","support":"…"}`) + 20% headroom for tail cases (12d's empirical-justified margin).

| tier | target words | × tok/word | base tokens | + envelope | × 1.2 headroom | rounded ceiling |
|---|---|---|---|---|---|---|
| accessible | 105 | 1.3 | 137 | 167 | 200 | **300** |
| briefed | 130 | 1.4 | 182 | 212 | 254 | **400** |
| technical | 170 | 1.5 | 255 | 285 | 342 | **500** |

### Recommendation

**Asymmetric ceilings, per tier:**
- `TIER_ACCESSIBLE_MAX_TOKENS = 300`
- `TIER_BRIEFED_MAX_TOKENS = 400`
- `TIER_TECHNICAL_MAX_TOKENS = 500`

### Justification of asymmetry

The brief explicitly warns against picking a round number for symmetry. The asymmetry tracks the per-tier word budget that's already locked into 12c/12d's prompt module — accessible is genuinely shorter than technical by ~60% in target word count, and tokenization compounds that gap (accessible has no jargon, technical has the most). Picking 800 across the board (matching `HAIKU_MAX_TOKENS`) over-allocates the accessible call by ~2.5×, which doesn't directly cost more (Anthropic charges output tokens, not budget) but makes truncation-safety reasoning fuzzier — a 300-ceiling that hits truncation is a real signal that the prompt is too loose; an 800-ceiling that hits truncation means the model went off the rails, an entirely different debug path.

The asymmetry also makes the per-tier failure-mode telemetry interpretable. If the technical tier truncates regularly at 500 but accessible never truncates at 300, the diagnostic conclusion is "technical's word budget needs widening" — clear and actionable. If both ran at 800, both would show the same blank truncation rate and the per-tier signal vanishes.

### Total cost-per-candidate estimate

12e.5a is ~$0.05–$0.10/day at full deployment (per the §1 audit's reasoning, ~10–25 candidates/day × 1 facts call each). 12e.5b adds 3 calls per surviving candidate. Output tokens at the proposed ceilings: 300+400+500 = 1200 tokens vs facts' ~800. At Haiku output pricing the 12e.5b stage is ≈1.5× the facts stage in cost-per-candidate, so projected total ≈ $0.075–$0.15/day for 12e.5b alone. Roadmap §12e.0 ¶5 budgets "5 Haiku calls per surviving candidate" — these numbers fit under that envelope.

### Open questions

- Confirm whether the per-tier word budgets in `commentaryPromptV2.ts` are the right anchor, or whether the planner intends 12e.5b to produce something different in length (the per-user, per-story commentary path of 12c is per-user-personalized; 12e.5b is per-event role-neutral grounding, so the lengths could legitimately diverge).
- Confirm the 1.2× headroom multiplier — 12d empirically settled on it for one tier, but 12e.5b has three tiers and the tail-case distributions could differ.

---

## 6. Tier-call input shape

### Spec line (§5.4 12e.5b verbatim)

> "Each consumes the persisted facts plus the article body and produces `{thesis, support}` for that tier."

So the spec confirms two inputs: **persisted facts + article body**. No mention of headline, source, sector, or other metadata.

### Comparison with 12e.5a

Facts extraction takes `{title, bodyText, sector}` (factExtraction.ts:33–39). The sector is "soft context, not in the system instruction" (line 23–25), framed in the user message as "tagged as X; use as context but extract facts that appear in the body."

### Decision surfaced

What 12e.5b inputs should include beyond "facts + body" per the spec:

| input | argument for | argument against |
|---|---|---|
| facts (from `ingestion_candidates.facts`) | spec says so; the whole point of 12e.5a was to produce this grounding | none |
| body text (from `ingestion_candidates.body_text`) | spec says so; lets the model draw direct quotes/specifics if the facts blob is too dense or too sparse | none |
| title/headline (from `raw_title`) | helps the model orient quickly, especially the technical tier where the framing depends on what kind of event it is (earnings vs research vs policy) | strictly redundant with the facts blob if facts are well-extracted |
| sector (from `sector`) | per-tier prompts differ by domain — technical-AI prompt assumes ML vocabulary, technical-finance assumes accounting/markets vocabulary | the prompts could be sector-agnostic and rely on the model's own classification; adding sector closes the loop |
| source name (from `primary_source_name`) | source quality matters for register — "this is from Anthropic's blog" vs "this is from Reddit" might shift voice | drift from the per-tier framing; more a thing for ranking than commentary |

### Recommendation

Identical inputs across all three tiers: **facts + body + title + sector**. Rationale:
- Facts + body: per spec.
- Title: orientation cheap, payoff is real for thesis quality. The 12e.5a builder already takes title; no reason to drop it.
- Sector: per-tier prompts genuinely diverge by sector vocabulary; passing it as soft context (same framing as 12e.5a) lets the prompt say "you're writing for an AI insider" vs "a finance pro" without needing three sector × three tier = nine prompt files.
- Identical across tiers (vs diverging): tiers diverge in **register**, not in **what they know about the article**. The same set of facts and the same body should produce three different reads of the same event, not three different fact bases. Diverging inputs would conflate register with grounding, and the all-three-from-same-grounding promise is the whole point of 12e.5a's "shared grounding" phrasing in §5.4 ¶5.

### Open questions

- Confirm sector-as-soft-context approach matches the planner's intent, or whether per-sector prompt branches are wanted.
- Confirm primary_source_name is excluded — it's not in `ingestion_candidates` directly (it'd require a join up to `ingestion_sources.display_name`).

---

## 7. Idempotency strategy for the trio

### Decision space

Three Haiku calls per candidate; each can independently succeed or fail. Two strategies:

**Strategy A — one idempotency marker (all-or-nothing).** Single column `tier_outputs_completed_at`, set only when all three tiers succeed. Any tier failure → the row stays selectable for retry, and the retry re-runs all three tiers. Status advance to `tier_generated` (or `enriching`) blocked until all three succeed.

**Strategy B — three independent markers (per-tier idempotency).** Inside `tier_outputs JSONB`, each tier's success is independently observable: `tier_outputs.accessible` is set or absent. Retry path picks up only the missing tiers via per-tier predicate (e.g., `tier_outputs->'technical' IS NULL`). Status advance to `tier_generated` requires all three keys present.

### Failure semantics under each strategy

If `briefed` succeeds and `technical` fails:

- A: row stays at `facts_extracted` with `status_reason = 'tier_partial'` (or similar). Next CLI invocation re-runs all three tiers, paying for accessible + briefed again. Cost: extra 2 Haiku calls on retry.
- B: row stays at `facts_extracted` with `tier_outputs = {accessible: {...}, briefed: {...}}`. Next CLI invocation picks up the row, sees only `technical` is missing, runs that one tier. Cost: 0 extra Haiku calls on retry.

### Recommendation: Strategy B (three independent markers)

Rationale:
- **Cost.** Tier generation is the most expensive stage in the pipeline (~3× facts, ~6× relevance gate). Re-running already-succeeded tiers on retry violates the implicit rate-budget in §12e.0 ¶5 ("5 Haiku calls per surviving candidate") — a partial failure under Strategy A would cost 5+2=7 calls, not 5.
- **Operational legibility.** During the 24h soak (§5.4 12e.8), the cohort of partially-completed candidates is the most diagnostic signal — "technical tier rate-limits 3× more often than accessible" is the kind of pattern the soak is designed to catch. Strategy A erases this signal by treating all partial states as identical "retry me" rows.
- **Implementation cost is low.** `jsonb_set` writes are one-line in Drizzle (`set({ tierOutputs: sql\`jsonb_set(...)\` })`). Per-tier presence check in the CLI query is one additional `WHERE` clause.
- **Status semantics stay clean.** Status advance to `tier_generated` is gated on `jsonb_object_keys(tier_outputs)` containing all three names. The check is one `EXISTS` predicate.

### Status / state machine for partial states

| state | meaning | retry path |
|---|---|---|
| status='facts_extracted', tier_outputs=NULL or '{}' | no tiers run yet | run all three |
| status='facts_extracted', tier_outputs={accessible: {...}}, …missing some keys | partial success | run only missing tiers |
| status='tier_generated', tier_outputs has all three keys | complete | nothing to do; 12e.5c picks up |
| status='failed', status_reason in TIER_REASONS | terminal failure on a specific tier (e.g., persistent parse error) | manual intervention; re-queue with `--id=<uuid>` |

I do **not** recommend introducing a `tier_partial` enum value. Partial states are observable from the JSONB column shape; status stays `facts_extracted` until the trio completes, then advances to `tier_generated`.

### When does a partial-state retry give up?

Open question for the planner: is there a per-row failure ceiling (e.g., 3 partial-retry attempts → mark `failed`)? 12e.5a doesn't have one — failures are terminal on first occurrence. Recommend matching 12e.5a's pattern: one parse-retry per tier per CLI invocation, then mark that **specific tier** as failed in `tier_outputs_raw` and let the row sit. 12e.5c's dead-letter handling (§5.4 12e.5c) is the right place for "retry-N-times-then-DLQ" policy.

### Open questions

- Confirm Strategy B is acceptable (cost-asymmetric retry on partial failures vs simpler all-or-nothing).
- Confirm status enum keeps `facts_extracted` until all three tiers complete, vs introducing `tier_partial`.

---

## 8. Worker seam shape (for 12e.5c to wire later)

12e.5c owns chain orchestration. 12e.5b's deliverable is the seam definition, the seam implementation, and the wiring into `EnrichmentSeams` interface in `enrichmentJob.ts`.

Current `EnrichmentSeams` interface (enrichmentJob.ts:62–86):
```ts
generateTier?: (
  candidateId: string,
  tier: "accessible" | "briefed" | "technical",
  facts: ExtractedFacts,
) => Promise<{ thesis: string; support: string }>;
```

This signature was scaffolded by 12e.5a in anticipation. Two remarks:
- It takes a **single tier per call** — confirming Strategy 2's "one seam, parameterized by tier" recommendation in §2.
- It does NOT take `body` — yet the spec says "consumes the persisted facts plus the article body." Recommend extending the signature to:
  ```ts
  generateTier?: (
    candidateId: string,
    tier: "accessible" | "briefed" | "technical",
  ) => Promise<TierSeamResult>;
  ```
  i.e., the seam loads the candidate (gets facts + body + title + sector internally), mirroring the `runFactsSeam(candidateId)` shape. Passing facts as an arg leaks the orchestration's internal state into the seam contract; loading once per tier is fine (three small selects per candidate, dwarfed by the Haiku call latency).

Where it would be called from inside `enrichmentWorker.handle()`: after the facts step (enrichmentJob.ts:283 returns currently). Insert a post-facts block that iterates over the three tiers (or runs them in parallel — see "open question" below), writes each result via `jsonb_set`, advances status to `tier_generated` once all three succeed.

What the `FUTURE` comment in `enrichmentJob.ts` should look like post-12e.5b: the existing line 6 ("3. fact extraction (12e.5a)") gets a `4.` for tier generation matching the seams-actually-exist pattern; `5.` (cluster + write event) updates to mention 12e.5c. The line `// extract-facts → generate-tiers × 3 → write-event` from §5.4 12e.5c becomes the canonical comment in the orchestration body once 12e.5c lands. **Do not wire it in 12e.5b.**

### Open question for the planner (not for 12e.5b implementation)

Should the three tier calls run in parallel (`Promise.all`) or sequentially? Argument for parallel: 3× wall-clock savings per candidate, and Haiku rate limits at ~50 RPS shouldn't be threatened by a per-candidate burst of 3 calls. Argument for sequential: matches 12e.5a's facts seam's single-call-at-a-time discipline; debugging is simpler when one call's failure doesn't race another's success. Default **sequential** unless the soak shows wall-clock latency is a real problem; this is a 12e.5c (or 12e.8) optimization, not 12e.5b's call.

---

## 9. Smoke-runner pattern

`backend/src/scripts/` contents (verified via Glob):
```
auditStoryUrls.ts, regenerateDepthVariants.ts, runAggregation.ts,
runIngestionEnrich.ts, runIngestionPoll.ts, seed-migration-state.ts,
seedStories.ts, sendDigestNow.ts, smokeTest.ts, wipeDevStories.ts
```

The 12e.5a smoke runner is **not a separate file**. Smoke is run via the existing `runIngestionEnrich.ts` (verified at `backend/src/scripts/runIngestionEnrich.ts`, 164 lines). It accepts `--candidate-id=<uuid>` or `--source=<slug>`, walks the candidate cohort at `status IN ('discovered', 'heuristic_passed', 'llm_relevant')` (with the 12e.5a-added gate `AND facts_extracted_at IS NULL` for the `llm_relevant` branch), and runs each through `processEnrichmentJob` with all three seams wired (`runHeuristic`, `runRelevanceGate`, `runFactsSeam`).

For 12e.5b the recommended smoke shape:
- **Extend `runIngestionEnrich.ts`** to wire the new tier-generation seam. The cohort query needs another branch: `status='facts_extracted' AND <tier_outputs has missing keys>`. Per the §7 idempotency recommendation, the predicate is something like `(tier_outputs IS NULL OR jsonb_object_keys(tier_outputs) ⊊ {'accessible','briefed','technical'})`.
- **Smoke runs at N=5 candidates fire N×3=15 live Haiku calls.** Reach the call count via candidate count (N=5), not by inflating N to manufacture more calls. The brief calls this out explicitly. Acceptable smoke cost at ~$0.075–$0.15/day rate is well under $0.01 per smoke session.
- The 12e.5a smoke writeup at `docs/discovery/phase-12e5a-smoke-test.md` is the format template; expect a `phase-12e5b-smoke-test.md` peer post-implementation.

### Open questions

- Confirm whether `runIngestionEnrich.ts` extension is preferred vs a new `runIngestionTiers.ts` (separation of concerns vs CLI-surface bloat).
- The `--candidate-id=<uuid>` branch should support tier-only retries (e.g., re-run only the missing tier on a partial-state row) per Strategy B in §7.

---

## 10. Test surface state

Confirmed broken on this branch (`claude/epic-banach-de0c78`, HEAD `e97bc35`). Ran `npm test --workspace=backend` from the worktree root (test runs only — no install).

Result:
```
Test Suites: 2 failed, 50 passed, 52 total
Tests:       694 passed, 694 total
Snapshots:   0 total
Time:        45.674 s
```

The two failing suites are `tests/ingestion/heuristicSeam.test.ts` and `tests/ingestion/bodyExtractor.test.ts` (the latter via Jest's transitive load of `bodyExtractor.ts → jsdom → html-encoding-sniffer`). The Jest transform error is identical for both:

```
Jest encountered an unexpected token
…
C:\dev\signal-app\node_modules\@exodus\bytes\encoding-lite.js:1
export {
^^^^^^
SyntaxError: Unexpected token 'export'
```

Origin: `html-encoding-sniffer` (a transitive dep of `jsdom`) imports `@exodus/bytes`, which ships ESM that Jest's default `transformIgnorePatterns` excludes from Babel transformation. The 694 tests that **do** pass include the new ingestion-related suites that don't touch jsdom (`factsSeam.test.ts`, `relevanceSeam.test.ts`, `enrichmentJob.test.ts`, etc.).

**This is on `main` as well** — the regression predates 12e.5a and isn't blocking 12e.5b's audit. Per the kickoff brief, the audit confirms it and does not fix it. Recommend the planner schedules a separate cluster session to add a `transformIgnorePatterns` exception for `@exodus/bytes` (or downgrade the affected dep), tracked separately from the 12e.5b workstream.

---

## Summary of cruxes for stage 1.5 review

In order of redline urgency:

1. **Schema landing for tier outputs** (§3). Recommendation: stage on `ingestion_candidates` with one new JSONB column `tier_outputs` keyed by tier name (accessible/briefed/technical), plus `tier_outputs_completed_at` timestamp and `tier_outputs_raw` audit blob. Add `tier_generated` to the `ingestion_candidate_status` enum. 12e.5c copies `tier_outputs::text` into `events.why_it_matters_template`. Spec ambiguity in §5.4 12e.5b about staging vs direct-to-events should be clarified by the planner in a one-line edit.

2. **Prompt-module organization** (§4). Recommendation: three files (`tierAccessible.ts`, `tierBriefed.ts`, `tierTechnical.ts`) per spec. Three-file shape coexists with one parameterized wrapper + one parameterized seam (§2).

3. **`max_tokens` per tier** (§5). Recommendation: asymmetric ceilings — accessible 300, briefed 400, technical 500 — anchored to existing 12c word-budget table in `commentaryPromptV2.ts` and Haiku tokenization rates that compound the asymmetry.

4. **Tier-call input shape** (§6). Recommendation: identical inputs across all three tiers — facts + body + title + sector. Sector as soft context per the 12e.5a pattern; rejects "diverging inputs per tier" as a register-vs-grounding conflation.

5. **Idempotency strategy for the trio** (§7). Recommendation: Strategy B (three independent markers inside the `tier_outputs` JSONB blob). Partial successes retry only missing tiers; status stays `facts_extracted` until trio completes. No `tier_partial` enum value.

Lower-priority items the planner may also want to redline:
- Worker seam signature (§8) — extend to drop the `facts: ExtractedFacts` arg and let the seam load internally, mirroring `runFactsSeam`.
- Sequential vs parallel tier calls (§8 open question, defer to 12e.5c).
- Test-suite jsdom regression (§10) — out of scope for 12e.5b; tracked separately.

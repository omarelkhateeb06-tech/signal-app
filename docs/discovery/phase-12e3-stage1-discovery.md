# Phase 12e.3 — Stage 1 discovery audit

**Date:** 2026-04-27
**HEAD at audit:** `11195e0 feat(ingestion): Phase 12e.2 — RSS adapter + dispatch path + manual trigger CLI (#46)`
**Scope:** read-only discovery for heuristic filter + body fetch sub-session
**Findings doc path:** `docs/discovery/phase-12e3-stage1-discovery.md` — mirrors the convention of the prior `docs/discovery/phase-12e2-stage1-reaudit.md`. The prompt's preferred `docs/audits/` directory does not exist in the repo; same call as the smoke-test doc.

## Pre-flight

- **CWD:** `C:\dev\signal-app` ✓
- **Branch:** `main` (switched from `chore/phase12e2-smoke-test`, where the previous session ended). HEAD: `11195e0` (PR #46 merge). In sync with `origin/main`.
- **Smoke-test PR not yet merged.** The smoke-test findings doc at `docs/discovery/phase-12e2-smoke-test.md` lives only on the unmerged `chore/phase12e2-smoke-test` branch. Audited via `git show` for this discovery pass.
- **Clean tree** at audit start. No uncommitted changes.

## A. Roadmap spec read

The prompt referred to "§5.4 (Phase 12e.3)"; the actual structure is `## 5. V1 Engineering Detail` → `### 5.4 Phase 12e — Ingestion & Event Model` → individual `#### 12e.N` sub-headings. 12e.3 is the §12e.3 sub-heading inside §5.4. Same logical content; flagging the section-numbering reference for clarity.

### Verbatim spec for 12e.3

> **#### 12e.3 — Heuristic filter + body fetch (~1 session)**
>
> Heuristic stage: recency cutoff (36h), body length floor, noise pattern detection (link-bait, listicle, paid-content markers). Body extraction via `@mozilla/readability` + `jsdom` for survivors. Candidate status advances to `heuristic_passed` or `heuristic_rejected` with reason. Still no LLM.

### Heuristic filter list (per spec)

1. **Recency cutoff** — 36h. Roadmap commits to the number; whether it's hardcoded vs. configurable is unspecified.
2. **Body length floor** — number unspecified. The roadmap says "body length floor" but doesn't state a threshold.
3. **Noise pattern detection** — three categories: link-bait, listicle, paid-content markers. Concrete patterns / regex list unspecified.

### Library commitments

- `@mozilla/readability` for body extraction.
- `jsdom` as the DOM provider readability needs.

### Status enum values mentioned (in spec)

- `heuristic_passed`
- `heuristic_rejected`

**⚠️ This conflicts with the schema.** See §B and §F1 below.

### Boundary with adjacent sub-sessions

- **Inherits from 12e.2:** `ingestion_candidates` rows with `status='discovered'`, populated from RSS poll. URL canonicalized, `content_hash` populated.
- **Hands off to 12e.4 (LLM relevance gate):**
  > One Haiku call per heuristic-survivor with structured-JSON output: `{ relevant: bool, sector: enum, reason: string }`. Status advances to `llm_relevant` or `llm_rejected`.
  So 12e.4 reads heuristic-survivors. 12e.3 must produce a state that 12e.4 can query against — i.e., a status value (or a status-plus-presence-of-body filter) that says "passed heuristic and ready for relevance gate".
- **Architecture context from 12e.5c:**
  > End-to-end chain: `ingestion-cron → fetch-source → evaluate-candidate (heuristic + relevance) → extract-facts → generate-tiers × 3 → write-event`.
  12e.5c collapses heuristic + relevance into one named "evaluate-candidate" stage. Implies they may live in the same worker / job module by then. 12e.1's seam design (`enrichmentJob.ts` with `runHeuristic` + `runRelevanceGate` as separate seam methods) is consistent with this — both seams consumed by one orchestration body.

## B. Existing locked decisions

### From 12e.1 (PR #43, scaffolding)

12e.1 didn't ship a discovery doc; the locked decisions are inferred from the code it shipped (`backend/src/jobs/ingestion/`, schema, migrations 0014–0015) and the §12e.0 architecture summary in the roadmap.

- **Two BullMQ queues, separate concurrency.** `signal-ingestion-poll` (HTTP I/O cadence) and `signal-ingestion-enrich` (LLM cadence). Adapter throughput doesn't compete with LLM throughput. (`enrichmentQueue.ts:1–6`.)
- **`enrichmentJob.ts` seam interface.** A pure orchestration body that consumes injected seam functions per downstream sub-session. **Critical for 12e.3:** the seam interface already names `runHeuristic` as the first stage:
  ```ts
  runHeuristic?: (candidateId: string) => Promise<{ pass: boolean; reason?: string }>;
  ```
  This is the exact return shape 12e.3 must implement. The shape **does not include** a body field — implying body fetch is either a side-effect (write to DB inside the seam call) or a separate concern from the heuristic seam.
- **`terminalStatus` enumeration in EnrichmentJobResult:**
  ```ts
  terminalStatus: "heuristic_filtered" | "llm_rejected" | "published" | "duplicate" | "failed";
  ```
  No `heuristic_passed`. The mental model in 12e.1 was: "filtered" is a terminal state for rejected-by-heuristic; pass advances to a non-terminal "next stage in flight" state (presumably `enriching` from the schema enum).
- **Adapter thrown errors carry stable string `failureReason` values.** `timeout | http_4xx | http_5xx | wrong_content_type | parse_error | network`. 12e.3's body fetch will hit similar conditions; reusing this taxonomy vs. extending vs. inventing a new one is a decision point (§F8).
- **Console-only logging with `[ingestion-*]` prefix; no Pino/Winston.** Aggregation/email workers identical. 12e.3 mirrors.

### From 12e.2 stage 1 audit + re-audit (PR #46 commit 1)

The re-audit doc lives at `docs/discovery/phase-12e2-stage1-reaudit.md`. Locked decisions surfaced or restated there that bear on 12e.3:

- **`content_hash` populated on `ingestion_candidates` from 12e.2.** SHA-256 of `(canonicalized_url + raw_title + raw_summary)` truncated to 32 hex chars. Available for 12e.3 reads but no UNIQUE constraint; cross-source duplicates land as separate candidates and unify at event clustering (12e.6).
- **URL canonicalization helper exists at `backend/src/utils/url.ts`.** Strict tracking-param strip list. 12e.3 doesn't need new URL work; reuse if needed.
- **Manual CLI pattern.** `runIngestionPoll.ts` mirrored from `runAggregation.ts`. 12e.3's CLI for manual heuristic invocation should mirror the same pattern.
- **No standardized local-dev DB.** Fresh-clone wall. 12e.3 stage 3 (merge) will need ephemeral Docker Postgres again, same as smoke. Tracked as #49 (per prompt).
- **Test pattern: `backend/tests/ingestion/`** subdir was introduced in 12e.2 for new ingestion tests. 12e.3 lands its tests under the same subdir.

### From 12e.2 implementation (PR #46)

- **`Candidate` type now carries `contentHash` + `rawPayload`.** `rawPayload` is the rss-parser item object; could be re-parsed for edge fields not in the normalized shape if needed (e.g., `category`, `creator`, `enclosure`).
- **`sourcePollJob` does NOT enqueue enrichment.** It persists candidates with `status='discovered'` and stops. The bridge from "candidate persisted" to "enrichment queue job created" doesn't exist yet — 12e.3 either adds it or leaves it for 12e.5c (which the roadmap names as the chain-orchestration session).
- **`processedAt` column is unused so far.** Available for 12e.3 to mark heuristic-stage processing time, or kept for an end-of-pipeline marker — decision point (§F6).

### From 12e.2 smoke test (chore branch, unmerged)

- **Verdict: clean.** No bugs in 12e.2 found at the runtime layer. 12e.3 inherits a working RSS adapter + dispatch + dedup.
- **Three real-world feeds verified end-to-end** with row counts matching expectation: `cnbc-markets` 30, `import-ai` 20, `semianalysis` 20 (Substack redirected to `newsletter.semianalysis.com` automatically; node fetch follows). All three are good test cases for 12e.3 — fully populated `ingestion_candidates` rows ready to be heuristic-filtered.
- **Anomaly noted: Node libuv assertion crash on Windows shutdown** (1 of 6 polls, post-completion). Filed as #47. Not blocking 12e.3.
- **Anomaly noted: CNBC channel title is `Earnings`, not `Markets`** — registry mislabel. Filed as #48. Not blocking 12e.3 (the heuristic filter doesn't care about source name); but if 12e.3 noise patterns include a "is this an earnings-roundup style listicle" check, CNBC's Earnings feed may have higher rejection rates than expected. Worth noting.

## C. Current schema state

### `ingestion_candidates` (current shape, post-0016)

From `backend/src/db/schema.ts:627–658`:

| column | type | constraints | notes |
|---|---|---|---|
| `id` | uuid | PK, `defaultRandom()` | |
| `ingestion_source_id` | uuid | NOT NULL, FK CASCADE → `ingestion_sources(id)` | |
| `external_id` | text | NOT NULL | dedup key half |
| `url` | text | NOT NULL | canonical |
| `raw_title` | text | nullable | |
| `raw_summary` | text | nullable | |
| `raw_published_at` | timestamptz | nullable | |
| `raw_payload` | jsonb | NOT NULL DEFAULT `'{}'` | full rss-parser item |
| `content_hash` | text | nullable | added in 0016 |
| `status` | enum `ingestion_candidate_status` | NOT NULL DEFAULT `'discovered'` | see enum list below |
| `status_reason` | text | nullable | this is where heuristic rejection reason lands |
| `resolved_event_id` | uuid | FK SET NULL → `events(id)` | |
| `discovered_at` | timestamptz | NOT NULL DEFAULT `now()` | |
| `processed_at` | timestamptz | nullable | not set by anything yet |

**Constraints / indexes:**
- `UNIQUE (ingestion_source_id, external_id)` (dedup; 12e.2 contract)
- `INDEX (content_hash) WHERE content_hash IS NOT NULL` (partial; for future cross-source clustering, 12e.6)
- `INDEX (status, discovered_at)` (likely already useful for "find me discovered candidates oldest first" — heuristic-stage worker query)

### `ingestion_candidate_status` enum (current values, schema.ts:50–58)

```ts
pgEnum("ingestion_candidate_status", [
  "discovered",
  "heuristic_filtered",  // ⚠️ NOT "heuristic_passed" / "heuristic_rejected"
  "llm_rejected",
  "enriching",
  "published",
  "duplicate",
  "failed",
])
```

**⚠️ Direct conflict with the roadmap spec.** Roadmap says status advances to `heuristic_passed` or `heuristic_rejected`; schema has only `heuristic_filtered` (singular). The 12e.1 mental model is clearly:
- Reject by heuristic → `heuristic_filtered` (terminal) + `status_reason`
- Pass by heuristic → advance to `enriching` (or stay at `discovered` until 12e.4 sets `llm_rejected` / kicks to enrichment).

This is decision point §F1.

### Body-related columns: NONE.

`ingestion_candidates` has **no `body`, no `body_text`, no `body_html`, no `body_length`, no `extracted_at`**. 12e.3 will need to add column(s) via migration 0017. Decision points around shape: §F2.

### Migration history

| filename | one-line summary |
|---|---|
| `0000_dashing_colleen_wing.sql` | initial schema (Phase 1) |
| `0001_phase6_search_index.sql` | search index for stories |
| `0002_phase9a_teams.sql` | teams |
| `0003_phase9b_team_settings.sql` | team settings |
| `0004_phase9_invite_revoked_at.sql` | team invite `revoked_at` column |
| `0005_phase11_api_keys.sql` | self-service v2 API keys |
| `0006_phase11c5_story_aggregates.sql` | weekly story aggregates |
| `0007_phase12a_depth_variants.sql` | depth-variant commentary column comment |
| `0008_phase12b_onboarding.sql` | onboarding profile fields |
| `0009_phase12c_commentary_cache.sql` | per-user/story/depth cache |
| `0010_phase12d_expandable_commentary.sql` | thesis/support expansion |
| `0011_a_create_drizzle_audit_schema.sql` | drizzle audit schema bootstrap |
| `0011_drop_phase12b_helper.sql` | drop stray phase12b helper |
| `0012_deprecate_drizzle_migrations_table.sql` | comment-only deprecation |
| `0013_rename_standard_tier.sql` | depth-tier rename (PR #41) |
| `0014_phase12e1_ingestion_sources.sql` | source registry table + seed |
| `0015_phase12e1_events_and_candidates.sql` | events, event_sources, ingestion_candidates |
| `0016_phase12e2_content_hash.sql` | add content_hash column to candidates (PR #46) |

**Next migration number: `0017_phase12e3_*.sql`.**

## D. Current ingestion code surface

### `backend/src/jobs/ingestion/sourcePollJob.ts`

**Summary:** Pure job body for the source-poll stage. Resolves the source row, gets the adapter from the registry, calls it, persists the returned candidates with `onConflictDoNothing` on `(source_id, external_id)`, advances source-row tracking (`last_polled_at`, `consecutive_failure_count`). Pure of HTTP/Redis; runnable from CLI.

**12e.3 plug point:** Nothing today bridges from "candidate persisted" to "enrichment queue job enqueued". 12e.3 is the natural place to add this bridge — either by extending `sourcePollJob` to enqueue an enrichment job per persisted row, or by a separate scanner job. (Decision point §F4.)

**Constraints:** The current code persists rows and exits. It does not advance `status` (relies on the column default `'discovered'`). It does not set `processed_at`. It does not enqueue follow-on work.

### `backend/src/jobs/ingestion/adapters/rss.ts`

**Summary:** Generic RSS/Atom adapter. Fetches `endpoint` with the configured UA, parses with `rss-parser`, normalizes items to `Candidate` shape, computes `external_id` (GUID or hash fallback) and `content_hash`. Throws classified error strings on fetch/parse failure.

**12e.3 plug point:** None directly — the adapter is the producer of `discovered` candidates that 12e.3 consumes. But 12e.3's body fetch may borrow the adapter's UA strategy (per-source `config.userAgent` override + `SIGNAL/12e.2 (+contact@signal.so)` default). Reusing that UA selector helper would be cleaner than copy-paste; refactor target if a shared `pickUserAgent(config)` helper makes sense.

**Constraints:** None on 12e.3 work directly.

### `backend/src/utils/url.ts`

**Summary:** Pure `canonicalizeUrl(url: string): string` per the strict strip list. No I/O.

**12e.3 plug point:** 12e.3 doesn't need URL canonicalization — the candidate URL is already canonical from 12e.2. Body fetch will use this URL as-is.

### `backend/src/scripts/runIngestionPoll.ts`

**Summary:** CLI wrapper around `processSourcePollJob`. Parses `--source=<slug>` or `--source-id=<uuid>`, calls the job body, logs the result, exits.

**12e.3 plug point:** Template for `runIngestionEnrich.ts` (or `runHeuristicFilter.ts`, depending on naming). 12e.3's manual trigger CLI mirrors this pattern.

### `backend/src/jobs/ingestion/enrichmentJob.ts`

**Summary:** Pure orchestration body for the post-heuristic pipeline (relevance → facts → tiers → cluster). Today: a no-op stub returning `{ terminalStatus: "failed", failureReason: "enrichment pipeline not yet implemented (Phase 12e.3+)" }`. Defines the **`EnrichmentSeams`** interface — the contract 12e.3 fills in for `runHeuristic`.

**12e.3 plug point:** Most likely, 12e.3 (a) implements `runHeuristic` against the `EnrichmentSeams` interface as `{ pass: boolean; reason?: string }`, and (b) writes the actual orchestration body — at least the heuristic-stage portion of it — replacing the stub. Whether 12e.3 also fully wires `enrichmentJob` to ALSO write status/body to the DB, or whether it just returns the pass/reason and a higher-level orchestrator handles persistence, is decision point §F3.

**Constraints:**
- Seam shape for `runHeuristic` is `{ pass: boolean; reason?: string }` — does NOT include a body. Body extraction is therefore either a side-effect within `runHeuristic` (writes to DB) or lives outside the seam (separate call).
- `terminalStatus` enum in `EnrichmentJobResult` includes `"heuristic_filtered"` (no `heuristic_passed`). Consistent with the schema's mental model.

### `backend/src/jobs/ingestion/enrichmentQueue.ts` + `enrichmentWorker.ts`

**Summary:** Full BullMQ queue + worker for `signal-ingestion-enrich`. Wired up in 12e.1; consumes `EnrichmentJobInput { candidateId }` jobs. The worker dispatches to `processEnrichmentJob`. Concurrency env-driven, separate from poll.

**12e.3 plug point:** No code changes here. The queue exists; 12e.3 just needs to start enqueueing onto it (or the dispatch path needs to start chaining).

**Constraints:** Default `attempts: 2`, exponential backoff 60s base, retain-on-complete 24h/1000 jobs, retain-on-fail 7 days. 12e.3 doesn't need to retune these.

### `backend/src/jobs/ingestion/types.ts`

**Summary:** Shared types: `Candidate`, `AdapterContext`, `AdapterResult`, `AdapterFn`. `Candidate` includes `contentHash` (12e.2 addition).

**12e.3 plug point:** May add a `HeuristicResult` type or similar for the seam's expanded contract, depending on §F3 outcome.

## E. Dependencies

`backend/package.json` audit:

- **`@mozilla/readability`:** ❌ **absent.** Stage 2 must add.
- **`jsdom`:** ❌ **absent.** Stage 2 must add.
- **Other relevant libs:**
  - **`dompurify`:** absent. Not directly required but worth knowing — readability returns sanitized HTML, but if we want extra-strict cleaning before storage, dompurify is the obvious add. Decision point §F7.
  - **`sanitize-html`:** absent.
  - **`cheerio`:** absent.
  - **`zod`:** present (v3.23.8). Available for body-shape validation.
  - **`rss-parser`:** present (v3.13.0) from 12e.2.
  - **`crypto`:** Node built-in, used by 12e.2 for content hash.

Two new deps to add in stage 2: `@mozilla/readability` and `jsdom`. Probably also `@types/jsdom` to devDependencies.

## F. Open decision points

### F1. Status enum: roadmap/schema mismatch — what's the intended state machine?

**Question:** Roadmap says "status advances to `heuristic_passed` or `heuristic_rejected` with reason"; schema has only `heuristic_filtered` (singular, terminal-rejected) plus the implicit "pass advances to next stage". Which mental model wins, and what does Stage 2 implement?

**Options:**
- **(a) Schema wins, roadmap drift fixed.** Heuristic-stage outcomes:
  - Reject → `status='heuristic_filtered'`, `status_reason=<reason>` (terminal in this stage; no further pipeline work).
  - Pass → `status='enriching'` (or some "in flight to next stage" marker), no `status_reason`. Body persisted alongside.
  This matches the existing `terminalStatus` typing in `enrichmentJob.ts` and the schema enum. **Default lean.**
- **(b) Roadmap wins, schema migration adds two values.** Migration 0017 extends the enum with `heuristic_passed` and `heuristic_rejected`, possibly deprecates `heuristic_filtered` (keep for historical rows; new writes use the new values). Doubles the enum surface; lets each pass/reject decision be explicit at every stage rather than mixing "current stage rejected" with "advanced to next stage".
- **(c) Hybrid.** Keep `heuristic_filtered` for rejection (existing semantics), add `heuristic_passed` only as a positive-marker state distinct from `enriching`. This makes the post-heuristic queue well-defined ("status = `heuristic_passed`") rather than implicit ("status = `discovered` AND has body").

**Trade-off:** (a) zero migration cost but encodes a non-obvious convention readers must learn. (b) explicit but bloats the enum and creates two terminal values (pass-then-fail-LLM vs. reject-by-heuristic) that mean the same thing for downstream queries. (c) middle ground; one extra enum value.

### F2. Body storage: where, what shape, what size cap?

**Question:** `ingestion_candidates` has no body column. What does 12e.3 add?

**Options:**
- **(a) `body_text` (text, nullable).** Plain-text only — readability-cleaned, no HTML. Simple to query, easy to LLM-prompt later, smaller. Loses inline structure (paragraph breaks may survive as `\n\n`; lists/headings as plain text).
- **(b) `body_html` (text, nullable) only.** Sanitized HTML from readability. Preserves structure for the relevance gate prompt (which may benefit from some semantic markup). Slightly larger.
- **(c) Both `body_text` + `body_html`.** Most flexibility, most space.
- **(d) `body` (jsonb) with `{ text, html, length }`.** Single column, structured. Slight overhead from JSONB but every consumer reads/writes one column.

**Default lean:** (a) `body_text` only. The relevance gate prompt is unlikely to need HTML structure; the fact-extraction prompt definitely doesn't. Keep storage tight.

**Trade-off:** (a) simplest but if 12e.4/12e.5 ever decides "we needed the headings" we re-fetch + re-extract for stale candidates. (b)/(c) bigger but future-proof. (d) consolidates but JSONB is a known-tricky shape for downstream querying.

**Sub-decision:** size cap. The roadmap doesn't specify. Suggested: 200 KB hard cap (truncate above; flag in `status_reason`), avoids pathological articles (some long-form pieces ARE 100KB+ of text). Confirm number with planner.

**Sub-decision:** `body_length` separate column or computed-on-read? If we want to query "candidates with body shorter than the floor" cheaply during smoke / debugging, a column helps. If not, computed is fine.

### F3. `runHeuristic` seam shape — what does it return + what side effects?

**Question:** The 12e.1 seam contract is `{ pass: boolean; reason?: string }`. Body fetch is part of 12e.3's scope but doesn't fit that shape. Where does the body land?

**Options:**
- **(a) Seam returns `{ pass, reason }` only; body fetch + DB write happens inside the seam as a side effect.** Pass-case writes body to DB before returning. Reject-case skips body fetch entirely. Cleanest from outside the seam. Tightly couples body fetch to heuristic stage.
- **(b) Extend seam shape to `{ pass, reason?, body? }`.** Caller (the orchestration body in `enrichmentJob`) writes everything. Seam stays pure-ish. Mismatches 12e.1's pure-seam intent slightly.
- **(c) Add a separate seam method `extractBody`.** Heuristic seam just returns pass/reason; orchestration body calls `extractBody` next on survivors. Most decoupled. Requires 12e.1 contract extension — modest scope creep.

**Default lean:** (a). The seam interface is already typed `{ pass, reason? }`; matching the existing contract is the lowest-friction path. 12e.3 implements `runHeuristic` that internally:
1. Loads the candidate row.
2. Runs the heuristic checks (recency, length, noise) using `raw_title`, `raw_summary`, `raw_published_at`, etc.
3. If pass → fetches body, runs readability+jsdom, writes `body_text` (and any other body cols) to the DB, returns `{ pass: true }`.
4. If reject → returns `{ pass: false, reason }` without fetching body.

**Trade-off:** (a) keeps seam contract intact but the heuristic seam is now doing both heuristic + body fetch, which is a lot for one method. (b)/(c) cleaner separation but requires extending the 12e.1 contract.

### F4. Bridge from poll to enrichment queue: where does the enqueue happen?

**Question:** Today, `sourcePollJob` persists candidates and stops. 12e.3 needs them to flow into the enrichment queue. Where does the enqueue call land?

**Options:**
- **(a) Extend `sourcePollJob`:** after successful persist, enqueue one `enrich-candidate` job per newly-inserted row. (`onConflictDoNothing` returns the inserted IDs already — that's the queue payload.) Tight coupling between poll and enrichment, but each poll cycle "completes" by handing off survivors.
- **(b) Standalone scanner job/worker:** runs on a separate cadence, queries `ingestion_candidates WHERE status='discovered'` periodically, enqueues each. Decoupled but adds a third worker.
- **(c) Defer to 12e.5c.** Roadmap §12e.5c says "Story write orchestration ... End-to-end chain: ingestion-cron → fetch-source → evaluate-candidate ..." — the chain orchestration is 12e.5c's named scope. 12e.3 ships only the heuristic-stage logic; the actual enqueue bridge waits.

**Default lean:** (a). Test-friendly (CLI calls `processSourcePollJob` and the chain proceeds), no new worker, matches the roadmap's "manual queue trigger only" stance for 12e.2/12e.3. (c) is technically purer but means 12e.3 has no end-to-end smoke without manual SQL nudges to enqueue jobs.

**Trade-off:** (a) couples poll and enrichment cadence. If LLM throughput slows, poll backs off via the queue's natural backpressure. Probably fine. (b) more flexible but more moving parts. (c) defers but loses 12e.3's smoke story.

### F5. Recency cutoff (36h): hardcoded, env, or per-source config?

**Question:** Where does the 36h number live in code?

**Options:**
- **(a) Hardcoded constant in the heuristic module.** `const RECENCY_CUTOFF_HOURS = 36;`. Simplest. Change requires deploy.
- **(b) Env var with default 36.** `RECENCY_CUTOFF_HOURS=36`. Tweakable per environment without deploy.
- **(c) Per-source config field on `ingestion_sources.config`.** Some sources publish slowly (academic, gov press releases) and might warrant a longer window.

**Default lean:** (a). The 12e.0 architecture summary already favors hardcoded knobs by default; per-source overrides only when evidence demands. None today. (b)/(c) can be added later trivially without migration if (b), with config plumbing if (c).

**Trade-off:** straightforward; (a) is the lowest-cost choice and matches the existing UA pattern (default constant + per-source `config.userAgent` override).

### F6. Body length floor: what number, and measured how?

**Question:** Roadmap says "body length floor" without a number. Stage 2 needs one.

**Options:**
- **What:** 200, 500, 1000 characters? Suggested **500 characters of plain text** as a starting floor. CNBC's typical news-summary description is ~120 chars (per prior audit), so 500 means we filter out title-only items but keep substantive briefs. Substack longreads are tens of thousands of chars — well above any floor.
- **When:** measured pre-fetch (against `raw_summary` from RSS) or post-extraction (against the readability'd `body_text`)?
  - **Pre-fetch (raw_summary):** cheap; rejects "headlines only" feeds before HTTP. CNBC's `<description>` is the test case (~120 chars avg).
  - **Post-extraction (body_text):** authoritative; only rejects the article itself is short. Costs an HTTP fetch on rejected items.

**Default lean:** **post-extraction** (body fetched, readability run, then length checked). Catches "the RSS summary was short but the article is long" cases. The pre-fetch shortcut for empty summaries can be a separate cheap gate (reject if `raw_summary IS NULL AND raw_title IS NULL`) without committing to a numeric floor.

**Trade-off:** post-extraction floor costs an HTTP fetch for items that fail. Acceptable: the recency cutoff already eliminates most of the volume; survivors are likely worth fetching to confirm.

### F7. Noise pattern detection: regex list, where stored?

**Question:** Three categories named: link-bait, listicle, paid-content. Concrete patterns unspecified.

**Options:**
- **(a) Constants in the heuristic module.** Three named arrays of regexes. Simple. Change requires deploy.
- **(b) Separate JSON file under `backend/src/jobs/ingestion/heuristics/` (or similar).** Edited as data, not code. Easy to refresh. Doesn't change code semantics.
- **(c) DB-backed (new `noise_patterns` table or row in a config table).** Lets ops adjust without deploy. Premature.

**Default lean:** (a). The patterns will need iteration during 12e.8 soak; deploy-time edits are fine for that cadence. (b) adds a file to maintain. (c) is overkill until volume justifies.

**Pattern starting list (decision point sub-question — do we lock these in stage 2 or just leave the structure and let soak inform the contents?):**
- **link-bait:** `/^(you won't believe|this one (weird )?trick|shocking|jaw-?dropping)/i`, `/\b(\d+ (things|ways|reasons))\b/i` (overlap with listicle)
- **listicle:** `/^(top|the )?\d+\s+(things|ways|reasons|tips|tricks|hacks|secrets)/i`, `/^(every|all the)\s+\w+\s+\w+\s+(ranked|rated)/i`
- **paid-content:** `/\b(sponsored content|advertisement|paid post|partner content|in partnership with)\b/i`, `/\bsponsored by\b/i`

Stage 2 doesn't need to ship the perfect list — just the structure, with placeholder patterns and a comment that 12e.8 soak refines them.

**Trade-off:** Over-aggressive patterns reject legitimate content (e.g., "Top 10 economic indicators of 2026" might be a real Bloomberg article). Conservative lists with iteration during soak is the safer path.

### F8. Body fetch failure classification: extend adapter taxonomy or new vocabulary?

**Question:** Body fetch hits the same kind of failures as feed fetch (timeout, 4xx, 5xx, network). Reuse the 12e.2 strings or invent new?

**Options:**
- **(a) Reuse the exact strings:** `timeout | http_4xx | http_5xx | wrong_content_type | parse_error | network`. (Plus `body_too_short` and any noise-pattern reasons as additional values.)
- **(b) Prefix-namespace:** `body_timeout`, `body_4xx`, `body_5xx`. Disambiguates source vs. body in the same `status_reason` field.
- **(c) Free-text:** No taxonomy; each rejection writes a human-readable string. Easier to read, harder to aggregate.

**Default lean:** (a) for fetch failures, with `body_too_short`, `noise_linkbait`, `noise_listicle`, `noise_paid`, `recency_too_old` as additional reason strings for the heuristic-specific cases. Keeps `status_reason` queryable as a categorical field.

**Trade-off:** taxonomy means we must enumerate up front. Adding values later is fine — column is plain text, no enum.

### F9. Body extraction failure handling: still pass heuristic? Separate state?

**Question:** Heuristic checks pass (recency OK, body floor TBD pre/post, no noise). Body fetch then fails (server 500, timeout). What state does the candidate land in?

**Options:**
- **(a) `heuristic_filtered` with `status_reason='body_fetch_failed'`.** Treat body-fetch as part of heuristic stage; failure rejects.
- **(b) Separate state** — but the schema doesn't have one. Needs migration.
- **(c) Retry path.** BullMQ already retries with backoff (default 2 attempts). After exhausted, (a) applies.

**Default lean:** (a) with BullMQ-default retries (already configured). Aligns with the schema's "filtered = rejected for any reason" model.

**Trade-off:** (a) means `heuristic_filtered` becomes a mixed bucket — some rows rejected by content (noise, age), some by infrastructure (404, timeout). The `status_reason` field disambiguates. If post-launch we want different downstream handling for infra-fail vs. content-rejected (e.g., re-try infra-fails periodically), we can split with a follow-up migration. Not blocking.

### F10. Test fixtures: real HTML or synthetic?

**Question:** Heuristic + body extraction tests need HTML inputs.

**Options:**
- **(a) Synthetic HTML** crafted per test case. Tight, deterministic, small. Doesn't exercise readability against real-world weirdness.
- **(b) Real HTML fetched from current articles** under `backend/tests/fixtures/articles/`, similar to `feeds/` for RSS. Readability tested against real outputs. Sizeable diffs (each article 50–500 KB).
- **(c) Both** — synthetic for the unit tests of the heuristic functions, real for the readability integration test.

**Default lean:** (c). Synthetic for unit tests of `isRecent()`, `meetsLengthFloor()`, `matchesNoisePattern()`. One real-HTML fixture per target source (cnbc, import-ai, semianalysis) for the body-extraction integration test.

**Trade-off:** real-HTML fixtures grow the repo (3 articles × ~100 KB ≈ 300 KB). Acceptable, mirrors the feeds-fixtures pattern.

## G. Followups & inherited state

- **#47 (libuv shutdown assertion on Windows CLI):** Not relevant to 12e.3 implementation. The crash is in `runIngestionPoll.ts`'s explicit `process.exit(0)`. If 12e.3 ships `runHeuristicFilter.ts` (or similar) following the same template, it inherits the same risk. Consider a small refactor of the CLI shutdown idiom (let process exit naturally after `pool.end()`) as part of 12e.3, or split that out as a dedicated fix per #47.
- **#48 (registry corrections — CNBC mislabel + 35-vs-32 source count + semianalysis seed URL):** Not directly relevant. The heuristic filter operates per-candidate; source-row corrections don't change filter behavior. **One indirect note:** if 12e.3's noise patterns include "earnings roundup" detection, CNBC's actual feed (which is the Earnings section despite the slug saying "markets") will hit higher rejection rates than the slug suggests. Worth noting in the noise-pattern test fixture choice.
- **#49 (dev-DB setup):** 12e.3 stage 3 (merge / smoke) will need a local Postgres again. Same constraint as 12e.2 smoke. Plan to use the same ephemeral Docker container approach unless #49 ships first.
- **10 broken HEAD-sweep feeds (inherited from 12e.2 Part E):** `meta-ai-blog`, `huggingface-papers`, `the-batch`, `amd-newsroom`, `tsmc-newsroom`, `asml-news`, `intel-newsroom`, `reuters-business`, `money-stuff`, `bis-press`. None are needed for 12e.3 — heuristic filter targets the three working feeds (cnbc-markets, import-ai, semianalysis). 12e.3 must NOT depend on any broken-feed source for tests or smoke.

## Verdict

**Ready for planner review.** Decision points enumerated; no contradictions blocking — only one real spec/schema mismatch (§F1) which the planner can resolve cleanly with either of the listed options.

**Decision-point count: 10.** All have a default lean grounded in either prior audit, schema, or roadmap text. None require external research before stage 2 can be planned.

The heuristic-filter feature shape itself is well-scoped by 12e.1's seam design (`runHeuristic` already typed, `enrichmentJob` already orchestrating, separate enrichment queue already ready). Stage 2 implementation should be primarily about (1) filling in the heuristic logic + body extraction inside the seam, (2) adding a body column to `ingestion_candidates` via 0017, and (3) deciding the bridge from poll to enrichment queue (§F4). All three look ~1 session of focused work, matching the roadmap's session-cost estimate.

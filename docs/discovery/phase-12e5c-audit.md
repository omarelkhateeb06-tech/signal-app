# Phase 12e.5c — Stage 1 discovery audit

**Date:** 2026-05-01
**HEAD at start:** `d05dea0 chore(housekeeping): OneDrive cleanup — sibling dirs, stale branches, project-state dirs, CLAUDE.md note (#61)` on `discovery/phase-12e5c` (worktree spawned canonical-rooted at `C:/dev/signal-app/.claude/worktrees/phase-12e5c-discovery`)
**Scope:** read-only audit of the four-seam pipeline state, queue config, retry patterns, event-row write semantics, and Sentry precedents — to inform Stage 2's wire-up of the chain into `enrichmentWorker.handle()` plus dead-letter handling and Sentry tagging. No clustering work (12e.6 owns that).

---

## 1. Current `enrichmentWorker.handle()` state

The worker shell is **62 lines, 5 lines of business logic**. The actual chain orchestration lives in `enrichmentJob.ts:processEnrichmentJob()` (289 lines). The worker is a thin BullMQ-callable wrapper around the job body.

### `enrichmentWorker.ts:handle()` (verbatim)

```ts
async function handle(job: Job<EnrichmentJobInput>): Promise<void> {
  // 12e.5c: wire seams here (runHeuristic, runRelevanceGate, etc.).
  // Until then, this worker returns terminalStatus: "failed" for any
  // drained job because seams are not injected. The CLI
  // (runIngestionEnrich.ts) is the documented dev surface for 12e.3
  // and 12e.4 — it injects the heuristic + relevance seams directly.
  // No DB corruption: the orchestration body's missing-seam guard
  // returns the structured result without writing to the DB.
  const result = await processEnrichmentJob(job.data);
  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] [ingestion-enrich:done] candidate=${result.candidateId} terminal=${result.terminalStatus} event=${result.resolvedEventId ?? "none"} failure=${result.failureReason ?? "none"}`,
  );
}
```

### Four-seam wire-up status (in `processEnrichmentJob`)

| seam | wired? | terminal status when missing | line range in `enrichmentJob.ts` |
|---|---|---|---|
| `runHeuristic` | ✓ wired | hard-fails with `"runHeuristic seam not provided"` (L105–112) | 105–154 |
| `runRelevanceGate` | ✓ wired | early-returns `terminalStatus: "heuristic_passed"` if missing (L160–167) | 156–218 |
| `extractFacts` | ✓ wired | early-returns `terminalStatus: "llm_relevant"` if missing (L224–231) | 220–281 |
| `generateTier` | **✗ missing** — no call site at all | n/a | n/a (function ends at L289) |
| `resolveCluster` | **✗ missing** — no call site, no event-write | n/a | n/a (12e.6a target) |

### Chain shape today

The worker drains a job, calls `processEnrichmentJob`, and the orchestration walks the three wired stages, terminating at `facts_extracted`. **No tier-generation call. No event-row write.** The `EnrichmentJobResult.terminalStatus` union (L44–52 of enrichmentJob.ts) does not include `"tier_generated"` — it stops at `"facts_extracted"`. The TypeScript type would need extending in Stage 2 to add `"tier_generated"`.

The worker has zero seam injection — `processEnrichmentJob(job.data)` is called with no `deps` argument, so all seams default to `{}`. Per the missing-seam guards, the worker hits the `runHeuristic` guard immediately and returns `terminalStatus: "failed", failureReason: "runHeuristic seam not provided"`. **Every drained BullMQ job currently fails at L105–112 of enrichmentJob.ts.** The CLI (`scripts/runIngestionEnrich.ts`) is the documented dev surface and injects the seams directly — that's the only path that exercises the chain end-to-end today.

---

## 2. BullMQ queue config inventory

### `signal-ingestion-enrich` (verbatim from `enrichmentQueue.ts:19–27`)

```ts
defaultJobOptions: {
  attempts: 2,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 604_800 },
}
```

### Comparison with sibling queues

| queue | attempts | backoff delay | removeOnComplete count | removeOnFail age |
|---|---|---|---|---|
| `signal-emails` | 3 | 30s exp | 1000 | 7d |
| `signal-aggregation` | 3 | 30s exp | 100 | 7d |
| `signal-ingestion-enrich` | **2** | **60s exp** | 1000 | 7d |

**Divergence is intentional.** `enrichmentWorker.ts:42–43` says the lower retry count + longer backoff is for "Haiku rate limits + spend governance per CLAUDE.md / roadmap §5.4 cost notes." The deliberate ~½× retry budget vs the other queues prevents a flaky stage from re-firing 5 LLM calls per attempt × 3 attempts = 15 LLM calls per failed job.

### DLQ pattern

**No separate DLQ.** Both `signal-emails` and `signal-aggregation` rely on BullMQ's failed-state as the implicit DLQ — `removeOnFail: { age: 604_800 }` keeps failed jobs queryable for 7 days. `signal-ingestion-enrich` follows the same pattern. There is no failed-jobs queue defined anywhere in `backend/src/jobs/`. Stage 2 should not invent one — the BullMQ-failed-state-as-DLQ pattern is the established convention.

The worker's `cachedWorker.on("failed", ...)` handler (enrichmentWorker.ts:46–51) only logs to console. It does NOT write to a DLQ table, does NOT emit a Sentry event, does NOT enqueue a retry. The "dead-letter handling" the brief asks for in Stage 2 is genuinely greenfield — there is no existing pattern to extend, only console-log on `failed`.

---

## 3. Per-seam retry pattern inventory

All four seams follow the **same shape**: at-most-2-attempts, no exponential backoff, fail-fast to a typed `*_REASONS` rejection class. Idempotency lives at the row-selection layer (CLI WHERE clause), not in the seam itself.

| seam | attempts | retry trigger | terminal-on-failure? | idempotency layer |
|---|---|---|---|---|
| `runHeuristicSeam` (heuristicSeam.ts:94–143) | 1 | n/a (deterministic, no LLM) | yes — returns `{pass: false, reason}` | none in seam; CLI filters `status='discovered'` |
| `runRelevanceGate` (relevanceSeam.ts) | 2 | parse failure / missing sector → stricter prefill | yes — terminal `RELEVANCE_*` reason | none in seam; CLI filters `status='heuristic_passed' AND llm_judgment_raw IS NULL` |
| `runFactsSeam` (factsSeam.ts:218–341) | 2 | JSON parse / Zod fail → stricter prefill `{"facts":` | yes — terminal `FACTS_PARSE_ERROR` | none in seam; CLI filters `status='llm_relevant' AND facts_extracted_at IS NULL` |
| `runTierGenerationSeam` (tierGenerationSeam.ts) | 2 | JSON parse / Zod fail → stricter prefill `{"thesis":` | yes — terminal `TIER_PARSE_ERROR` | none in seam; orchestrator (`tierOrchestration.ts:181–198`) checks `tier_outputs->>tier IS NOT NULL` per tier |

**Key observation: NO seam cascades.** Every seam fail-fasts at terminal rejection class. No exponential backoff inside a seam. No re-enqueue from a seam. The only retry in the entire ingestion pipeline is the BullMQ queue-level `attempts: 2`, which would re-run the **whole `processEnrichmentJob`** body — re-firing every wired seam upstream of the failure. Since 12e.5a/12e.5b seams write to DB before returning success, queue-level re-runs of an already-extracted candidate would be double-charged unless idempotency markers gate them.

Specifically: the row-selection idempotency markers protect the **CLI** path (which reads the cohort first), but the **worker** path receives a `candidateId` directly from the job payload. **A queue-level retry on a job whose facts already extracted would re-fire `extractFacts` and double-charge a Haiku call** — unless `processEnrichmentJob` adds short-circuit checks based on candidate state. This is a Stage 2 design concern surfaced for the planner.

Idempotency mechanisms by stage:
- **Heuristic** — `status` is checked nowhere; orchestration would re-run on retry. Cost: free (no LLM).
- **Relevance** — `llm_judgment_raw IS NULL` is the CLI filter; orchestration's `processEnrichmentJob` does NOT re-check before calling. Cost on retry: 1 Haiku call.
- **Facts** — `facts_extracted_at IS NULL` is the CLI filter; same gap as relevance. Cost on retry: 1–2 Haiku calls.
- **Tier** — `tier_outputs->>tier IS NOT NULL` is per-tier gated INSIDE `tierOrchestration.ts:181–198` (Strategy B). Cost on retry: only missing tiers; per-tier idempotency already correct.

Tier orchestration's per-tier idempotency is the only stage where retry-cost is bounded by missing work. Stages 1–3 would re-fire on full-job retry.

---

## 4. Tier-call sequencing (informs decision 1: sequential vs parallel)

### Verbatim from `tierOrchestration.ts:181–198`

```ts
for (const tier of TIER_ORDER) {
  if (existingTiers.has(tier)) {
    summary.skippedTiers.push(tier);
    continue;
  }
  const result = await runTier(candidateId, tier);
  summary.ranTiers.push(tier);
  if (result.ok) {
    await persistTierSuccess(db, candidateId, tier, result);
    existingTiers.add(tier);
  } else {
    await persistTierFailureRaw(db, candidateId, tier, result);
    summary.failedTier = { tier, reason: result.rejectionReason };
    // Stop on first failure — partial-state retry picks up missing
    // tiers on next invocation.
    break;
  }
}
```

`TIER_ORDER` (line 31): `["accessible", "briefed", "technical"]`.

### Classification

**Sequential**, **stop-on-first-failure**, with per-tier persistence between calls. Already pattern-applied from the 12e.5b audit's recommendation (audit §8 — "Default sequential unless the soak shows wall-clock latency is a real problem"). The 12e.5b smoke (`docs/discovery/phase-12e5b-smoke.md` §3) showed per-trio wall-clock latency of ~12.5s p50 (3.3 + 4.0 + 5.0s p50 per tier), which is acceptable.

### Other multi-Haiku-call patterns in the codebase

`grep -n "getOrGenerateCommentary"` in `services/commentaryService.ts:151` is single-call (one Haiku call per request, with cache-first lookup). It's NOT a multi-call orchestration — it's a fan-out-of-one. So `tierOrchestration.ts` is the **only** existing multi-call orchestration precedent.

The historical 12a `regenerateDepthVariants.ts` script is also single-call-per-row. No `Promise.all` over multiple Haiku calls anywhere.

### Recommendation surfaced (planner decides)

Stay sequential for 12e.5c wire-up. Parallel via `Promise.all` is a 12e.8 (post-soak) optimization at most. Three reasons:
- Wall-clock savings from parallel are ~7s per candidate at observed latencies — meaningful, but at modest cohort sizes (9 candidates per smoke run) this is ~60s total savings, not load-bearing.
- Sequential-with-stop-on-failure preserves the cost discipline: if `accessible` (cheapest tier) fails on a systemic prompt bug, the trio aborts after 1 call, not 3.
- Debugging is simpler; one tier's failure can't race another's success in logs.

---

## 5. Event-row write semantics (informs decision 3: partial-failure write semantics)

### Current state of `writeEvent`

**Does not exist.** Grep for `INSERT INTO events`, `.insert(events)`, `writeEvent`, `createEvent` returns ZERO matches across `backend/src/`. There is no event-row write code path anywhere — not in `enrichmentJob.ts`, not in the seams, not in any service. The seed script (`db/seed.ts`) and `seedStories.ts` write to `stories`, not `events`. **12e.5c builds the writer from scratch.**

### `events` table NOT NULL constraints (from `db/schema.ts:579–601`)

| column | type | nullable? | default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `defaultRandom()` |
| `sector` | varchar(50) | **NOT NULL** | none |
| `headline` | varchar(255) | **NOT NULL** | none |
| `context` | text | **NOT NULL** | none |
| `why_it_matters` | text | **NOT NULL** | none |
| `why_it_matters_template` | text | nullable | none |
| `primary_source_url` | text | **NOT NULL** | none |
| `primary_source_name` | varchar(255) | nullable | none |
| `author_id` | uuid (FK to writers) | nullable | none |
| `facts` | jsonb | **NOT NULL** | `'{}'::jsonb` |
| `embedding` | bytea | nullable | none |
| `published_at` | timestamptz | nullable | none |
| `created_at` | timestamptz | NOT NULL | `defaultNow()` |
| `updated_at` | timestamptz | NOT NULL | `defaultNow()` |

**Critical finding for Stage 2:** **`why_it_matters` is NOT NULL** on events. It's the role-neutral fallback string that the lenient parser returns to clients when `why_it_matters_template` is null. 12e.5c's writer needs SOMETHING for that field — current candidate state (post-12e.5b) does not have a `why_it_matters` field anywhere. Options to surface to planner:

1. **Use one tier's thesis as the fallback** (probably `briefed.thesis` — it's the middle-register thesis most readable to a generic audience).
2. **Generate a separate role-neutral thesis** — additional Haiku call per event.
3. **Use the candidate's headline + first fact** — synthesize a 1–2 sentence string mechanically.
4. **Make `why_it_matters` nullable with a `0021` migration** — semantic change to the schema; would require updating every reader that assumes non-null.

This is a **load-bearing decision the brief did not flag** — adding to §10.

`headline`, `context`, `primary_source_url` are also NOT NULL. These map to candidate fields:
- `headline` ← `ingestion_candidates.raw_title`
- `context` ← need to choose: full body, summary, or new field
- `primary_source_url` ← `ingestion_candidates.url`

`context` (NOT NULL) is the second under-spec'd field. The candidate's `body_text` is the obvious source but it can be 200KB; events table `context` is `text` with no length cap declared. Probably want a truncated/summary version. Another planner decision.

### Inventory of every `why_it_matters_template` reader

| file:line | usage | classification |
|---|---|---|
| `backend/src/controllers/storyController.ts:44, 70, 114` | reads as `string \| null` directly into response JSON | **lenient** (passes null through) |
| `backend/src/controllers/v2/storiesController.ts:121–153` | calls `parseWhyItMattersTemplate(r.whyItMattersTemplate)` | **lenient** (returns `null` on parse failure) |
| `backend/src/services/personalizationService.ts:17, 28` | reads as `string \| null`, falls back to `whyItMatters` if template is null | **lenient with explicit fallback** |
| `backend/src/scripts/regenerateDepthVariants.ts:125` | writes `whyItMattersTemplate: JSON.stringify(template)` after `assertWhyItMattersTemplate()` | **strict at write boundary** (asserts before stringifying) |
| `backend/src/scripts/seedStories.ts:73, 270, 271` | writes via `WhyItMattersTemplateSchema` parse + JSON.stringify | **strict at write boundary** |
| `backend/src/utils/depthVariants.ts` | exports both `parseWhyItMattersTemplate` (lenient) and `assertWhyItMattersTemplate` (strict) | source of truth |
| `backend/src/db/seed.ts:603` | sets `whyItMattersTemplate: null` on a seed row | confirms NULL is a valid persisted value |

**No code path asserts `tier_outputs IS NOT NULL` before reading an event.** All readers tolerate null `whyItMattersTemplate`. **Writing events with `whyItMattersTemplate = null` is permanently supported per CLAUDE.md §8** ("the permanent contract, not a migration-window hack — some rows may never get a template").

### Implication for partial-failure write decision

- **Writing the event row with `whyItMattersTemplate = null` if all 3 tiers fail** → safe per the lenient contract. The `why_it_matters` (NOT NULL) string stays as the fallback. Reader paths handle this gracefully.
- **Blocking the write until all 3 tiers complete** → also safe but more conservative. Would require persisting `tier_generated` status before writing event, OR keeping the candidate row at `facts_extracted` with `tier_outputs` partial.

The schema permits both. Recommendation surfaced (planner decides): **block the event-write until trio completes**, because:
1. Once an event row exists, downstream readers consume it. Writing an event with NULL template means the user immediately sees the role-neutral fallback — possibly forever if tier retries never complete.
2. The candidate-side staging already supports partial state (per 12e.5b's Strategy B). Keep the partial state on `ingestion_candidates`, not on `events`.
3. The status enum already supports the gating: status advances `facts_extracted → tier_generated → published`, so the event-write naturally sits at the `tier_generated → published` transition.

---

## 6. Sentry wiring precedents

### Top 5 (only 5) Sentry call sites in the codebase

```
backend/src/lib/sentry.ts:11       → Sentry.init(...)
backend/src/lib/sentry.ts:37       → Sentry.setupExpressErrorHandler(app)
backend/src/lib/envCheck.ts:77     → Sentry.captureMessage(...)
backend/src/middleware/apiKeyRateLimit.ts:97 → Sentry.captureMessage("Rate limiter fail-open: Redis unavailable", {...})
```

**That's it. Five total references, three of which are import/init.** The codebase has essentially zero per-request or per-job Sentry instrumentation. There is no `Sentry.setTag`, no `Sentry.withScope`, no `Sentry.captureException`, no `Sentry.startSpan`. The 12c personalization pipeline does not use Sentry tags. The aggregation worker does not use Sentry tags. The email worker does not use Sentry tags.

### Pattern grouping

| pattern | sites | example |
|---|---|---|
| init-and-forget | `lib/sentry.ts:11` | Boots Sentry once at server start. |
| Express handler delegation | `lib/sentry.ts:37` | Lets Sentry catch unhandled Express errors. |
| capture-and-continue (no tag) | `lib/envCheck.ts:77`, `middleware/apiKeyRateLimit.ts:97` | Single `captureMessage` call with no scoped tags or breadcrumbs. |

**No `withScope` or `setTag` precedent exists.** The "Sentry tags through" goal of 12e.5c is genuinely greenfield — Stage 2 has to invent the per-stage tagging convention from scratch.

### `lib/sentry.ts` init config (verbatim)

```ts
Sentry.init({
  dsn,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  beforeSend(event) {
    if (event.request?.headers) {
      const h = event.request.headers as Record<string, unknown>;
      delete h.authorization;
      delete h.cookie;
      delete h["x-api-key"];
    }
    return event;
  },
});
```

`tracesSampleRate: 0.1` is set. `beforeSend` strips auth headers. The `isSentryEnabled()` guard returns true only if `SENTRY_DSN` is set — same fail-open pattern as Redis. This is good — Stage 2 can safely call `Sentry.setTag` etc. without a guard, since calls are no-ops if `init` never ran.

### Recommended pattern for 12e.5c per-stage tagging (planner confirms)

`Sentry.withScope(scope => { scope.setTag("ingestion.stage", "facts"); scope.setTag("ingestion.candidate_id", candidateId); ... })` around each stage's call site, with `Sentry.captureException(err)` on terminal-rejection rather than success. This composes with the existing `init-and-forget + capture-and-continue` pattern. Alternative: BullMQ middleware or a Sentry `scope` wrapping the whole `processEnrichmentJob` invocation. The latter requires more thought about scope-leakage between concurrent jobs (concurrency=2 means two scopes can be active at once).

---

## 7. FUTURE / TODO / 12e.5c comments

Verbatim list of every match for `12e\.5c|TODO.*12e|FUTURE` under `backend/src/jobs/ingestion/`:

| file:line | comment |
|---|---|
| `enrichmentJob.ts:9` | `← 12e.5b ADDS the seam definitions; 12e.5c owns wiring into` |
| `enrichmentJob.ts:12` | `event (12e.6b)` |
| `enrichmentJob.ts:17` | `wire them into the orchestration body — that lands in 12e.5c, which` |
| `enrichmentJob.ts:58` | `extractFacts; 12e.5b fills generateTier; 12e.6a fills resolveCluster.` |
| `enrichmentJob.ts:83` | `` `enrichmentWorker.handle()` is 12e.5c's responsibility. `` |
| `enrichmentWorker.ts:14` | `// 12e.5c: wire seams here (runHeuristic, runRelevanceGate, etc.).` |
| `factsSeam.ts:156` | `upgrade to FACTS_RATE_LIMITED so soak observability + 12e.5c` |
| `relevanceSeam.ts:135` | `upgrade to LLM_RATE_LIMITED so soak observability + 12e.5c` |
| `sourcePollJob.ts:159` | `scanner / 12e.5c orchestration sweeps any missed candidates.` |
| `sourcePollQueue.ts:6` | `12e.5c wires it to actual per-source cadences (RSS hourly, EDGAR` |
| `sourcePollQueue.ts:9` | `` `ingestion_sources.fetch_interval_seconds` are introduced in 12e.5c. `` |
| `tierGenerationSeam.ts:6` | `orchestration body (CLI in 12e.5b, worker in 12e.5c) owns the DB` |
| `tierGenerationSeam.ts:186` | `upgrade to TIER_RATE_LIMITED so soak observability + 12e.5c` |
| `tierOrchestration.ts:17` | `are unchanged from the CLI's prior in-line implementation. 12e.5c` |

Plus migration comments:
- `0019_phase12e5a_fact_extraction.sql:11` — `12e.5c orchestration copies this blob to events.facts at`
- `0020_phase12e5b_tier_outputs.sql:6` — `and are awaiting event-write (12e.5c). Symmetric with 12e.4`
- `0020_phase12e5b_tier_outputs.sql:15` — `12e.5c copies this blob to events.why_it_matters_template at`

### Cross-cutting deferred work surfaced

The `sourcePollQueue.ts:6,9` markers reveal **a second 12e.5c scope expansion** the brief did not mention: **per-source cadence configuration**. The poll queue currently doesn't read `ingestion_sources.fetch_interval_seconds`. That comment says 12e.5c should wire it. Two interpretations:
- (a) Original 12e plan included per-source cadences inside 12e.5c's scope.
- (b) The planner has since narrowed 12e.5c to just chain orchestration + dead-letter + Sentry, and the poll-cadence work is deferred elsewhere.

The brief's stated scope is (b) — chain orchestration only. So poll-cadence appears to be out of scope but **flagged for planner**: the in-tree comments expect 12e.5c to land it. Stage 2 should either pick it up or explicitly defer to 12e.6+ with a comment-update.

---

## 8. CLAUDE.md operational contract excerpts

### §7 JOBS & SCHEDULERS — verbatim

> Two BullMQ queues, both backed by the shared Redis connection:
>
> | queue                | producer                          | worker                  | cadence                  |
> |----------------------|-----------------------------------|-------------------------|--------------------------|
> | `signal-email`       | `emailQueue.enqueue()`            | `emailWorker`           | on-demand + weekly trigger |
> | `signal-aggregation` | `scheduleAggregationRepeatable()` | `aggregationWorker`     | `0 2 * * *` UTC, configurable via `AGGREGATION_CRON` |
>
> Plus one **in-process** scheduler:
>
> - `emailScheduler` — node-cron, default `0 8 * * 1` (Monday 08:00 UTC), overridable via `WEEKLY_DIGEST_CRON`; disable with `DISABLE_EMAIL_SCHEDULER=1` for local dev.

**Stale.** §7 lists 2 queues; the codebase has **4** (`signal-email`, `signal-aggregation`, `signal-ingestion-poll`, `signal-ingestion-enrich`). The 2 ingestion queues from 12e.1 have not been added to §7. Out of scope for 12e.5c stage 2 to fix this, but flag it.

### §8 — relevant constraints

- **Lenient-on-read confirmed:** `parseWhyItMattersTemplate(raw)` returns `null` on null/empty/invalid (utils/depthVariants.ts).
- **Two Haiku models, two pins:** depth-variant offline regeneration uses `claude-haiku-4-5` alias (`DEPTH_VARIANT_MODEL`); per-user request-path uses dated string `claude-haiku-4-5-20251001` (`COMMENTARY_MODEL`).
- **Client contract for null template:** "When the template is `null`, the client falls back to `why_it_matters`. This is the permanent contract, not a migration-window hack — some rows may never get a template."

The 12e.5c writer for events should follow the same pattern as the existing `stories` schema: `whyItMatters` NOT NULL (the role-neutral fallback), `whyItMattersTemplate` nullable (the depth-aware structured payload). Per-fact field discipline (Zod-validated, `assertWhyItMattersTemplate` at write boundary) should mirror what `regenerateDepthVariants.ts` does.

### §15 phase status — relevant

12e.5c position in the roadmap is mid-12e (post-12e.5b, pre-12e.6 clustering). No clustering work in scope.

---

## 9. Proposed sub-step sequencing (NOT a Stage 2 plan — just an order)

Given the inventory, minimum-coupling order to ship 12e.5c chain orchestration:

| step | scope | validation gate |
|---|---|---|
| **9.1** | Wire `extractFacts` short-circuit (skip if `facts_extracted_at IS NOT NULL`) inside `processEnrichmentJob`. Same for `runRelevanceGate` (skip if `llm_judgment_raw IS NOT NULL` AND status is past `heuristic_passed`). Closes the queue-retry double-charge gap surfaced in §3. | unit test: re-run on already-extracted candidate produces 0 LLM calls |
| **9.2** | Wire `processTierGeneration` from `tierOrchestration.ts` into `processEnrichmentJob` after the facts stage. Extend `EnrichmentJobResult.terminalStatus` union to include `"tier_generated"`. | unit test mirroring `tierOrchestration.test.ts` patterns; CLI smoke against 1 candidate |
| **9.3** | Resolve the `why_it_matters` fallback decision (planner). Build `writeEvent` (insert into `events` + `event_sources`). Wire as the post-trio terminal step. Status advances `tier_generated → published`. | unit test: writeEvent with mock DB; integration test: full chain on 1 candidate produces 1 event row + 1 event_source row |
| **9.4** | Wire seams into `enrichmentWorker.handle()` — this is the brief's central deliverable. The worker now drains real BullMQ jobs through the full chain. | manual: enqueue 1 job, observe terminal status `published` |
| **9.5** | Sentry per-stage tagging (`withScope` + `setTag` per stage). Capture exceptions on terminal-rejection, not on success. | manual: trigger a forced rejection, verify Sentry event arrives with stage tag |
| **9.6** | Dead-letter wiring on the `failed` BullMQ event. Decision per planner: write to a `dead_letter` Postgres table, or rely on BullMQ failed-state for 7 days, or both. The brief said "dead-letter handling" — current state is just `console.error`. | manual: force a job to fail twice (exhaust attempts), verify it lands in BullMQ failed state + Sentry capture |
| **9.7** | Live smoke against ephemeral local stack (12e.5b smoke pattern). N=5 candidates end-to-end. Emit smoke report. | smoke doc with per-candidate event-row contents |

**Estimated session count: 5–6.** 9.1–9.4 are the chain wire-up — likely 2–3 sessions. 9.5–9.6 are observability — 1–2 sessions. 9.7 is the smoke — 1 session. The original 12e plan said 5–8 sessions for 12e.5c; this estimate fits the lower bound.

The `sourcePollQueue` cadence work (per-source `fetch_interval_seconds`) is left out of this sequencing per brief scope — flagged for planner clarification.

---

## 10. Open questions / flags for planner

### Critical / load-bearing

- **`why_it_matters` is NOT NULL on `events` — Stage 2 cannot write an event without filling it.** The brief did not flag this. Four candidate strategies surfaced in §5: (a) use `briefed.thesis` as fallback, (b) extra Haiku call for role-neutral thesis, (c) synthesize from headline+facts, (d) make column nullable in 0021. **Resolve before Stage 2 starts.** Strongest recommendation: (a) use `briefed.thesis` as the role-neutral fallback — zero extra cost, semantically appropriate, the `briefed` register is closest to "general professional" framing.
- **Queue-level retry on `signal-ingestion-enrich` would re-fire upstream stages and double-charge Haiku calls.** Per §3, `processEnrichmentJob` does NOT short-circuit on already-extracted state; it calls `runRelevanceGate` and `extractFacts` unconditionally if the seams are wired. With `attempts: 2`, a tier-stage failure triggers a full re-run that re-pays for relevance + facts. Step 9.1 in the proposed sequencing closes this gap, but it's a real bug today (latent — only fires when worker is wired). **Surface explicitly to planner so it gets the priority it deserves.**
- **`context` field on `events` is NOT NULL with no obvious source.** Candidate has `body_text` (potentially 200KB) and `raw_summary`. Stage 2 needs a planner decision on what to write here — likely `raw_summary` if non-empty, else first 500 chars of `body_text`. Surface for explicit decision.

### Brief framing inaccuracies

- **The brief named `factsExtractionSeam.ts` — actual file is `factsSeam.ts`.** Same trap as the 12e.5a brief naming `cli/runIngestionEnrich.ts` instead of `scripts/runIngestionEnrich.ts`. Verified the actual filename via `ls`.
- **§7 of CLAUDE.md is stale w.r.t. ingestion queues** (lists 2 queues; codebase has 4). Out of scope for 12e.5c stage 2 to fix, but worth flagging for a separate housekeeping pass.

### Surprises / non-obvious findings

- **Sentry instrumentation is essentially zero today.** 5 total call sites in the codebase, none in any worker or service that 12e.5c will touch. The "Sentry tags through" goal is greenfield. Stage 2 invents the per-stage tagging convention. The 12c personalization pipeline has no Sentry tagging precedent to copy.
- **No `writeEvent` exists.** Stage 2 builds the events writer from scratch. It needs to also write to `event_sources` (per the schema's `INSERT INTO event_sources` requirement that exactly one `role='primary'` row exists per event; partial unique index from migration 0015 enforces this).
- **The current worker is a 100% no-op for production traffic.** Every BullMQ-drained job hits the missing-seam guard at `enrichmentJob.ts:105–112` and returns `terminalStatus: "failed"`. The CLI is the only path that exercises the chain. Stage 2's wire-up is the first time the worker actually does work.
- **The `sourcePollQueue.ts:6,9` markers say 12e.5c should wire per-source cadences** (`ingestion_sources.fetch_interval_seconds`). The brief's scope statement does NOT include cadence work. **Planner clarification needed:** is the cadence work (a) part of 12e.5c (brief omitted it), (b) deferred to 12e.6+ (comment-updates needed in source files), or (c) deferred but with a follow-up issue?
- **Retry strategy is uniformly fail-fast across all four seams** (§3). 12e.5c does not need to invent a per-stage retry policy — it can adopt the "BullMQ attempts:2 + per-seam fail-fast at terminal class" pattern that already exists, just with the upstream-re-fire gap closed (§9.1). Decision 2 from the brief's scoping turn (per-row failure ceiling / DLQ) collapses to: **inherit existing seam discipline; don't add cross-stage retry policy**.
- **`tierOrchestration.ts` is already perfectly shaped for plug-in to `processEnrichmentJob`** — accepts `candidateId` + `deps`, returns a structured `TierProcessSummary`, owns its own DB writes. Step 9.2 is mostly a 5-line call-site addition.

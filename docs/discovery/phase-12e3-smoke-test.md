# Phase 12e.3 — End-to-end smoke test findings

**Date:** 2026-04-27
**HEAD at start:** `84bafbb feat(ingestion): phase 12e.3 — heuristic filter + body fetch + enrichment dispatch` on `feat/phase12e3-stage2-impl`
**Sources tested:** `cnbc-markets`, `import-ai`, `semianalysis`

## Pre-flight

- **CWD:** `C:\dev\signal-app` ✓
- **Branch:** `feat/phase12e3-stage2-impl`, clean tree ✓
- **HEAD:** `84bafbb` ✓
- **Branch vs origin/main:** 0 behind, 3 ahead — no rebase surprises before merge.
- **Docker Desktop:** running. `docker.exe` invoked by full path; `PATH=...` prefix on the `docker run` command for the credential-helper resolution (subprocess-local; no persistent change).
- **Leftover containers:** none with `signal-smoke-*` name.

## Local DB setup — ad-hoc

Same constraint as the 12e.2 smoke (#49 still open). For this run, two ephemeral containers:

```powershell
& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" run -d --rm `
  --name signal-smoke-12e3-pg `
  -e POSTGRES_USER=user `
  -e POSTGRES_PASSWORD=pass `
  -e POSTGRES_DB=signal `
  -p 127.0.0.1:5432:5432 `
  postgres:16-alpine

& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" run -d --rm `
  --name signal-smoke-12e3-redis `
  -p 127.0.0.1:6379:6379 `
  redis:7-alpine
```

Both ready in 1s after `docker run` (polled `pg_isready` and `redis-cli ping`). Redis is required this round because 12e.3 introduces the poll → BullMQ enrichment-queue bridge, and the smoke verifies the bridge fires by inspecting Redis state directly.

`backend/.env` created for the smoke duration with `DATABASE_URL` + `REDIS_URL` and minimal companion env vars (matching `.env.example`); deleted at cleanup. `.env` is gitignored — verified `git status` shows no `.env` entry.

## Environment

- **Migration 0017 applied:** ✓ — `[migrate] ✓ 0017_phase12e3_body_text_and_heuristic_passed.sql (6ms)`. All 19 migrations applied cleanly in 752ms. No skips, no hash mismatches.
- **`body_text` column present:** ✓ — `body_text | text | nullable | (no default)`.
- **`heuristic_passed` enum value present:** ✓ — `enum_range`: `{discovered, heuristic_filtered, llm_rejected, enriching, published, duplicate, failed, heuristic_passed}`. Note: `ALTER TYPE ADD VALUE` appends to the end; "heuristic_passed" is positioned last in the enum's runtime order, even though `schema.ts` declares it second. Cosmetic; doesn't affect behavior.
- **Registry seeded for three targets:** ✓ — `cnbc-markets`, `import-ai`, `semianalysis` all `adapter_type='rss'` and `enabled=true`.

## 2a. Poll-and-bridge results

### cnbc-markets
- **Poll:** success — discovered 30, persisted 30, `failureReason=null`.
- **Rows persisted:** 30.
- **Enqueue bridge:** ✓ — Redis `bull:signal-ingestion-enrich:wait` LLEN went from 0 → 30 after the poll. Job IDs `1` through `30` present under `bull:signal-ingestion-enrich:N` keys.
- **Verification method:** BullMQ inspection (`redis-cli LLEN` + `KEYS bull:signal-ingestion-enrich:*` + `LRANGE`).

### import-ai
- **Poll:** success — discovered 20, persisted 20, `failureReason=null`.
- **Rows persisted:** 20.
- **Enqueue bridge:** ✓ — wait queue grew to 50 (cumulative).
- **Verification method:** same.

### semianalysis
- **Poll:** success — discovered 20, persisted 20, `failureReason=null`. (Substack→`newsletter.semianalysis.com` redirect followed transparently as in 12e.2.)
- **Rows persisted:** 20.
- **Enqueue bridge:** ✓ — wait queue grew to 70 (cumulative).
- **Verification method:** same.

**Bridge net result:** 70 candidates persisted to DB → 70 jobs in `bull:signal-ingestion-enrich:wait`. Exact 1:1 mapping. Bridge fully verified.

## 2b. Heuristic + body extraction results

### Status breakdown (post-enrich CLI for all three sources)

```
     slug     |       status       |  status_reason  | count
--------------+--------------------+-----------------+-------
 cnbc-markets | heuristic_filtered | recency_too_old |    28
 cnbc-markets | heuristic_passed   |                 |     2
 import-ai    | heuristic_filtered | recency_too_old |    20
 semianalysis | heuristic_filtered | recency_too_old |    20
```

**Distinct `status_reason` values across all rejected rows:** `recency_too_old` only. Within the locked vocabulary; no out-of-vocabulary writes.

### Why so much recency rejection?

The recency cutoff is 36 hours. The smoke ran on 2026-04-27 evening; CNBC's feed had 2 items inside that window (and 28 older), `import-ai` and `semianalysis` are weekly-or-slower publications whose items in the snapshot were all >36h old. The heuristic correctly rejected them. **This is the recency-rejection path doing its job, not a bug.** Note that the body-fetch + readability path is exercised by the 2 cnbc passes; see spot-check below.

### cnbc-markets

**Status breakdown:**
- `heuristic_passed`: 2
- `heuristic_filtered (recency_too_old)`: 28

**Spot-check — passed rows:**
| id | status | status_reason | body_text length | processed | sample |
|---|---|---|---|---|---|
| `e1836efc-…` | `heuristic_passed` | (null) | 4144 | yes | "Procter & Gamble on Friday reported quarterly earnings and revenue that topped analysts' expectatio…" |
| `f7bc1181-…` | `heuristic_passed` | (null) | 2626 | yes | "A pedestrian walks by a Domino's in San Francisco, Dec. 9, 2025. Justin Sullivan \| Getty ImagesDom…" |

Both passes have non-null `body_text` well above the 500-char floor and below the 200 KB cap (so no `body_truncated` flag). Sample text reads as real article body extracted by readability — leading sentences are coherent prose, not boilerplate or navigation.

**Spot-check — filtered rows (3 most-recent rejections):**
| id | status_reason | body_text null? | processed | raw_published_at |
|---|---|---|---|---|
| `5b035fcb-…` | `recency_too_old` | yes | yes | 2026-04-24 17:29:50+00 |
| `b21d213f-…` | `recency_too_old` | yes | yes | 2026-04-24 08:08:11+00 |
| `13984b83-…` | `recency_too_old` | yes | yes | 2026-04-23 22:34:23+00 |

All filtered rows have `body_text=null` (rejected before fetch in pre-fetch reasons), `processed_at` set, `status_reason` in vocabulary. Timestamps are 2026-04-23/24, well outside the 36h window from smoke time.

**Out-of-vocabulary status_reason values:** none.
**Candidates still at status=discovered after enrich:** 0.

### import-ai

**Status breakdown:**
- `heuristic_filtered (recency_too_old)`: 20
- (no passes — feed is weekly cadence, all items in this snapshot >36h)

**Spot-check:** sampled 3 rejected rows; all had `body_text=null`, `processed_at` set, `status_reason='recency_too_old'`.

**Out-of-vocabulary status_reason values:** none.
**Candidates still at status=discovered after enrich:** 0.

### semianalysis

**Status breakdown:**
- `heuristic_filtered (recency_too_old)`: 20

Same pattern as `import-ai` — multi-day cadence publication, all items in the snapshot older than 36h.

**Out-of-vocabulary status_reason values:** none.
**Candidates still at status=discovered after enrich:** 0.

## 2c. Idempotency

**Re-run on import-ai** (all 20 candidates already at `heuristic_filtered`):

```
[run-ingestion-enrich] starting (candidate=<none>, source=import-ai)
[run-ingestion-enrich] processing 0 candidate(s)
[run-ingestion-enrich] summary: {}
```

Post-rerun count unchanged at 20 filtered. The CLI's resolveCandidateIds query filters on `status='discovered'`; all import-ai rows are at `heuristic_filtered`, so 0 are re-processed. **Idempotency PASS.**

## 2d. BullMQ worker pickup

**Skipped — but with a real anomaly to surface.**

Looking at `backend/src/jobs/ingestion/enrichmentWorker.ts:13–19`:

```ts
async function handle(job: Job<EnrichmentJobInput>): Promise<void> {
  const result = await processEnrichmentJob(job.data);
  // …log…
}
```

The worker calls `processEnrichmentJob(job.data)` **without injecting `EnrichmentJobDeps.seams.runHeuristic`**. The orchestration body's missing-seam guard returns:

```ts
{ terminalStatus: "failed", failureReason: "runHeuristic seam not provided" }
```

Verified by direct call: passing a real candidate ID into `processEnrichmentJob({ candidateId })` with no deps returns `{ terminalStatus: "failed", failureReason: "runHeuristic seam not provided" }` for one of the cnbc-passed rows.

**What this means in practice:**
- If the worker were started against the 70 jobs sitting in `bull:signal-ingestion-enrich:wait`, every job would log a "failed" terminal — 70 noisy log lines.
- **No DB corruption.** The missing-seam guard returns the structured result *without* writing to the DB. Candidates stay at whatever terminal state the CLI set; the worker drain is observationally noisy but state-preserving.
- The CLI is the documented dev surface for 12e.3 (per Stage 2 prompt, F4-locked + the `runIngestionEnrich.ts` script). The CLI explicitly injects `seams: { runHeuristic: (id) => runHeuristicSeam(id) }`.

**Why this is borderline-acceptable rather than a blocker:**
- Stage 2's prompt didn't list `enrichmentWorker.ts` in its "Files to create or modify" section. The bridge half (sourcePollJob enqueueing) was in scope; the worker-handle wiring was not.
- The roadmap's `12e.5c — Story write orchestration, dead-letter, Sentry tags` is the named session for end-to-end chain orchestration. Wiring the worker to inject seams plausibly belongs there.
- The smoke verifies the heuristic stage end-to-end via the CLI path correctly. The bridge enqueue path is verified. The only gap is the worker drain wiring — and that's the chain orchestration concern.

**Recommendation for follow-up (not blocking this merge):** in 12e.5c (or sooner if cron lands first), update `enrichmentWorker.handle()` to inject `runHeuristic: (id) => runHeuristicSeam(id)` (and the other seams as they ship). Mirror the CLI's pattern.

## Anomalies / surprises

1. **Worker-handle missing-seam gap (2d above).** The biggest surprise of this smoke. Surfaced as a deferred-to-12e.5c follow-up; would otherwise be a real production-deploy blocker (cron-triggered polling would enqueue jobs that the worker logs as failed). DB state is not affected.
2. **Recency-rejection dominates the breakdown.** All 70 candidates landed in just 2 distinct outcome buckets (`heuristic_passed: 2` and `heuristic_filtered: recency_too_old: 68`). The body-fetch + readability extraction path was exercised by only 2 candidates (the cnbc passes). Both worked correctly (4144 and 2626 chars extracted), but the smoke didn't exercise the noise-pattern, body-too-short, or body-truncated branches against real content. Coverage there falls back on unit tests + fixture-driven integration tests in `backend/tests/ingestion/`.
3. **`heuristic_passed` enum position.** `ALTER TYPE ADD VALUE IF NOT EXISTS 'heuristic_passed'` appends to the end of the enum, putting it after `failed` in `enum_range`. The schema.ts declaration places it second (between `discovered` and `heuristic_filtered`) for readability. Cosmetic divergence — runtime behavior matches in both, equality and casts work the same. Not a bug; flagging because the planner may notice it on schema inspection.
4. **CNBC channel-title mislabel still unaddressed.** Per the 12e.2 smoke and #48: the seeded URL is CNBC's "Earnings" feed despite the slug saying "markets". Not a 12e.3 concern — flagged here so it doesn't get lost.
5. **No `body_truncated` / `body_too_short` events observed in real-world smoke.** Both branches verified by unit tests but not exercised by the live feeds. Expected — articles in the smoke set are 2.6–4.1 KB, well within the 500–200,000 char band.

## Verdict

**Clean — proceed to merge.**

The 12e.3 implementation is verifiably correct end-to-end via the CLI path:
- Bridge from poll → enrichment queue fires correctly (70 candidates → 70 BullMQ jobs).
- Migration 0017 applies cleanly; `body_text` column and `heuristic_passed` enum value land as designed.
- Pre-fetch heuristic checks (recency in particular) advance candidates to `heuristic_filtered` with the correct vocabulary `status_reason`.
- Body fetch + readability extraction works against real CNBC article HTML (4 KB + 2.6 KB body_text persisted, both under cap).
- Idempotency holds (CLI filters on `status='discovered'`; re-run on a fully-processed source is a no-op).
- 0 candidates stuck at `discovered` after the CLI's pass.

The one anomaly worth surfacing — the worker-handle missing-seam gap — is a chain-orchestration concern that fits naturally in 12e.5c's scope per the roadmap. It does not corrupt DB state, and the CLI dev surface is the verified path for 12e.3.

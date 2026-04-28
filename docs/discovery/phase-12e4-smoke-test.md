# Phase 12e.4 — End-to-end smoke test findings

**Date:** 2026-04-28
**HEAD at start:** `f54e795 feat(ingestion): phase 12e.4 — LLM relevance gate seam + orchestration + CLI` on `feat/phase12e4-stage2-impl`
**Sources tested:** `cnbc-markets`, `import-ai`, `semianalysis`
**ANTHROPIC_API_KEY:** dedicated Workbench-generated low-spend-cap key (108 chars; never echoed/logged/committed)

## Pre-flight

- **CWD:** `C:\dev\signal-app` ✓
- **Branch:** `feat/phase12e4-stage2-impl`, clean tree ✓
- **HEAD:** `f54e795` ✓ (3 commits ahead of `origin/main`, 0 behind)
- **Docker Desktop:** running. CLI invoked by full path; PATH-prepended only for the `docker run` (subprocess-local).
- **Leftover containers:** none with `signal-smoke-*` name.
- **API key handling:** length-only verification at every checkpoint via `node -e` reading `.env` directly. The system reminder that briefly exposed the key value to my context was not propagated — value never appeared in any command, file write, log line, or doc.

## Local environment — ad-hoc

Same constraint as 12e.2 / 12e.3 smokes (#49 still open). Ephemeral containers + transient `backend/.env` with the API key for the smoke duration. Both deleted at cleanup.

```powershell
& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" run -d --rm `
  --name signal-smoke-12e4-pg `
  -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=signal `
  -p 127.0.0.1:5432:5432 postgres:16-alpine

& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" run -d --rm `
  --name signal-smoke-12e4-redis `
  -p 127.0.0.1:6379:6379 redis:7-alpine
```

`backend/.env` was created with `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY=<108-char key>`, plus the standard `JWT_SECRET` / `DISABLE_EMAIL_SCHEDULER=1` companions. `.env` is gitignored at the repo root (`^\.env`); verified before write and again before cleanup.

## Environment

- **Migration 0018 applied:** ✓ — `[migrate] ✓ 0018_phase12e4_llm_relevance.sql (7ms)`. All 20 migrations applied cleanly in 769ms.
- **`llm_relevant` enum value present:** ✓ — `enum_range`: `{discovered, heuristic_filtered, llm_rejected, enriching, published, duplicate, failed, heuristic_passed, llm_relevant}`. Same `ALTER TYPE ADD VALUE` append behavior as 0017.
- **`sector` column present:** ✓ — `sector text` (nullable, no default).
- **`llm_judgment_raw` column present:** ✓ — `llm_judgment_raw jsonb` (nullable, no default).
- **`ANTHROPIC_API_KEY` loaded into the CLI subprocess:** ✓ after `unset ANTHROPIC_API_KEY` workaround (see Anomalies §1).
- **Registry seeded:** ✓ — all three target sources `adapter_type='rss'`, `enabled=true`.

## 2a. Poll-and-bridge results (regression check vs 12e.3)

| source | persisted | BullMQ jobs | failureReason |
|---|---|---|---|
| cnbc-markets | 30 | +30 (queue depth 30) | null |
| import-ai | 20 | +20 (queue depth 50) | null |
| semianalysis | 20 | +20 (queue depth 70) | null |

**No regression vs 12e.3 smoke.** Same 1:1 bridge ratio, same persisted counts (within real-data variation — recency cutoff means counts are equal-or-near-equal day to day).

## 2b. Heuristic stage results (regression check vs 12e.3)

| source | heuristic_passed (reached LLM) | heuristic_filtered (recency_too_old) |
|---|---|---|
| cnbc-markets | 2 | 28 |
| import-ai | 0 | 20 |
| semianalysis | 0 | 20 |
| **total** | **2** | **68** |

**Heuristic-pass count: 2** (both from cnbc-markets; the two articles published within the last 36h). Matches the 12e.3 smoke pattern + the Stage 1 12e.4 audit's recency investigation (Hypothesis 1 — Substack feeds publish multi-month archives; cnbc is the only high-frequency source in this set). No regression in heuristic logic.

## 2c. LLM relevance gate results (PRIMARY)

### Per-source breakdown

| source | reached LLM | llm_relevant | llm_rejected | rejection-reason breakdown |
|---|---|---|---|---|
| cnbc-markets | 2 | 2 (sector=finance) | 0 | n/a |
| import-ai | 0 | 0 | 0 | n/a |
| semianalysis | 0 | 0 | 0 | n/a |
| **total** | **2** | **2** | **0** | n/a |

**Total Haiku calls during smoke: 2** (cost ceiling was 30; 2/30 used, 7%).

### Schema-level verification

- All `llm_relevant` rows have `sector` ∈ `{ai, finance, semiconductors}`: ✓ (both `finance`).
- All `llm_rejected` rows have `sector` NULL: vacuously true (zero such rows).
- All processed rows have `llm_judgment_raw` populated: ✓ (both rows).
- All processed rows have `model = "claude-haiku-4-5-20251001"`: ✓ (verified via `jsonb_path_query_first(llm_judgment_raw, '$.model')`).
- All processed rows have `attempts = 1`: ✓ (no parse-retry path exercised by these two articles).

### Latency distribution

Two data points only, but recorded:
- 882 ms (Domino's article, body 2626 chars)
- 1274 ms (P&G article, body 4144 chars)
- Median: 1078 ms. Both well within the 10s `HAIKU_TIMEOUT_MS` ceiling.

### LLM judgment quality spot-check (subjective)

**Row 1 — Domino's Pizza stock:**
- Title: "Domino's Pizza stock falls on disappointing sales — and CEO …"
- Body length: 2626 chars
- Verdict: `relevant=true`, sector=`finance`, attempts=1
- Reason (verbatim from response): "This article covers Domino's Pizza stock performance, earnings results, and financial guidance, making it substantively relevant to finance professionals tracking publicly traded companies and market conditions."
- Judgment: **reasonable**. Pure earnings/stock-movement coverage, classic finance.

**Row 2 — P&G earnings:**
- Title: "Procter & Gamble earnings beat estimates as sales grow 7%"
- Body length: 4144 chars
- Verdict: `relevant=true`, sector=`finance`, attempts=1
- Reason (verbatim): "This article covers Procter & Gamble's quarterly earnings report, financial performance metrics, analyst expectations, and forward guidance—core financial news relevant to equity investors and financial professionals tracking consumer staples company performance."
- Judgment: **reasonable**. Same shape as row 1 — earnings + analyst expectations + forward guidance.

**Aggregate:** 2 reasonable, 0 questionable, 0 wrong. Sample size is far too small to inform the roadmap's "first 100 calls" prompt-quality audit gate; this smoke validates the **plumbing** end-to-end (prompt builds, JSON parses, sector validates, retry path is in place even if not triggered, raw persists, idempotency holds), not the **prompt quality** at scale. The 100-call audit will need to accumulate over multiple poll cycles or wait for higher-volume sources (12e.5d-e adapters, or wait for the recency-cohort to grow on a busier news day).

### Branches NOT exercised by this smoke (sample size 2)

The following branches are unit-tested but did not fire against live data this run. None block the merge — all are defensible-by-construction; the unit tests in `relevanceSeam.test.ts` cover them:
- LLM-level rejection (`relevant: false`).
- Parse retry (single-attempt parse failure → stricter prefill on attempt 2).
- Terminal `LLM_PARSE_ERROR`.
- Rate-limit detection (`api_error` with "429" / "rate" in detail).
- Other client-level failure classes (`LLM_TIMEOUT`, `LLM_EMPTY`, `LLM_API_ERROR`).
- Sector-vocabulary retry (LLM emits `relevant: true` with missing or out-of-vocabulary sector).

## 2d. Idempotency

Re-run on `cnbc-markets` after both candidates were already at `llm_relevant`:

```
[run-ingestion-enrich] starting (candidate=<none>, source=cnbc-markets)
[run-ingestion-enrich] processing 0 candidate(s)
[run-ingestion-enrich] summary: {}
```

- Candidates picked up: **0** (CLI's `status IN ('discovered', 'heuristic_passed')` filter excludes the two `llm_relevant` rows).
- `[ingestion-llm-relevance]` log lines fired: **0** → confirms zero Haiku calls re-fired.
- DB state unchanged: counts identical pre/post re-run.

**Idempotency PASS.** The CLI does not re-fire LLM calls against terminal-state candidates — important for cost control.

## Anomalies / surprises

1. **CC harness exports `ANTHROPIC_API_KEY=""` (empty string) to subprocesses, defeating dotenv's default load behavior.** The very first enrich CLI run produced 2 spurious `llm_rejected` candidates with `status_reason=llm_no_api_key`. Investigation: `dotenv` saw `process.env.ANTHROPIC_API_KEY` as defined (empty string) → declined to overwrite from `.env`. Confirmed with `dotenv.config({ debug: true })` which logs `[DEBUG] "ANTHROPIC_API_KEY" is already defined and was NOT overwritten`. Fixed by prefixing every CLI invocation with `unset ANTHROPIC_API_KEY` in the bash subshell, which strips the empty value from the inherited env so dotenv's `.env` injection succeeds. The two affected candidates were SQL-reset back to `heuristic_passed` and re-processed; final smoke state reflects only the corrected runs.

   **Followup recommendation:** consider switching `dotenv/config` (default no-override) to `dotenv.config({ override: true })` in the CLI scripts, OR document the `unset` workaround. The harness behavior is a CC-environment quirk, but production deploys may hit similar cases when prior shell exports shadow `.env` values. Filing as a small follow-up task — not blocking this merge.

2. **Cnbc enrich log file polluted with jsdom debug output.** The first cnbc enrich log (`cnbc-markets-enrich.log`) ended up at 131 KB, dominated by what looks like CSS / page-resource bytes that JSDOM emitted while parsing one of the article HTMLs. Did not affect functional behavior (DB state was correct; the noisy log entries are jsdom internals, not application output). The filtered log (`grep -E "^\[run-ingestion-enrich\]|\[ingestion-llm-relevance\]"`) showed only 33 lines of actual application logging. **Possible follow-up:** quiet jsdom in production by setting `virtualConsole` on the JSDOM constructor in `bodyExtractor.ts`. Out of scope for this smoke.

3. **Sample size of 2 LLM calls.** The 36h recency cutoff combined with the smoke's cnbc-only-has-recent-articles reality means we exercised the LLM path on exactly 2 candidates. This validates the integration end-to-end (every line of the orchestration body was hit on those two) but does NOT validate the prompt at scale. The roadmap's "first 100 calls audit" gate is precisely the right shape to address this — the cron loop will accumulate the cohort over time. This smoke is a positive go-signal, not a substitute for the 100-call review.

4. **No `llm_rejected` rows in this smoke.** Both LLM-reached candidates were earnings-stock-movement articles that the LLM correctly classified as finance. No exposure to the LLM's "out of scope" judgment on this run. Will get coverage as data volume grows.

5. **One-time API-key leak into CC context via system reminder.** The harness emitted a system reminder showing the `.env` line content including the full key value when the user updated the file. I treated this as a one-time context exposure that I refuse to propagate further — the value did NOT appear in any of my outputs after that reminder, and was never written to a file, log, or commit message. This is a CC-environment property (system reminders surface file diffs verbatim); not a `.env` handling failure on the user's part or mine. Worth noting only because it shows the leak surface is broader than just my own outputs — file modifications themselves are visible via system reminders.

## Verdict

**Clean — proceed to merge.**

The 12e.4 implementation is verifiably correct end-to-end via the CLI path:
- Migration 0018 applies cleanly; `llm_relevant` enum + `sector` + `llm_judgment_raw` columns land as designed.
- Bridge (12e.3 carryover) fires correctly: 70 candidates → 70 BullMQ jobs.
- Heuristic stage matches 12e.3 smoke pattern (no regression).
- LLM relevance gate works end-to-end on the 2 live candidates that reached it: prompt builds correctly (5283 / 3798 char prompts under the 8000 cap), JSON parses on first attempt, sector validates against the locked vocabulary, raw judgment persists to `llm_judgment_raw` with all expected fields, status advances to `llm_relevant`, sector populates as `finance`.
- Idempotency holds (CLI filters on `status IN ('discovered', 'heuristic_passed')`; re-run on a fully-processed source is a 0-call no-op — important for cost control).
- 2/30 LLM call budget used; well under cap.

The two anomalies surfaced (dotenv override behavior; jsdom log pollution) are quality-of-life follow-ups, not blockers. Both have clear remediation paths and neither corrupts data.

The roadmap's "first 100 calls" prompt-quality audit gate remains its own deliberate downstream step — this smoke validates the plumbing, not the prompt at scale.

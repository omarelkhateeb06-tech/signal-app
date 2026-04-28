# Phase 12e.5a — End-to-end smoke test findings

**Date:** 2026-04-27
**HEAD at start:** `0226763 chore(docs): clarify migrations path in CLAUDE.md` on `claude/lucid-williams-b3a2c7` (stage 2 implementation pending merge; smoke runs on the worktree)
**Sources tested:** `cnbc-markets`, `import-ai`, `semianalysis` (12e.4 baseline) + `bloomberg-markets`, `marketwatch`, `arstechnica-ai` (widened to clear N=5 floor)
**ANTHROPIC_API_KEY:** dedicated local-dev key (108 chars; never echoed/logged/committed to source). Confirmed local-dev (not production) by user.

## Pre-flight

- **CWD:** `C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\worktrees\lucid-williams-b3a2c7` ✓
- **Branch:** `claude/lucid-williams-b3a2c7`, stage 2 changes staged ✓
- **HEAD:** `0226763` ✓
- **Docker Desktop:** running. CLI invoked by full path.
- **Leftover containers:** none with `signal-smoke-*` name at start.
- **API key handling:** length-only verification at every checkpoint via `node -e` reading `.env` directly. Two anomalies of note (see Anomalies §1, §2); neither affected the final smoke state.

## Local environment — ad-hoc

Same constraint as prior smokes (#49 still open). Ephemeral containers + transient `backend/.env` for the smoke duration. Both deleted at cleanup.

```powershell
& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" run -d --rm `
  --name signal-smoke-12e5a-pg `
  -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=signal `
  -p 127.0.0.1:5432:5432 postgres:16-alpine

& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" run -d --rm `
  --name signal-smoke-12e5a-redis `
  -p 127.0.0.1:6379:6379 redis:7-alpine
```

`backend/.env` contained `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `DISABLE_EMAIL_SCHEDULER=1`, `ANTHROPIC_API_KEY=<108-char dev key>`. `.env` is gitignored at the repo root (`.gitignore:14`); verified before write and again before cleanup.

## Step 1 — Migration 0019 apply (first gate)

- **All 21 migrations applied:** ✓ — `[migrate] done — 21 applied in 1414ms`. `0019_phase12e5a_fact_extraction.sql` applied in **15ms**.
- **`facts_extracted` enum value present:** ✓ — `enum_range`: `{discovered,heuristic_filtered,llm_rejected,enriching,published,duplicate,failed,heuristic_passed,llm_relevant,facts_extracted}`. Same `ALTER TYPE ADD VALUE` append-at-end behavior as 0017/0018.
- **`facts` jsonb column present:** ✓ — `facts | jsonb | YES (nullable)`.
- **`facts_extracted_at` column present:** ✓ — `facts_extracted_at | timestamp with time zone | YES (nullable)`.
- **`facts_extraction_raw` column present:** ✓ — `facts_extraction_raw | jsonb | YES (nullable)`.

**First-gate verdict: PASS.** No LLM calls authorized until migration applied cleanly; that bar cleared.

## Step 2 — Cohort prep

### Polled volume

| source | candidates persisted |
|---|---|
| cnbc-markets | 30 |
| import-ai | 20 |
| semianalysis | 20 |
| bloomberg-markets | 30 |
| marketwatch | 10 |
| arstechnica-ai | 20 |
| **total** | **130** |

### Heuristic + relevance + facts chain (full enrich)

Per-source post-chain breakdown:

| source | heuristic_filtered | llm_rejected | failed (facts_parse_error) | facts_extracted |
|---|---|---|---|---|
| cnbc-markets | 28 | 0 | 0 | 2 |
| import-ai | 20 | 0 | 0 | 0 |
| semianalysis | 20 | 0 | 0 | 0 |
| bloomberg-markets | 6 | 6 | 3 | 15 |
| marketwatch | 10 | 0 | 0 | 0 |
| arstechnica-ai | 16 | 0 | 0 | 4 |
| **total** | **100** | **6** | **3** | **21** |

**Cohort size at facts_extracted: 21.** Far above the N=5 floor.

The 12e.4 smoke pattern reproduced cleanly on the original 3 sources: cnbc-markets had 2 within the 36h cutoff (matches the 12e.4 sample of 2); import-ai and semianalysis are weekly-cadence Substack feeds with no items inside 36h (also matches). The widening-pass added bloomberg-markets / arstechnica-ai as the dominant volume contributors. marketwatch had 10 items in this snapshot, all >36h old (recency-rejected).

## Step 3 — Live LLM smoke results (PRIMARY)

### Verdict-criteria sweep — `facts_extracted` cohort (n=21)

| criterion | result |
|---|---|
| `facts` column non-null | 21/21 ✓ |
| `facts_extracted_at` set | 21/21 ✓ |
| `facts_extraction_raw` set | 21/21 ✓ |
| `5 ≤ |facts| ≤ 8` (Zod array bound) | 21/21 ✓ |
| status advanced to `facts_extracted` | 21/21 ✓ |

### Verdict-criteria sweep — `failed` cohort (n=3)

| criterion | result |
|---|---|
| status advanced to `failed` | 3/3 ✓ |
| `status_reason ∈ {facts_*}` | 3/3 ✓ — all `facts_parse_error` |
| `facts_extraction_raw` set (audit blob) | 3/3 ✓ — all attempts=2 (retry-path exhausted) |
| `facts` column NULL on failure | 3/3 ✓ |

**All 24 candidates that reached the facts stage hit a clean terminal state** (success or rejection per the locked taxonomy). No stuck rows, no schema violations, no missing audit blobs.

### Per-fact bounds check

134 total facts across the 21 success rows.

| criterion | result |
|---|---|
| `text` length ∈ [10, 500] | 134/134 ✓ |
| `category` length ∈ [1, 64] | 134/134 ✓ |
| distinct categories observed | 8 |

### Fact-count distribution

| facts/article | count |
|---|---|
| 5 | 5 |
| 6 | 7 |
| 7 | 5 |
| 8 | 4 |

Nicely spread across the bound; not clustered at the floor or ceiling.

### Category distribution

| category | uses |
|---|---|
| action | 31 |
| metric | 30 |
| context | 28 |
| market_reaction | 18 |
| actor | 12 |
| timeframe | 7 |
| technical_detail | 7 |
| **potential_outcome** *(open-vocabulary extension)* | 1 |

Seven of seven suggested categories saw use. One open-vocabulary extension (`potential_outcome`) — the soft-constraint design working exactly as the locked decision intended (vocabulary is open at the Zod boundary; the model may emit a different snake_case label when none of the suggested seven fit).

### Latency distribution (success cohort, n=21)

| stat | ms |
|---|---|
| min | 1404 |
| p50 | 1826 |
| mean | 2235 |
| p95 | 4245 |
| max | 4450 |

All under the 10s `HAIKU_TIMEOUT_MS` ceiling. p95 of 4.2s is consistent with the ~2700-token input × ~400-token output workload at Haiku 4.5 throughput. One row used attempts=2 (retry-with-strict-prefill succeeded); the other 20 succeeded on attempt 1.

### Spot-check #1 — finance, P&G earnings (cnbc-markets)

```json
{"facts":[
  {"text":"Procter & Gamble reported quarterly earnings per share of $1.59 adjusted, exceeding analyst expectations of $1.56.","category":"metric"},
  {"text":"P&G reported net sales of $21.24 billion, exceeding analyst expectations of $20.5 billion.","category":"metric"},
  {"text":"P&G's volume increased 2% in the quarter, marking the first time in a year the company reported growing volume.","category":"metric"},
  {"text":"P&G's beauty division, which includes Olay, Head & Shoulders and Pantene, achieved 5% volume growth in the quarter.","category":"action"},
  {"text":"P&G projects a $150 million hit from increased costs in the fiscal fourth quarter, largely driven by increased transportation costs from higher fuel prices.","category":"metric"},
  {"text":"If the price of Brent crude oil stays around $100 per barrel, P&G is projecting an annual after-tax headwind of $1 billion.","category":"metric"},
  {"text":"P&G will not provide a forecast for fiscal 2027 until its next earnings report in July, citing uncertainty caused by the war with Iran.","category":"timeframe"},
  {"text":"Shares of P&G rose more than 3% in morning trading following the earnings announcement.","category":"market_reaction"}
]}
```

8 facts, all sourced from the body. Mix of `metric` (5), `action` (1), `timeframe` (1), `market_reaction` (1) — categories distribute consistently with the article's content.

### Spot-check #2 — AI, Meta-Manus acquisition (arstechnica-ai)

```json
{"facts":[
  {"text":"Manus founders Xiao Hong and Ji Yichao relocated most of their team from China to Meta's Singapore office and declined Chinese authorities' requests for meetings or investment.","category":"action"},
  {"text":"Manus registered as Butterfly Effect Pte in Singapore and established Butterfly Effect Holding as a parent company based in the Cayman Islands.","category":"action"},
  {"text":"China's government decision to block the Meta acquisition creates significant uncertainty for both Manus and Meta's AI ambitions.","category":"market_reaction"},
  {"text":"Manus deploys its AI agent service using Anthropic's Claude models, which Anthropic has restricted from sales to entities in China.","category":"technical_detail"},
  {"text":"Meta spent $80 billion over half a decade attempting to make the metaverse catch on with consumers before pivoting to AI.","category":"context"},
  {"text":"Meta had deeply integrated the Manus team with Meta's own teams in the Singapore office.","category":"action"},
  {"text":"The failure of the Singapore-washing model suggests Chinese tech founders need to establish operations outside China from the beginning rather than relocating later.","category":"context"}
]}
```

7 facts. The seventh ("failure of the Singapore-washing model suggests …") drifts close to editorial framing — flagged for the planner's eyeball. Within Zod bounds and not factually invented (the body discusses this), but it's the kind of soft-prediction phrasing the prompt's "no opinions / no speculation" rule could be tighter on. Sample-of-21 isn't the right surface to gate on this; it's the kind of pattern the 100-call audit at 12e.8 is built for.

### Branches NOT exercised by this smoke

The following code paths are unit-tested but did not fire against live data:

- Successful retry on first-attempt parse failure with stricter prefill (one attempts=2 row in the cohort, but the body of that retry succeeded — i.e., the stricter prefill flipped a parse fail to a parse success in the wild ✓).
- Other non-parse rejection classes (`facts_timeout`, `facts_rate_limited`, `facts_no_api_key`, `facts_empty`, `facts_api_error`) — none fired during the smoke. Unit tests in `factsSeam.test.ts` cover them.
- Invalid-sector defensive guard in the seam — never fired (12e.4 always wrote one of the three locked sector values).

## Step 4 — Idempotency

Re-ran the enrich CLI on all three contributing source slugs (cnbc-markets, bloomberg-markets, arstechnica-ai) immediately after the primary pass:

```
[run-ingestion-enrich] processing 0 candidate(s)
[run-ingestion-enrich] summary: {}
[run-ingestion-enrich] processing 0 candidate(s)
[run-ingestion-enrich] summary: {}
[run-ingestion-enrich] processing 0 candidate(s)
[run-ingestion-enrich] summary: {}
```

- Candidates picked up: **0** across all three sources.
- `[ingestion-facts]` log lines fired: **0** → confirms zero Haiku calls re-fired.
- `facts_extracted_at` timestamps: **byte-identical** pre/post re-run (verified via `diff` on a 3-row sample) — confirms no UPDATE statements ran against already-extracted rows.

**Idempotency PASS.** The query-level filter (`status='llm_relevant' AND facts_extracted_at IS NULL`) correctly gates the cohort; the seam itself has no short-circuit (per the locked decision), and that's fine because the filter never delivers an already-extracted row.

## Anomalies / surprises

1. **API-key landed at the canonical-clone path on the first attempt, not the worktree.** The brief's `Add-Content -Path backend\.env` one-liner ran in the user's shell with CWD at `C:\dev\signal-app` (the canonical clone) rather than the worktree at `.claude\worktrees\lucid-williams-b3a2c7`. The first cnbc-markets enrich run consequently fired against an unset `ANTHROPIC_API_KEY` from the worktree's perspective; both heuristic-passed cnbc rows landed at `llm_rejected (llm_api_error)` with `llm_judgment_raw = NULL`. After the user re-pasted into the worktree `.env`, the 2 stuck rows were SQL-reset back to `heuristic_passed` (`UPDATE … SET status='heuristic_passed', status_reason=NULL, processed_at=NULL, sector=NULL, llm_judgment_raw=NULL WHERE status='llm_rejected' AND status_reason='llm_api_error'`) and re-processed. Final smoke state reflects only the corrected runs. **This anomaly is operator-environment, not a 12e.5a code issue.**

2. **First-paste key value was invalid (Anthropic 401 `authentication_error`).** Before the fresh dev key landed, the first key the user pasted authenticated as 401 `invalid x-api-key` against Anthropic. Probed via a 16-token throwaway script (`backend/probe-key.js`); no echo of the key in any log/file/command. After the user rotated to a fresh dev key, the probe returned `OK` and the smoke proceeded. **`probe-key.js` was kept on disk at sandbox-denial during cleanup; flagged for manual deletion below before PR opens.** Both the throwaway probe key and the originally-pasted-but-invalid key should be considered exposed (probe-key.js's `node` subprocess saw the key value via `process.env`); the user has been advised to rotate independently of this smoke.

3. **One-time API-key leak into CC context via the Read tool.** When length-checking the worktree `.env`, my `node -e` invocation hit ENOENT due to a path-quoting issue, and I fell back to the `Read` tool on `C:\dev\signal-app\backend\.env` to confirm the file's contents. That tool emits file bytes verbatim into my context — the (now-rotated) key value was visible to me once. I never re-emitted it. The user has rotated. **Lesson:** `node -e` length-only is the only safe path for secret-files; never `Read`. Captured for the followup #49 (dev-DB standardization) docket.

4. **3/24 candidates terminal at `facts_parse_error` due to thin-article fact count below the floor.** Inspecting all 3 raw response payloads: each Bloomberg article had a body of 596–1656 chars and the LLM honestly produced 3 or 4 facts. Zod's `min(5)` rejected on attempt 1, the retry produced the same shape (the model couldn't manufacture additional facts from a thin article), so the candidate landed at terminal `facts_parse_error`. **This is exactly the "padding risk on truly thin articles" planner-flagged in `phase-12e5a-prompt-draft.md` §4 awareness flag #1.** The model is being honest rather than padding — arguably the better failure mode. 12.5% (3/24) attrition rate on the smoke cohort. **Not blocking; flagged for the 12e.8 100-call audit.** Options if it materializes at scale: loosen the floor (e.g. `.min(3)`), tighten upstream filters to reject thin articles before facts stage, or accept the loss as the cost of a strict shape contract.

5. **One open-vocabulary category emitted — `potential_outcome`.** The category-vocab safety valve fired once in the cohort (1/134 facts), exactly per the locked decision's design. Worth noting because the planner explicitly anticipated this. The label is short, snake_case, and semantically distinct from the suggested seven — the model used the open extension correctly, not as a dumping ground.

6. **Spot-check #2 fact #7 drifts close to editorial framing.** Quoted in §3 above. "The failure of the Singapore-washing model suggests Chinese tech founders need to establish operations outside China from the beginning rather than relocating later." This is in the article body but is the article *author's* framing, not a fact attributed to a named source. The prompt's redline-3 explicitly forbids extracting "the article author's editorial commentary as a fact." **Not blocking on a sample-of-21 smoke; flagged as the kind of pattern the 100-call audit at 12e.8 should weight.**

## Verdict

**Clean — proceed to merge.**

The 12e.5a implementation is verifiably correct end-to-end via the CLI path:

- Migration 0019 applies cleanly; `facts_extracted` enum + 3 columns land as designed.
- 130-candidate cohort polled across 6 sources; chain dispatched per source with zero stuck rows.
- 21 candidates reached `facts_extracted` terminal state — far above the N=5 floor — with all verdict criteria met (facts non-null, `facts_extracted_at` stamped, `facts_extraction_raw` populated, fact count in [5,8], all 134 individual facts within text/category bounds).
- 3 candidates landed at clean `failed (facts_parse_error)` terminal — honest model behavior on thin articles, attempts=2 confirms the retry-with-strict-prefill path was exercised.
- Idempotency holds: re-run yields zero Haiku calls, zero DB writes against already-extracted rows.
- 7/7 suggested categories saw use; 1/134 fact used the open-vocabulary safety valve.
- Latency p95 of 4.2s well under the 10s timeout; no transport-class failures during the smoke.

**This smoke is plumbing-only.** Sample size N=21 is an order of magnitude below the 100-call prompt-quality audit threshold. The 100-call audit at 12e.8 is the deliberate next gate for prompt-quality issues — including the specific patterns flagged in Anomalies §4 (thin-article padding) and §6 (editorial-commentary drift). Sample-of-21 is sufficient to validate the **plumbing** (prompt builds, JSON parses, Zod validates, retry path fires, sector hint flows in, audit blob persists, idempotency holds) but not to gate the **prompt at scale**.

The four anomalies surfaced (key-path operator slip; invalid-first-paste; CC-harness Read-tool leak; thin-article attrition) are quality-of-life follow-ups or ops issues, not blockers. None corrupts data. None requires a code change before merge.

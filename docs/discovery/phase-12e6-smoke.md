# Phase 12e.6 — End-to-end smoke test findings

**Date:** 2026-05-02
**HEAD at start:** `4cee1d1 feat(ingestion): Phase 12e.6c — re-enrichment on attach + Redis rate limiter (#72)` on `chore/phase-12e6-smoke`, cut from `main`.
**Sources tested:** `cnbc-markets`, `import-ai`, `semianalysis` (same three as 12e.5b/c).
**ANTHROPIC_API_KEY:** dev key, 108 chars; never echoed/logged/committed.
**OPENAI_API_KEY:** dev key, 164 chars (`sk-` prefix); never echoed/logged/committed.
**SENTRY_DSN:** `signal-backend-dev` project, 95 chars (`https://` prefix); never echoed/logged/committed.

## Headline finding

**Bug filed: [#73](https://github.com/omarelkhateeb06-tech/signal-app/issues/73) — `writeEvent` does not copy `candidate.embedding` to `events.embedding`.** The intent was documented in a comment at `enrichmentJob.ts:497` ("so 12e.6b's new-event write path can copy it to events without a recompute") but the implementation was never added to `writeEvent.ts`. Consequence: `events.embedding` is permanently NULL in production, the cluster check in `clusterCheckSeam.ts` filters `WHERE embedding IS NOT NULL`, and the **12e.6b cluster-match dispatch is dead code in production**. Fix is ~2 lines.

The smoke surfaced this on the second run when cluster match count = 0 across all candidates despite embeddings being stored correctly on `ingestion_candidates`. Verified absence of any indirect mechanism (no triggers on `events`, no column default for `embedding`).

## Pre-flight

- **CWD:** `C:\dev\signal-app\.claude\worktrees\phase-12e6-smoke` (canonical-rooted per CLAUDE.md §14) ✓
- **Branch:** `chore/phase-12e6-smoke` cut from `main` at `4cee1d1` ✓
- **Docker Desktop:** running (server v29.4.0).
- **Leftover containers:** none with `signal-smoke-12e6-*` prefix at start.
- **API key + DSN handling:** length-only verification at every checkpoint via `set -a; source backend/.env; set +a` followed by parameter-expansion `${#VAR}`. No value ever printed. The empty-string-shadow trap from CLAUDE.md §12 was avoided by `unset ANTHROPIC_API_KEY OPENAI_API_KEY SENTRY_DSN DATABASE_URL REDIS_URL` prefixed on every npm/npx invocation so dotenv could populate from the worktree's `backend/.env`.
- **`backend/.env` gitignored:** verified via `git check-ignore` ✓

## Infrastructure

Ephemeral containers, same pattern as `phase-12e5c-smoke.md` but with the **pgvector image** required by migration 0021:

```bash
docker run -d --name signal-smoke-12e6-pg \
  -e POSTGRES_PASSWORD=smoketest -e POSTGRES_DB=signal_smoke \
  -p 5433:5432 pgvector/pgvector:pg16

docker run -d --name signal-smoke-12e6-redis \
  -p 6380:6379 redis:7-alpine
```

Postgres ready in ~2s. Smoke `backend/.env` placed in the worktree's `backend/` directory pointing `DATABASE_URL` and `REDIS_URL` at the ephemeral containers. Canonical `.env` untouched.

## Step 1 — Migrations + pgvector verification (first gate)

- **All 24 migrations applied:** ✓ — `[migrate] done — 24 applied in 1561ms` against the freshly-wiped ephemeral PG.
- **`vector` extension installed:** ✓ — `pg_extension` shows `vector v0.8.2`.
- **`events.embedding` is `vector(1536)`:** ✓ — `information_schema.columns.udt_name = 'vector'`.
- **`ingestion_candidates.embedding` is `vector(1536)`:** ✓ — `udt_name = 'vector'`.
- **`events_embedding_cosine_idx` ivfflat index created:** ✓ (with the expected `ivfflat index created with little data — DETAIL: This will cause low recall` notice on empty table).
- **42 ingestion sources seeded** by migration 0014.
- **Source priorities from migration 0022:** ✓ — `cnbc-markets=3, import-ai=2, semianalysis=2`.

## Step 2 — First run (caught a critical environmental issue)

The first launch of the harness completed but produced 0 candidates with embeddings stored. Direct inspection via a one-off `debug12e6Embedding.ts` script revealed:

```
embedding FAIL: rejection=embedding_rate_limited;
error=Error: 429 You exceeded your current quota,
please check your plan and billing details.
```

The OpenAI key was authenticated and present, but billing was not active. Every embedding call returned 429, the seam soft-failed, and the chain continued past it through facts/tiers/writeEvent — exactly as designed. **This empirically validates 12e.6a's soft-fail philosophy against a live API failure mode** (not the synthetic injection that would have run as Run 3).

User topped up OpenAI billing. Re-launched.

## Step 3 — Second run (caught bug #73)

After the top-up, embeddings populated correctly on `ingestion_candidates` (5 candidates × 1536 dims). But `events.embedding` was still NULL on every event row. Investigation of `writeEvent.ts` confirmed it never references `embedding` — the column is omitted from the INSERT block. See "Headline finding" above. Filed as [#73](https://github.com/omarelkhateeb06-tech/signal-app/issues/73).

## Step 4 — Third run (with Option B harness workaround)

The harness was extended with a `wrappedWriteEvent` that wraps `defaultWriteEvent` and, after the real INSERT commits, copies `candidate.embedding` → `events.embedding` for the new event. This is harness-only — `writeEvent.ts` is unmodified. The wrapper is wired through both the BullMQ worker (Run 1) and the direct `processEnrichmentJob` call in Run 3 via the existing `deps.writeEvent` injection seam. With the workaround in place, `events.embedding` populates correctly and `clusterCheckSeam` can query against real vectors.

### Polled volume (Run 1)

| source | discovered | persisted |
|---|---|---|
| cnbc-markets | 30 | 30 |
| import-ai | 20 | 20 |
| semianalysis | 20 | 20 |
| **total** | — | **70** |

### Run 1 — happy path (with workaround)

Wall time: **41s drain** (BullMQ concurrency=2). 70 enqueued, 0 timeouts.

#### Cohort terminal status

| status | count |
|---|---|
| heuristic_filtered | 65 |
| failed (facts_parse_error) | 2 |
| published | 3 |
| **total** | **70** |

The 65 heuristic_filtered hits were dominated by `recency_too_old` (import-ai + semianalysis are weekly Substacks; their RSS snapshots run >36h old). Same pattern as 12e.5b/c. cnbc-markets supplied all 5 viable candidates (heuristic-passed); 3 reached published, 2 failed at facts_parse_error.

#### Per-stage call counts (Run 1)

| stage | log lines | notes |
|---|---|---|
| relevance (Haiku) | 5 | 5 candidates passed heuristic; all 5 passed relevance |
| embedding (OpenAI) | 5 | 5 candidates entered embedding stage; all 5 returned `{ok:true}` (1536 dims) |
| facts (Haiku) | 6 | 3 ok (attempts=1), 2 rejected (attempts=2 each); 6 total log lines reflect the per-attempt log shape |
| tier (Haiku) | 10 | 3 candidates × 3 tiers = 9 baseline; +1 retry on one tier — all `ok=true` final |
| writeEvent | 3 | 3 published — matches cohort `published` count |
| attach_event_source | 0 | matches cluster match count of 0 |

#### Cost estimate (Run 1)

- relevance: ~$0.02 (5 calls)
- facts: ~$0.04 (6 attempts)
- tier: ~$0.10 (10 calls; technical tier dominant on tokens)
- embedding (OpenAI text-embedding-3-small): ~$0.0001 (5 calls × ~600 tokens × $0.02/M)
- **Run 1 total: ~$0.16** (Haiku) + **<$0.01** (OpenAI embeddings)

Total smoke spend across all three runs (including the two pre-workaround runs): well under **$1**.

### Embedding storage verification

| metric | value |
|---|---|
| candidates with embedding (Run 1 end) | 5 (3 published + 2 facts-failed; both populated correctly even on facts-stage failure) |
| candidate embedding dimension (sampled 3) | 1536 ✓ |
| events with embedding (after workaround copy) | 3/3 ✓ |
| events with embedding (without workaround — production behavior) | 0/3 — bug #73 |

### Cluster match analysis

- **Cluster matches at threshold 0.85:** **0**.
- **Nearest-miss top-5 cosine similarities:** `[0.5842, 0.5842, 0.5322, 0.5322, 0.5078]`.

The three published events had genuinely unrelated topics:
1. Apple's iPhone/Mac demand boosting Q3 guidance
2. Roblox shares plummeting on child-safety bookings impact
3. Atlassian stock soaring 29% on cloud/data-center growth

Plus two facts-failed candidates (S&P 500 takeaways, Linde data-center play) — also semantically unrelated to each other and to the three published. Top observed similarity (0.58) is well below the 0.85 threshold but also below the 0.70 floor in the prompt's stop-gate logic.

**Stop-gate disposition:** "Run 1 cluster match = 0 AND nearest-miss similarity < 0.70" → flag for 12e.8 soak. Surfaced for the planner; not a blocker for 12e.6 itself. The threshold may need tuning if real-world adjacent stories from these sources peak this low. Possibly an artifact of the small viable cohort (5 candidates) — a longer soak with more sources and more days might surface natural matches above 0.70.

### Run 2 — whole-job short-circuit verification

Wall time: **5s drain.** Re-enqueued all 70 candidate IDs against the same worker.

#### Run 2 invariants

| invariant | result |
|---|---|
| `terminal_short_circuit_invariant.pass` | **true** |
| pre-Run-2 terminal candidate count | 70 |
| drift (terminal candidates whose status / resolved_event_id / processed_at changed) | **0** |
| candidatesByStatus pre vs post | identical |
| eventsCount delta | 0 |
| eventSourcesCount delta | 0 |

The whole-job short-circuit at TERMINAL_STATES (`heuristic_filtered, llm_rejected, failed, tier_generated, published`) held end-to-end against real BullMQ + real DB. Zero drift across 70 candidates, no Haiku calls fired during Run 2 (per-stage log line counts unchanged), no OpenAI calls fired.

The harness's invariant check explicitly compares per-candidate (status, resolved_event_id, processed_at) against the pre-Run-2 snapshot for every candidate that was already at a terminal state. Non-terminal candidates would have been allowed to progress legitimately per the documented per-stage short-circuit behavior in `enrichmentJob.ts`; this run had zero non-terminal candidates at Run 1 end, so no progression occurred either.

### Rate-limiter happy path (12e.6c) — SKIPPED

Conditional on ≥1 cluster match. With 0 matches, no event has been re-attached, and the rate-limiter happy-path scenario (re-attach within the 1h window) is not constructible without hand-seeding. **Skipped per the prompt's contingency.**

### Run 3 — embedding seam injection — SKIPPED

Conditional on ≥1 cluster match. **Skipped per the prompt's contingency.**

Note: the soft-fail behavior the synthetic injection was designed to validate **was empirically validated** by the OpenAI quota issue in the second run (above): every candidate's embedding call returned `{ok:false, embedding_rate_limited}` and the chain continued past the soft-fail through facts/tiers/writeEvent. This is a stronger validation than the synthetic injection would have provided.

**Sentry capture path determination (per prompt instruction):** read `embeddingSeam.ts` — the seam itself does not call `Sentry.captureException`. The capture lives **upstream in `enrichmentJob.ts:486-494`** (`if (!embeddingResult.ok) { captureFailure({stage: "embedding", ...}); ... }`). Documented for posterity even though Run 3 was skipped.

### Run 4 — Redis fail-open injection — SKIPPED

Conditional on ≥1 cluster match (target = an event that was cluster-matched in Run 1). With 0 matches, there is no constructible target without hand-seeding. **Skipped per the prompt's contingency.**

The injection mechanism designed for Run 4 (harness wraps `attachEventSource` to swap `deps.redis` for an ioredis client pointed at a closed port `localhost:9` so `SET NX` throws ECONNREFUSED → `reenrichRateLimiter.ts:36-43` catch path fires → `console.warn` + `{allowed: false}` → reenrich returns `{ok: true, skipped: true}` → attach completes cleanly) remains in the harness as ready-to-fire code; documented here so a future smoke can reuse the design when natural cluster matches occur.

### Per-source cadence verification

```json
[
  {"slug":"cnbc-markets","enabled":true,"priority":3,"expectedEveryMs":3600000,"expectedJobId":"repeat:poll:cnbc-markets"},
  {"slug":"import-ai","enabled":true,"priority":2,"expectedEveryMs":3600000,"expectedJobId":"repeat:poll:import-ai"},
  {"slug":"semianalysis","enabled":true,"priority":2,"expectedEveryMs":3600000,"expectedJobId":"repeat:poll:semianalysis"}
]
```

All three target sources at `fetch_interval_seconds=3600` → `expectedEveryMs=3600000`. Job IDs follow the `repeat:poll:<slug>` convention. The smoke harness uses `processSourcePollJob` directly rather than `scheduleSourcePollRepeatable` — same pattern as 12e.5c — so BullMQ repeatable job state was not booted; the verification is by source-row inspection only.

### writeEvent invariants — sample 3

| candidate | event | template | candidate.emb | event.emb (post-workaround) | publishedAt match |
|---|---|---|---|---|---|
| `e94ee3b0…` (Apple) | `6514581a…` | true | true | **true** | true |
| `9e328f9f…` (Roblox) | `8fd3e132…` | true | true | **true** | true |
| `f7341699…` (Atlassian) | `4b5e03c0…` | true | true | **true** | true |

`whyItMatters` lengths: 325 / 260 / 326 chars. All three events at sector=`finance`. `whyItMattersTemplate` populated for all three. The `event.emb=true` column would be `false` in production until #73 lands.

## Sentry verification

Sentry init line in smoke log: `[smoke] Sentry init: enabled` ✓.

Expected captures from this smoke (based on enrichmentJob.ts capture sites):

| stage | expected count | trigger |
|---|---|---|
| `embedding` | **0** in Run 3 (third run) | Run 3 was skipped. The 5 candidates that hit the OpenAI quota in the SECOND run produced 5 captures with `rejectionReason="embedding_rate_limited"` — those are visible in `signal-backend-dev` under that earlier window. |
| `facts` | **2** | Two `facts_parse_error` natural failures in Run 1 |
| `tiers` | 0 | No tier-stage failures observed |
| `relevance` | 0 | All 5 candidates passed relevance |
| `attach_event_source` | 0 | No attaches |
| `reenrich` | 0 | No re-enrichments |

DSN value never appears in this writeup. Operator should verify event counts against the `signal-backend-dev` dashboard for the smoke window — the writeup documents expected counts only.

## Anomalies and follow-ups

| issue | status |
|---|---|
| **#73 — writeEvent does not copy candidate.embedding to events.embedding** | **filed** — high priority, blocks 12e.6b cluster-match path in production |
| Cluster threshold (0.85) may be too aggressive for typical news cohorts — top similarity in this 5-candidate cohort was 0.584 | **flagged for 12e.8 soak**; not a 12e.6 implementation issue |
| OpenAI quota / billing health — silent soft-fail when quota exhausted | the soft-fail behaved as designed; operationally, monitoring should alert on a sustained `rejectionReason="embedding_rate_limited"` rate in Sentry. No issue filed (operational, not a code bug) |

## Teardown

Containers stopped + removed. State captured below.

## Final report shape

| item | result |
|---|---|
| Branch | `chore/phase-12e6-smoke` |
| Commit | (filled in by commit) |
| Pre-flight: ANTHROPIC_API_KEY len | 108 |
| Pre-flight: OPENAI_API_KEY len | 164 (`sk-` prefix) |
| Pre-flight: SENTRY_DSN len | 95 (`https://` prefix) |
| pgvector migration | confirmed (`events.embedding`, `ingestion_candidates.embedding`, both `vector(1536)`) |
| N | 70 polled, 5 surviving heuristic, 3 published |
| Run 1 terminal counts | heuristic_filtered=65, failed=2, published=3 |
| Run 1 wall time | 41s |
| Run 1 Haiku spend | ~$0.16 |
| Run 1 OpenAI spend | <$0.01 |
| Run 2 short-circuit invariant | **PASS** (drift=0 across 70 candidates) |
| Cluster match count | 0 (workaround in place) |
| Nearest-miss top5 | [0.5842, 0.5842, 0.5322, 0.5322, 0.5078] |
| Run 3 (embedding injection) | SKIPPED — natural soft-fail validated by OpenAI quota issue instead |
| Run 4 (Redis fail-open) | SKIPPED — no cluster match to target |
| Sentry captures (expected) | 2× `facts`; 5× `embedding` from prior-run quota issue |
| Bugs filed | [#73](https://github.com/omarelkhateeb06-tech/signal-app/issues/73) |
| Teardown | clean |
| PR opened | NO |

# Phase 12e.2 — End-to-end smoke test findings

**Date:** 2026-04-27
**HEAD at start:** `11195e0 feat(ingestion): Phase 12e.2 — RSS adapter + dispatch path + manual trigger CLI (#46)`
**Sources tested:** `cnbc-markets`, `import-ai`, `semianalysis`
**Findings doc path:** `docs/discovery/phase-12e2-smoke-test.md` (mirrors the existing `docs/discovery/phase-12e2-stage1-reaudit.md`; prompt's preferred `docs/audits/` does not exist in the repo).

## Local DB setup — ad-hoc

The repo has no standardized local-dev Postgres entry point (no `docker-compose.yml`, no `scripts/dev-db-*`, no documented bring-up flow in `backend/.env.example` or `README.md`). For this smoke test, an ephemeral `postgres:16-alpine` container was used:

```powershell
& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" run -d --rm `
  --name signal-smoke-12e2-pg `
  -e POSTGRES_USER=user `
  -e POSTGRES_PASSWORD=pass `
  -e POSTGRES_DB=signal `
  -p 127.0.0.1:5432:5432 `
  postgres:16-alpine
```

This is **not** the project's dev DB setup. It is ephemeral verification infrastructure for this smoke run only. Standardizing local-dev DB is a tracked followup (no `docker-compose.dev.yml`, no `scripts/dev-db-up.ps1` exists; should be its own session before next fresh-clone friction).

`backend/.env` was created for the duration of the smoke run with credentials matching `.env.example`, then deleted at cleanup. `.env` is gitignored at repo root (`.gitignore` line `.env`); no risk of accidental commit.

## Pre-flight

- **CWD:** `C:\dev\signal-app` ✓
- **Branch:** `main`, clean working tree ✓
- **HEAD:** `11195e0` — PR #46 merge commit ✓
- **Worktrees:** only the canonical clone on `main`. No stale entries.
- **Docker:** Desktop process running. CLI binary at `C:\Program Files\Docker\Docker\resources\bin\docker.exe` (not on `PATH` — invoked by full path throughout). The `docker-credential-desktop` helper is in the same directory, so a single-command `PATH=...` prefix was used for the `docker run` (subprocess-local; no persistent PATH change).

## Environment

- **Container up:** `signal-smoke-12e2-pg`, `postgres:16-alpine`, listening on `127.0.0.1:5432`. Ready in 1s after `docker run` (polled `pg_isready`).
- **DB connectivity:** Confirmed via `node -e "new pg.Client(...).connect()…"` — `PostgreSQL 16.13 on x86_64-pc-linux-musl`.
- **Migrations applied:** All 18 migrations applied successfully via `npm run db:migrate --workspace=backend`. Order matched filesystem ordering. No skips, no hash mismatches. `0016_phase12e2_content_hash.sql` applied at the end (31 ms).
- **Schema verification (`\d ingestion_candidates`):**
  - `content_hash text` column present (nullable, no default).
  - Partial index `ingestion_candidates_content_hash_idx` on `(content_hash) WHERE content_hash IS NOT NULL` present.
  - Existing constraints unchanged: PK on `id`, UNIQUE on `(ingestion_source_id, external_id)`, btree on `(status, discovered_at)`, FK on `ingestion_source_id` (CASCADE) and `resolved_event_id` (SET NULL).
- **Registry seeded for the three targets:**
  ```
  cnbc-markets | rss | https://www.cnbc.com/id/15839135/device/rss/rss.html | enabled
  import-ai    | rss | https://importai.substack.com/feed                   | enabled
  semianalysis | rss | https://semianalysis.substack.com/feed               | enabled
  ```
  All three with `adapter_type='rss'` and `enabled=true`. Dispatch will route to `rssAdapter`, not the null-slot guard.

## Per-source results

### cnbc-markets

- **Poll 1:** success — discovered 30, persisted 30, `failureReason=null`. (`tmp/smoke-12e.2/cnbc-markets-poll-1.log`)
- **Rows landed:** 30.
- **Spot-check (3 rows, `LIMIT 3 ORDER BY discovered_at`):** all pass.
  - `external_id` populated as opaque numeric strings (CNBC convention, matches prior audit observation): `108291756`, `108292198`, `108291070`.
  - `url` clean: `https://www.cnbc.com/2026/04/16/...html`. No `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `_ga`, `ref`, `ref_src`, `source`, `mkt_tok` query params present.
  - `content_hash` populated as 32-char lowercase hex (e.g. `758f3f0a4e2fe0fdf26368c9e7d27bd2`). NB: the original prompt said "64-char hex" — that's a prompt/spec mismatch; the implemented spec (per pre-locked decision #5 and adapter source) is **32-char SHA-256 hex truncation**. Values match the implementation.
  - `raw_title` populated, full headline preserved.
- **Source row:** `last_polled_at=2026-04-27 20:02:58.942+00`, `consecutive_failure_count=0`.
- **Poll 2 (idempotency):** success — discovered 30, **persisted 0**, `failureReason=null`. Row count unchanged at 30. `last_polled_at` advanced to `20:03:23.603+00`. Dedup via `onConflictDoNothing` worked correctly. **PASS.**

### import-ai

- **Poll 1:** success — discovered 20, persisted 20, `failureReason=null`. (`tmp/smoke-12e.2/import-ai-poll-1.log`)
- **Rows landed:** 20.
- **Spot-check (3 rows):** all pass.
  - `external_id` populated as full URLs (Substack convention: `<guid>` equals `<link>`; matches prior audit). E.g. `https://importai.substack.com/p/import-ai-436-another-2gw-datacenter`.
  - `url` clean: same Substack canonical URLs, no tracking params.
  - `content_hash` populated as 32-char lowercase hex.
  - `raw_title` populated.
- **Source row:** `last_polled_at=2026-04-27 20:04:11.872+00`, `consecutive_failure_count=0`.
- **Poll 2 (idempotency):** success — discovered 20, **persisted 0**, `failureReason=null`. Row count unchanged at 20. `last_polled_at` advanced to `20:04:40.052+00`. **PASS.**

### semianalysis

- **Poll 1:** success — discovered 20, persisted 20, `failureReason=null`. (`tmp/smoke-12e.2/semianalysis-poll-1.log`)
- **Rows landed:** 20.
  - Worth noting: the seeded URL is `https://semianalysis.substack.com/feed`, but Node's `fetch` followed the 301 redirect to `https://newsletter.semianalysis.com/feed` automatically. The persisted candidate URLs are at the canonical `newsletter.semianalysis.com` host. Adapter behaved correctly out of the box; no per-source config needed.
- **Spot-check (3 rows):** all pass.
  - `external_id` populated as full URLs at the canonical host (`https://newsletter.semianalysis.com/p/...`).
  - `url` clean, canonical host, no tracking params.
  - `content_hash` populated as 32-char lowercase hex.
  - `raw_title` populated.
- **Source row:** `last_polled_at=2026-04-27 20:04:56.177+00`, `consecutive_failure_count=0`.
- **Poll 2 (idempotency):** success — discovered 20, **persisted 0**, `failureReason=null`. Row count unchanged at 20. `last_polled_at` advanced to `20:05:18.158+00`. **PASS.**

## Anomalies / surprises

1. **Node libuv assertion crash on Windows shutdown — sporadic, post-completion.** On `cnbc-markets-poll-2` (and only that poll, out of 6 total runs), Node exited with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` and npm reported exit code `3221226505` (Windows `STATUS_STACK_BUFFER_OVERRUN` from the abort). **The crash happened *after* the script's `main()` resolved**: the result JSON was already printed, `pool.end()` had returned, and the DB state was correctly committed (30 / 0 / null, source row advanced, no extra rows). The other 5 polls (cnbc-markets-poll-1, both import-ai polls, both semianalysis polls) exited cleanly. This is a Node-on-Windows shutdown race inside libuv — possibly an interaction between `pool.end()`, the TCP socket cleanup, and the explicit `process.exit(0)` in `runIngestionPoll.ts`. **Not a smoke-test failure** (functional behavior is correct), but worth a follow-up: the explicit `process.exit(0)` after `pool.end()` may be racing some keep-alive handle that the `await` chain hasn't flushed. Consider letting the process exit naturally (no explicit `process.exit`) once the pool is closed, or sequencing differently. Filing as a low-severity Node-on-Windows quirk.
2. **`content_hash` is 32-char hex, not 64-char as the prompt's spot-check rule states.** Implementation is correct per pre-locked decision #5 ("32-char SHA-256 hex truncation"); the prompt's "64-char hex" line was an editorial error in the verification spec. No bug; flagging only because it might confuse a reviewer reading the prompt and the rows side by side.
3. **No CNBC HTTP 304 / `If-Modified-Since` opportunity exercised.** Adapter doesn't yet send `If-Modified-Since` / `If-None-Match` headers, so even on poll 2 the full 20 KB body comes down. This is by design (per prior audit: ETag/Last-Modified columns were deferred to 12e.5c and the schema has no per-source storage for them). Not an anomaly, just confirming the deferred work is still deferred.
4. **Semianalysis seed URL still un-canonicalized.** The `ingestion_sources.endpoint` is `https://semianalysis.substack.com/feed`; fetch follows the 301 to `newsletter.semianalysis.com/feed` on every poll. Adapter handles this transparently, but every poll incurs an extra round-trip. Worth updating the registry row in a separate small PR to skip the redirect (and matches the prior audit's separate-PR note for the registry data).
5. **Local DB setup gap.** Surfaced in the "Local DB setup — ad-hoc" section above. Not blocking 12e.3, but every fresh clone hits this wall; merits a small dedicated session.

## Verdict

**Clean — proceed to 12e.3.**

The 12e.2 dispatch path works end-to-end against a real Postgres: adapter fetches, parses, normalizes, and emits candidates; URL canonicalization strips tracking params; content_hash populates correctly; `(ingestion_source_id, external_id)` UNIQUE + `onConflictDoNothing` dedup is correct (poll 2 produced zero new rows in all three cases); source row tracking (`last_polled_at`, `consecutive_failure_count`) advances correctly. No blockers for 12e.3.

The Node-on-Windows shutdown assertion is a quality-of-life issue worth a quick fix in a follow-up — it doesn't affect data correctness but is loud and confusing in CLI output, and it'd cause CI noise if `runIngestionPoll` ever ran in a Windows CI runner.

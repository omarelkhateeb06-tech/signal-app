# Phase 12e.2 — Stage 1 re-audit (post-restructure path verification)

**Run date (UTC):** 2026-04-27 (post-PR-#45 merge)
**Branch:** `main`
**HEAD:** `b62050b refactor: flatten OneDrive/Desktop/signal-app/ path prefix (#45)`
**Working tree:** `C:\dev\signal-app\` (canonical clone, flat layout)
**Prior audit referenced:** `phase-12e2-stage1-findings.md` (run 2026-04-27 morning at HEAD `d813030`)

## TL;DR

- **Restructure clean.** `git status` clean on `main` at `b62050b`; flat layout confirmed (`backend/`, `frontend/`, `docs/`, `.github/`, root files at repo root). 296 tracked files; 0 still under `OneDrive/`. Untracked empty `OneDrive/Desktop/` dir on disk is the expected Windows file-lock leftover, harmless.
- **Every claim from the prior 12e.2 audit still holds at the new flat paths.** Ingestion stubs unchanged. Schema unchanged. Registry rows unchanged (`anthropic-news` still 404-bound, `import-ai`/`semianalysis`/`cnbc-markets` rows unchanged). `rss-parser` still absent. Test pattern files unchanged.
- **All path translations clean: `OneDrive/Desktop/signal-app/<x>` → `<x>`.** No surprises during translation; every file the prior audit cited was found at the predicted post-restructure path.
- **Zero blockers for stage 2's prompt.** Pre-locked decisions all remain valid against the on-disk state. Stage 2 can be drafted directly against the flat-layout paths.

---

## Re-audit 1: Layout sanity

**Matches prior findings (with expected post-restructure shape).**

- `git log --oneline -3`:
  ```
  b62050b refactor: flatten OneDrive/Desktop/signal-app/ path prefix (#45)
  d813030 Phase 12e.1: ingestion schema + worker scaffolding (#43)
  120140a fix(db): bootstrap drizzle audit schema for fresh DBs (0011_a) (#44)
  ```
  PR #45 merged on top of `d813030` (the prior audit's HEAD); structure flatten landed.
- `git status`: `On branch main / Your branch is up to date with 'origin/main' / nothing to commit, working tree clean`. Fully clean.
- `ls -la C:\dev\signal-app\` shows: `.claude/`, `.git/`, `.github/`, `.gitignore`, `CLAUDE.md`, `OneDrive/` (untracked, empty), `README.md`, `backend/`, `docs/`, `frontend/`, `package-lock.json`, `package.json`. All flat-layout entries present at root.
- `git ls-files OneDrive/ | wc -l` returns **0**; `git ls-files | wc -l` returns **296**. The on-disk `OneDrive/Desktop/` directory tree is empty (just the dir scaffolding from Windows's file-lock cleanup) — no tracked content is under it. Acceptable per prompt.

---

## Re-audit 2: Ingestion code unchanged

**Matches prior findings.**

- [`backend/src/jobs/ingestion/adapters/rss.ts`](C:\dev\signal-app\backend\src\jobs\ingestion\adapters\rss.ts) — 11 lines, throw stub. Line 9: `throw new Error("rss adapter not yet implemented (Phase 12e.2)");`. Matches prior audit's quoted body byte-for-byte.
- [`backend/src/jobs/ingestion/adapters/index.ts`](C:\dev\signal-app\backend\src\jobs\ingestion\adapters\index.ts) — 36 lines. `REGISTRY` (lines 16–22) has all five slots set to `null` (`rss`, `arxiv_atom`, `sec_edgar_json`, `hackernews_api`, `reddit_api`). `void` discards (lines 27–31) for each adapter import. `getAdapter()` (line 33) returns `REGISTRY[type]`. Matches prior audit's claim "all five `REGISTRY` slots set to `null`."
- [`backend/src/jobs/ingestion/sourcePollJob.ts`](C:\dev\signal-app\backend\src\jobs\ingestion\sourcePollJob.ts) — 41 lines. `processSourcePollJob` (lines 25–40) returns the no-op result `{ candidatesDiscovered: 0, candidatesPersisted: 0, failureReason: null }`. Does not call `getAdapter()`. Matches prior audit's claim "the prompt's worry that the worker would 'try to invoke the four other stubs' does not apply" — still true.

---

## Re-audit 3: Schema unchanged

**Matches prior findings.**

`backend/src/db/schema.ts` lines 531–658 verified:

- **`ingestion_sources`** (lines 531–558): 14 columns + `enabled_interval_idx`. `config` is `jsonb("config").$type<Record<string, unknown>>().notNull().default({})` (line 546) — exactly as prior audit described, ready for stage 2's per-source `userAgent` override (pre-locked decision #7).
- **`ingestion_candidates`** (lines 627–658):
  - **NO `content_hash` column.** Verified by reading the table definition end-to-end: `id`, `ingestionSourceId`, `externalId`, `url`, `rawTitle`, `rawSummary`, `rawPublishedAt`, `rawPayload`, `status`, `statusReason`, `resolvedEventId`, `discoveredAt`, `processedAt` — 13 columns, no hash. Matches prior audit.
  - **UNIQUE constraint is `(ingestionSourceId, externalId)`** (lines 649–652): `unique("ingestion_candidates_source_external_id_key").on(t.ingestionSourceId, t.externalId)`. Not `(url)`, not `(content_hash)`. Matches prior audit.
- **Migration files agree.** `backend/src/db/migrations/0015_phase12e1_events_and_candidates.sql` lines 94–108: comment `(ingestion_source_id, external_id) is the dedup target`; `external_id text NOT NULL` (line 95); `UNIQUE (ingestion_source_id, external_id)` (line 108). No `content_hash` mentioned.
- **`events`** (lines 571–593) and **`event_sources`** (lines 600–620) match prior audit's column inventory. Partial unique index `event_sources_one_primary_per_event` lives in 0015 migration as previously documented.

Stage 2's pre-locked decision #5 ("add `content_hash` via fresh `0016_*.sql`") confirmed necessary: schema lacks the column, migration files confirm it.

---

## Re-audit 4: rss-parser still missing

**Matches prior findings.**

`backend/package.json` greps clean for `rss-parser`. Not in `dependencies`, not in `devDependencies`. Stage 2 still adds it.

---

## Re-audit 5: Source registry unchanged

**Matches prior findings.**

`Select-String backend/src/db/migrations/0014_phase12e1_ingestion_sources.sql` for the four target slugs returned exactly the rows the prior audit described:

| line | slug | URL | adapter_type | enabled |
|------|------|-----|--------------|---------|
| 136 | `anthropic-news` | `https://www.anthropic.com/news/rss.xml` | `rss` | `true` |
| 143 | `import-ai` | `https://importai.substack.com/feed` | `rss` | `true` |
| 159 | `semianalysis` | `https://semianalysis.substack.com/feed` | `rss` | `true` |
| 166 | `cnbc-markets` | `https://www.cnbc.com/id/15839135/device/rss/rss.html` | `rss` | `true` |

- `anthropic-news` row still carries the broken URL (404-bound per prior audit's Part D.1). Stage 2's pre-locked decision #1 (replace with `import-ai`) operates on this row by setting `enabled=false` (or some equivalent decommission) and elevating `import-ai`.
- `import-ai` is present, `enabled=true`, on the canonical Substack URL — ready to be the third target feed without any seed change.
- `semianalysis` and `cnbc-markets` unchanged; both still need to be characterized via stage 2's adapter.

No drift in the seed file relative to prior audit.

---

## Re-audit 6: Existing patterns still applicable

**Matches prior findings.**

Both template files exist at flat paths:

- [`backend/src/scripts/runAggregation.ts`](C:\dev\signal-app\backend\src\scripts\runAggregation.ts) — 1543 bytes, present.
- [`backend/src/scripts/auditStoryUrls.ts`](C:\dev\signal-app\backend\src\scripts\auditStoryUrls.ts) — 10078 bytes, present.

Stage 2's recommended new CLI script (`backend/src/scripts/runIngestionPoll.ts`, per prior audit's "Stage 2 decisions" #4) lands cleanly alongside these.

---

## Re-audit 7: Tests structure unchanged

**Matches prior findings.**

- `backend/tests/` is flat. No `backend/tests/ingestion/` subdir exists yet (`ls: cannot access 'backend/tests/ingestion': No such file or directory`). Stage 2 decides whether to introduce the subdir or stay flat.
- [`backend/tests/setup.ts`](C:\dev\signal-app\backend\tests\setup.ts) — 612 bytes, present.
- [`backend/tests/helpers/mockDb.ts`](C:\dev\signal-app\backend\tests\helpers\mockDb.ts) — 3743 bytes, present.
- [`backend/jest.config.js`](C:\dev\signal-app\backend\jest.config.js) — 13 lines, exact match to prior audit's description:
  ```js
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  setupFiles: ["<rootDir>/tests/setup.ts"],
  clearMocks: true,
  ```

---

## Blockers

**None.** No deltas detected. Every claim in the prior audit translates cleanly to the new flat layout. The pre-locked stage 2 decisions all remain valid against on-disk state:

1. ✅ Replace `anthropic-news` with `import-ai` — both rows present and ready.
2. ✅ Defer 10 broken HEAD-sweep feeds — `0014_*.sql` rows untouched since prior audit; deferred-but-ignorable.
3. ✅ Defer rejection-rate columns — schema unchanged, no precomputed columns to revisit.
4. ✅ Defer CNBC mislabel + 35-vs-32 source count — registry unchanged.
5. ✅ Add `content_hash` via fresh `0016_*.sql` — schema confirmed missing the column.
6. ✅ Gitignore `tmp/` at repo root — current root `.gitignore` still doesn't ignore `tmp/`; clean to add.
7. ✅ User-Agent strategy via `ingestion_sources.config` — `config` jsonb column present, ready for per-source override.
8. ✅ URL canonicalization tracking-param strip list — no canonicalization helpers exist in the repo (verified independently in prior audit's Part F); stage 2 lands the helper from scratch.

Stage 2 prompt-writing can proceed directly. The only path translation needed is the trivial `OneDrive/Desktop/signal-app/<x>` → `<x>` substitution everywhere; no logical claim from the prior audit changes.

### Path-translation cheatsheet (for the stage 2 prompt author)

Every prior-audit reference of the form `OneDrive/Desktop/signal-app/<path>` becomes `<path>` exactly. The most-cited paths:

| prior audit cited | post-restructure |
|---|---|
| `OneDrive/Desktop/signal-app/backend/src/jobs/ingestion/adapters/rss.ts` | `backend/src/jobs/ingestion/adapters/rss.ts` |
| `OneDrive/Desktop/signal-app/backend/src/jobs/ingestion/adapters/index.ts` | `backend/src/jobs/ingestion/adapters/index.ts` |
| `OneDrive/Desktop/signal-app/backend/src/jobs/ingestion/sourcePollJob.ts` | `backend/src/jobs/ingestion/sourcePollJob.ts` |
| `OneDrive/Desktop/signal-app/backend/src/jobs/ingestion/sourcePollWorker.ts` | `backend/src/jobs/ingestion/sourcePollWorker.ts` |
| `OneDrive/Desktop/signal-app/backend/src/jobs/ingestion/types.ts` | `backend/src/jobs/ingestion/types.ts` |
| `OneDrive/Desktop/signal-app/backend/src/db/schema.ts` | `backend/src/db/schema.ts` |
| `OneDrive/Desktop/signal-app/backend/src/db/migrations/0014_phase12e1_ingestion_sources.sql` | `backend/src/db/migrations/0014_phase12e1_ingestion_sources.sql` |
| `OneDrive/Desktop/signal-app/backend/src/db/migrations/0015_phase12e1_events_and_candidates.sql` | `backend/src/db/migrations/0015_phase12e1_events_and_candidates.sql` |
| `OneDrive/Desktop/signal-app/backend/src/scripts/runAggregation.ts` | `backend/src/scripts/runAggregation.ts` |
| `OneDrive/Desktop/signal-app/backend/src/scripts/auditStoryUrls.ts` | `backend/src/scripts/auditStoryUrls.ts` |
| `OneDrive/Desktop/signal-app/backend/package.json` | `backend/package.json` |
| `OneDrive/Desktop/signal-app/backend/jest.config.js` | `backend/jest.config.js` |
| `OneDrive/Desktop/signal-app/backend/tests/setup.ts` | `backend/tests/setup.ts` |
| `OneDrive/Desktop/signal-app/backend/tests/helpers/mockDb.ts` | `backend/tests/helpers/mockDb.ts` |
| `OneDrive/Desktop/signal-app/backend/tests/aggregationQueue.test.ts` | `backend/tests/aggregationQueue.test.ts` |
| `OneDrive/Desktop/signal-app/backend/src/lib/sentry.ts` | `backend/src/lib/sentry.ts` |
| `OneDrive/Desktop/signal-app/backend/src/utils/depthVariants.ts` | `backend/src/utils/depthVariants.ts` |
| `OneDrive/Desktop/signal-app/CLAUDE.md` | `CLAUDE.md` |

The prior audit's `tmp/discovery/*` raw-XML appendix also moves implicitly: those files lived under the working tree root (i.e. `OneDrive/Desktop/signal-app/tmp/discovery/`) at audit time. They were uncommitted and tied to the audit session; stage 2 will need to re-fetch (or recover from the prior session's local filesystem). Pre-locked decision #6 ("gitignore `tmp/` at repo root") is the right call regardless.

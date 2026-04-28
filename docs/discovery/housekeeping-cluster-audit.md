# Housekeeping Cluster — Stage 1 discovery audit

**Date:** 2026-04-28
**HEAD at start:** `bd1bacd feat(ingestion): Phase 12e.5b — tier-generation seam and prompts (#56)` on `discovery/housekeeping-cluster` (worktree spawned from `origin/main`)
**Scope:** read-only audit for the three housekeeping items: (1) CLAUDE.md note on shell-env shadow of `ANTHROPIC_API_KEY`; (2) CLAUDE.md note clarifying title-numbers vs GitHub-issue-numbers; (3) three GitHub follow-up issues from the 12e.5b smoke. No CLAUDE.md edits, no `gh issue create`, no Stage-2 wording or label decisions.

---

## 1. CLAUDE.md structure inventory

**Document totals:** 819 lines, 7,009 words. 18 top-level (`## `) sections.

Verbatim section list, in document order, with line ranges and one-sentence descriptions:

| § | line | heading (verbatim) | length | content |
|---|---|---|---|---|
| 1 | 9 | `## 1. PRODUCT` | 31 lines | Product framing — three sectors (AI/Finance/Semis), pricing tiers, what's NOT in scope (learning paths, other sectors, UGC). |
| 2 | 40 | `## 2. TECH STACK (AUTHORITATIVE)` | 40 lines | Frontend / Backend / Ops stack pins; "deviation requires durable record." |
| 3 | 80 | `## 3. MONOREPO LAYOUT` | 146 lines | Tree of `signal-app/` directories — frontend, backend, db migrations, docs. The longest section. |
| 4 | 226 | `## 4. BACKEND ARCHITECTURE` | 37 lines | Boot sequence (`server.ts`), middleware stack order, error envelope shape. |
| 5 | 263 | `## 5. ROUTES` | 32 lines | v1 (JWT) and v2 (API-key) router inventory; key-prefix rule (`sgnl_live_`). |
| 6 | 295 | `## 6. DATA LAYER` | 114 lines | Schema source-of-truth pointer, current/dormant tables, hand-written migrations, `schema_migrations` table, failure modes, authoring rules, manual-prod-SQL discipline, deprecation, hash artifacts, invariants. |
| 7 | 409 | `## 7. JOBS & SCHEDULERS` | 21 lines | BullMQ queues + node-cron in-process scheduler; manual ops triggers. |
| 8 | 430 | `## 8. DEPTH-VARIANT COMMENTARY (Phase 12a)` | 90 lines | Depth-variant shape, parser, regeneration runbook, 12c per-user commentary path. |
| 9 | 520 | `## 9. PAYWALL & CONSUMPTION` | 16 lines | Designed-not-shipped paywall policy. |
| 10 | 536 | `## 10. FRONTEND ARCHITECTURE` | 21 lines | Next.js App Router conventions, state-split (TanStack vs Zustand vs RHF), API client. |
| 11 | 557 | `## 11. CODING STANDARDS` | 37 lines | TypeScript strict, backend rules, security, file naming. |
| 12 | 594 | `## 12. ENVIRONMENT VARIABLES` | 37 lines | `backend/.env.example` and `frontend/.env.local` listings; `runStartupEnvCheck()` source-of-truth pointer. |
| 13 | 631 | `## 13. TESTING` | 27 lines | Pre-commit gates, jest+supertest pattern, mock-DB pattern, frontend test posture. |
| 14 | 658 | `## 14. GIT & COMMITS` | 34 lines | Branch naming, commit shape, workspace topology, worktree hygiene. |
| 15 | 692 | `## 15. PHASE STATUS` | 60 lines | Numbering convention paragraph, shipped phases table, current 12-series roadmap, post-launch (Phases 13–14), deferred infra. |
| 16 | 752 | `## 16. COMMON TASKS` | 41 lines | Recipes — add v1/v2 endpoint, add table, add background job, add page. |
| 17 | 793 | `## 17. RULES FOR CLAUDE CODE` | 15 lines | 10-point numbered imperative rules list. |
| 18 | 808 | `## 18. SUCCESS CRITERIA` | 12 lines | Phase/feature done-checklist. |

---

## 2. Item 1 — Shell-env shadow on `ANTHROPIC_API_KEY`

### Search results in CLAUDE.md

`ANTHROPIC_API_KEY` (verbatim, 2 hits):
- **L476** (in §8 DEPTH-VARIANT COMMENTARY, "Regeneration runbook" subsection): `Requires \`ANTHROPIC_API_KEY\`. Per-story failures (rate limits, schema mismatches) are collected and reported at the end without aborting — re-run with \`--id=<uuid>\` for retries.`
- **L612** (in §12 ENVIRONMENT VARIABLES, inside the `backend/.env.example` code block): `ANTHROPIC_API_KEY=`

Case-insensitive search for `dotenv|shadow|shell env|env var|credential|secret` (5 hits, none addressing the operational shadowing trap):
- **L230** (in §4): `1. \`dotenv/config\`` — appears in the boot-sequence list.
- **L289** (in §5): `API keys have the prefix **\`sgnl_live_\`** (not \`sk_live_\` — that prefix triggers GitHub secret-scanner false positives). Keys are HMAC-SHA256'd at rest (not bcrypt — bcrypt is for user passwords, HMAC for server-verifiable tokens).`
- **L603, L605** (in §12): `JWT_SECRET=<generate: openssl rand -hex 32>` / `UNSUBSCRIBE_SECRET=<generate: openssl rand -hex 32>`
- **L627** (in §12, prose paragraph after the example): `\`runStartupEnvCheck()\` in \`backend/src/lib/envCheck.ts\` is the source of truth for which vars are required vs optional. Update it when you add a new required env var, and update the example file in the same commit.`

### Coverage state: **none**

Neither `dotenv`'s default no-override behavior, nor the empty-string-shadows-real-value trap, nor the `unset` workaround, nor the `dotenv override:true` workaround appears anywhere in CLAUDE.md. The only current `ANTHROPIC_API_KEY` mentions are the 12a runbook prerequisite line (L476) and the env-example placeholder (L612). The §12 prose (L627) covers "what should be in `.env`" but not "how to handle a shell-env that already has the var set to empty."

### Proposed section to extend / insert into

`## 12. ENVIRONMENT VARIABLES` (line 594).

Rationale (section selection only — wording is Stage 2): the trap is specifically about how `dotenv.config()` interacts with already-set process-env vars. §12 is the canonical home for env-loading semantics; L627's `runStartupEnvCheck()` source-of-truth pointer is the closest existing prose neighbor. Two alternative homes were considered but rejected:
- **§17 RULES FOR CLAUDE CODE** (L793): the rules list is terse imperatives ("Tests ship with features"); this is more of an operational gotcha with a multi-line explanation. Doesn't fit the cadence.
- **§14 GIT & COMMITS / Worktree hygiene** (L658): too narrow — the trap fires in any session that runs `npm run` against `.env`, not just worktree-spawn sessions.

### Stylistic neighbors

Two existing notes match the shape this new note should take (length, tone, format) — both are "trap explanation" prose blocks of 1–3 sentences, embedded in topical sections, framed around an incident or recurring failure mode:

1. **L289 (§5)** — `sgnl_live_` vs `sk_live_` key-prefix note. Shape: "X exists (not Y — Y triggers Z). Reason: ...". Single paragraph, ~2 sentences. Establishes the trap, then the rationale.
2. **L213–217 (§6 Migrations)** — the path-trap paragraph: *"migrations live at \`backend/src/db/migrations/\`, **not** \`backend/drizzle/\`. The drizzle-kit convention default is \`backend/drizzle/\` and AI-assistant prompts have repeatedly defaulted to the wrong path; the homegrown runner reads from \`src/db/migrations/\` exclusively."* Shape: "X is the right path, not Y. Reason: AI-assistant default is Y. Cite where the rule is enforced." Same trap-explanation cadence with an explicit "we've seen this fail before" framing.

---

## 3. Item 2 — Title-numbers vs GitHub-issue-numbers

### Search results in CLAUDE.md

Case-insensitive search for `issue number|GH #|roadmap|phase number|title-number|GitHub issue|gh pr|issue #|#\d+` (8 hits — most are roadmap/phase-status references, not numbering-convention discussion):
- **L42** (in §2): `Deviation requires an explicit decision recorded somewhere durable (commit message, ROADMAP, a follow-up issue).`
- **L219** (in §3 MONOREPO LAYOUT, in the docs/ tree comment): `│   ├── ROADMAP.md                         # in-flight / deferred / abandoned`
- **L378** (in §6 DATA LAYER, manual prod SQL): `Document the action somewhere recoverable — commit message, GitHub issue, or session note — so a future reader can reconstruct what happened and when.`
- **L694** (in §15, `## 15. PHASE STATUS`'s "Numbering convention" paragraph — the existing partial coverage):
  > **Numbering convention.** "Phase 12e.1" is a **roadmap title-number** — a sub-session slug inside the 12e ingestion-pipeline cluster. It has nothing to do with GitHub issue or PR numbers (`#35`, `#41`, `#42`). Title-numbers identify scope; GH numbers identify artifacts. A single sub-session usually closes one PR, but the numbers do not align — `#41` was the tier-rename PR (no roadmap title-number); `Phase 12e.1` will close one or more PRs whose `#` is decided by GitHub at PR-create time. When in doubt: title-number is what the planning chat calls a session; GH number is what `gh pr view` returns.
- **L720** (in §15): `### Current roadmap — Phase 12 series (through launch)` — section header.
- **L739** (in §15): `\`docs/ROADMAP.md\` is stale (last updated during Phase 11c kickoff) — refresh it in a dedicated cleanup pass; treat CLAUDE.md as authoritative for 12-series state today.`
- **L748** (in §15, "Deferred infra"): `Tracked in \`docs/ROADMAP.md\` — SendGrid domain auth, pg error handling, Railway Docker cache, \`GIT_COMMIT_SHA\` in \`/health\`. Do these in dedicated sessions.`
- **L804** (in §17 RULES, item #10): `**Don't resurrect dead scope.** Learning paths (Phase 10) are gone. The sector-variant commentary shape (pre-12a) is gone. If something in the code looks half-built and unused, verify against \`docs/ROADMAP.md\` before wiring it back up.`

### Coverage state: **partial** — verbatim L694

The "Numbering convention" paragraph at L694 already covers the *concept* (title-numbers ≠ GH numbers, examples cited, when-in-doubt rule). What it does NOT cover: the operational mistake the planner is queuing this against — the wrong-issue closure incident two phases ago, where a session-internal title-number was treated as a GitHub-issue reference and closed the wrong issue. The existing paragraph defines the distinction; the queued note adds an "if you're about to act on a number, here's which one to confirm" guard.

### Proposed section to extend / insert into

`## 15. PHASE STATUS` (line 692), specifically extending the existing "Numbering convention" paragraph at L694, OR adding an adjacent paragraph immediately after it.

Rationale: same section, adjacent prose. The existing paragraph is the doc's canonical numbering-convention location; the new note is operational guard-rails on the same topic. Splitting into two locations would fragment the topic.

### Stylistic neighbors

1. **L694 (§15) itself** — the existing "Numbering convention" paragraph. Shape: "**Title.** Definition. Example. When-in-doubt rule." The new addition should match this register (short bolded lead-in, 2–4 sentences, concrete example) so the two read as a continuous spec rather than as a graft.
2. **L213–217 (§6 Migrations path trap)** — for the "we've-seen-this-fail" framing and the way it cites the recurrence pattern explicitly, even though the topic is different.

---

## 4. Item 3 — Smoke follow-up confirmations

All three handoff descriptions confirmed against `docs/discovery/phase-12e5b-smoke.md` verbatim. **No conflicts to flag** between handoff and smoke doc.

### 3a. Technical-tier date hallucination — Candidate 1, EU/Google

Smoke-doc passages, verbatim:

**L150** (Candidate 1, Technical thesis verbatim):
> **Thesis:** EU DMA enforcement targets Gemini's exclusive system-level access on Android—demanding API exposure, local model hardware parity, and free third-party integration by July 2024, with 10% revenue penalties as enforcement backstop.

**L154** (Candidate 1 Observation):
> **Observation:** The technical thesis says "by July 2024" — clearly wrong. The article is from 2026 and the deadline is July 2026 (technical's support correctly says "the July 27 deadline"). Accessible and briefed both wrote "late July" without a year. **Single-candidate technical-tier date hallucination.** Flagged for §Anomalies — exactly the pattern the 100-call audit at 12e.8 should weight.

**L298** (Anomalies §3, consolidated):
> 3. **Technical-tier date hallucination on Candidate 1 (EU/Google).** Technical thesis writes "by July 2024" — the article is current and the deadline is July 2026. Accessible and briefed both say "late July" (no year, ambiguous-safe). Technical's *support* in the same row correctly says "the July 27 deadline" (no year). **Single-cell hallucination, not a system pattern, n=1 in a 27-call sample.** This is the kind of pattern the 100-call audit at 12e.8 should catch and weight. Plumbing-wise the cell parsed and validated cleanly — this is a quality issue inside a structurally-valid output, exactly the surface 12e.8 is designed for.

Confirms handoff verbatim: technical-thesis=`by July 2024`, technical-support=`the July 27 deadline`, accessible+briefed=`late July` (no year). Candidate ID `7a5106ff-882f-4d73-87b1-ace74b9e245b`. ✓

### 3b. Technical-tier benchmark mix-up — Candidate 2, P&G

**L180** (Candidate 2, Technical thesis verbatim):
> **Thesis:** P&G's 2% volume inflection—first YoY growth in a year—coupled with 3% organic sales expansion signals demand stabilization despite consumer bifurcation, though $1B annual after-tax headwind at $100 WTI Brent poses material FY2027 margin risk.

**L184** (Candidate 2 Observation):
> **Observation:** Technical writes "$100 WTI Brent" — minor confused naming since WTI and Brent are two distinct oil benchmarks. Accessible and briefed correctly say "Brent" alone. Worth flagging but not load-bearing on the thesis.

**L300** (Anomalies §4, consolidated):
> 4. **Technical-tier WTI/Brent confusion on Candidate 2 (P&G).** Technical thesis says "$100 WTI Brent" — those are two different benchmarks. Accessible and briefed correctly say "Brent" alone. Same n=1 minor accuracy slip class as #3. **Flagged for 12e.8.**

Confirms handoff verbatim. Candidate ID `ccccc041-1f82-4030-a1bf-3e2dc1b78528`. ✓

### 3c. Retry-path leading punctuation — Candidate 4, BP

**L240** (Candidate 4, Technical thesis verbatim):
> **Thesis:** .Q1 RCC profit of $3.2B beat $2.63B consensus by 22%, driven by Strait of Hormuz disruption-induced oil price spike, while net debt rose to $25.3B, constraining the stated $14–18B target for end-2026 against $13–13.5B 2026 capex and $9–10B divestment proceeds.

**L244** (Candidate 4 Observation):
> **Observation:** This candidate **exercised the parse-retry path live** on both briefed and technical (attempts=2 on each). The first attempt for each tier emitted JSON the parser couldn't validate; the retry with stricter prefill (`{"thesis":`) succeeded both times. That 9525ms briefed latency is total cumulative (timeout on attempt 1 + retry succeeded), and 11640ms technical similarly. **Resilience confirmed in production conditions.** The technical thesis starts with a stray leading `.` (likely a punctuation artifact from how the model began the retry response) — present in `tier_outputs`, not corrected. Cosmetically minor but worth flagging.

**L302** (Anomalies §5, consolidated):
> 5. **Stray leading `.` on Candidate 4 technical thesis.** The retry path on the BP article emitted `".Q1 RCC profit of $3.2B…"` — the stray leading dot survived the parse and landed in `tier_outputs`. Cosmetic, not blocking, but visible to a downstream reader. The retry path was exercised live on this candidate (attempts=2 on both briefed and technical), and the stricter prefill (`{"thesis":`) succeeded; the `.` likely originated from the model's first-attempt output bleeding into how it began the retry. **Not a correctness issue at the structural level** — the JSON validates, the content is grounded — but the planner may want to consider a post-parse `.trim()` of leading non-alphanumeric chars on the retry path. Or just let the 12e.8 audit decide if it's worth the change.

Confirms handoff verbatim. Candidate ID `a6de6261-0758-4da3-9056-eee9bcfffad8`. ✓

**Minor framing note (not a conflict):** the handoff said "stray leading period from continuation off strict-prefill `{"thesis":` on retry" — the smoke doc's framing is "likely originated from the model's first-attempt output bleeding into how it began the retry." Both diagnoses point at the same artifact (retry path produced the leading `.`); the handoff and the smoke doc converge on cause, just word it slightly differently. **Not a conflict, no flag.**

---

## 5. GitHub repo state

### Labels (`gh label list`, verbatim)

```
bug              Something isn't working                              #d73a4a
documentation    Improvements or additions to documentation            #0075ca
duplicate        This issue or pull request already exists             #cfd3d7
enhancement      New feature or request                                #a2eeef
good first issue Good for newcomers                                    #7057ff
help wanted      Extra attention is needed                             #008672
invalid          This doesn't seem right                               #e4e669
question         Further information is requested                      #d876e3
wontfix          This will not be worked on                            #ffffff
chore            Maintenance / dev-experience work                     #ededed
dev-experience   Developer ergonomics / tooling                        #c5def5
ingestion        Phase 12e ingestion pipeline                          #fbca04
quality          Quality / observability follow-ups                    #5319e7
```

13 labels total: 9 GitHub-default + 4 custom (`chore`, `dev-experience`, `ingestion`, `quality`).

### Fit assessment for the categories the brief named

| target category | best existing label(s) | match strength |
|---|---|---|
| prompt quality | `quality` ("Quality / observability follow-ups") | partial fit — `quality` is broader (covers observability too); no dedicated `prompt-quality` label exists |
| smoke followup | none | no fit — no `smoke` or `followup` label; closest is `quality` for what the followups *are*, or `ingestion` for what they *touch* |
| phase 12e | `ingestion` ("Phase 12e ingestion pipeline") | exact match — the label description literally names Phase 12e |
| ingestion | `ingestion` | exact match |
| bug-cosmetic | `bug` | partial fit — `bug` is generic; the leading-`.` artifact is more cosmetic than functional bug; no `cosmetic` qualifier exists |

### Milestones (`gh api repos/:owner/:repo/milestones`)

Empty array `[]` — **no milestones exist in this repo.** Not a problem unless the planner intends to create one in Stage 2; just a state observation.

### Issue numbering — highest, last 5, gaps

- **Highest issue number (any state):** `54`.
- **Last 5 issue numbers (most recent first):** `54, 53, 51, 49, 48`.
- **Visible gaps in last 30:** numbers 50, 52, 46, 45, 44, 43, 42, 41, 40, 38, 37, 33, 32, 22 are absent from the last-30 issue list. CLAUDE.md L694 explicitly notes that `#41` was a PR (no issue at that number); `#52` shows up in the last-3 merged-PRs list (Phase 12e.4) — also a PR, not an issue. The numbering is shared between PRs and issues (standard GitHub behavior), so most/all of the visible gaps are PRs occupying numeric slots in the same sequence. **Not anomalous.**
- The next created issue would be `#55` *unless* one of the numbers between 55–58 is taken by an interim PR. (The last-3 merged-PRs list shows PR `#56` was 12e.5b's merge, so the next issue would land at `#57` or higher.) **Practical: planner should not assume a specific next number — let GitHub assign it.**

### Conventional Commits adherence (last 3 merged PRs)

| # | title | adheres |
|---|---|---|
| 56 | `feat(ingestion): Phase 12e.5b — tier-generation seam and prompts` | ✓ |
| 55 | `feat(ingestion): Phase 12e.5a — fact extraction worker` | ✓ |
| 52 | `feat(ingestion): Phase 12e.4 — LLM relevance gate` | ✓ |

All three follow `type(scope): subject` with scope `ingestion`. Sanity-check passes.

---

## 6. Open questions / flags for planner

### Critical flag

- **Issue `#53` already exists for the dotenv shadow problem.** Verbatim title from `gh issue list`:
  > `chore(ingestion): use dotenv override:true in CLI scripts to avoid empty-env-var shadowing`
  Labels: `chore`, `dev-experience`, `ingestion`. Created 2026-04-28.
  This is the *code-fix* tracking issue for the same trap that Item 1 is queueing as a *CLAUDE.md note*. The two are not mutually exclusive (doc-note describes the trap to humans; #53 fixes the trap in code with `dotenv.config({override: true})`). But the planner should decide:
    - whether the CLAUDE.md note is still needed once #53 ships (probably yes — docs survive code changes; note can cross-reference #53),
    - whether #53's body should be expanded with the smoke-incident learnings, or
    - whether to close #53 as superseded by the doc-only path and accept the trap can recur until someone hits it.
  **This is the single most important thing to resolve before Stage 2.**

### Other notes

- **`docs/decisions/discovery-session-2-accessible-tier.md` does not exist.** The brief listed it as a style reference for skim-reading. The directory `docs/decisions/` itself does not exist at HEAD `bd1bacd`. Not a blocker — `phase-12e5a-smoke-test.md` and the existing audit docs serve as adequate style references — but flagging since the brief assumed the file existed.
- **No `docs/ROADMAP.md` refresh has happened** despite L739 calling it stale since Phase 11c kickoff. If Stage 2's Item 2 (title-numbers) is going to cite ROADMAP, planner may want to either refresh ROADMAP first or scope the CLAUDE.md addition to not depend on ROADMAP being current.
- **Section 12 (`ENVIRONMENT VARIABLES`) is small (37 lines) but topically correct for Item 1.** Adding the shadow-trap note will probably push it to ~45 lines — within the section-size norm (most other sections are 30–60 lines, except the outliers at §3 monorepo (146) and §6 data layer (114)).
- **Section 15 already has the partial-coverage paragraph for Item 2 at L694.** Stage 2 will need to decide between extending that paragraph in-place vs. adding an adjacent paragraph; both fit the section's existing prose cadence. No structural decision needed at audit time.
- **Two existing labels (`ingestion`, `quality`) cover the three smoke followups cleanly.** No new labels required for Stage 2 if those two are deemed sufficient. The planner may want to consider whether a `cosmetic` qualifier (or the existing `bug` with a `cosmetic` indicator in the title) is worth introducing for the leading-`.` issue specifically — that's a Stage 2 decision; flagging only that the existing label set does not include it.
- **Worktree leftover state from prior sessions** (carried over from the merge-cleanup observation, restated): `git worktree list` from canonical shows two detached worktrees from older sessions (`epic-banach-de0c78` at `ee6e8d4`, `lucid-williams-b3a2c7` at `e97bc35`), both on merged branches. Not in scope for Stage 1 audit, not a blocker, but the planner may want to schedule a worktree-cleanup pass at some point.

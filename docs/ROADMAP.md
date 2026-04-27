# SIGNAL Roadmap

**Purpose:** single source of truth for in-flight work, committed next steps, and deferred ideas. Replaces ad-hoc tracking in chat history and closeout docs.

**Last updated:** Session handoff during Phase 11c kickoff, April 19-20, 2026.

**How to use this doc:**
- Update at the end of each Claude Code session as part of session closeout.
- Reference at the start of each session to restore context in ~30 seconds.
- Move items up/down the hierarchy as priorities shift. Don't silently delete items — if something is no longer going to happen, move it to "Abandoned" with a one-line reason.

---

## 🔨 In progress

**Phase 11c — `/api/v2/stories` endpoint (first mounted v2 route)**
Branch: `claude/phase-11c-v2-stories`. Ships the first user-facing external API surface. Cursor-paginated stories endpoint with sector/date filters and optional writer filter. Wires `apiKeyAuth` + `apiKeyRateLimit` to a real router for the first time. Moderate 6-field response shape. 15-18 new tests.

---

## ⏭️ Next up (committed, queued)

Ordered by dependency. Each item is a real session.

**Phase 11c.5 — Aggregation layer**
New `story_aggregates` table. BullMQ background job that populates the table from recent stories (hourly or daily). Decides what "trend" means concretely (likely story count + save count per sector per week to start). Prerequisite for 11d — trend/summary endpoints are trivial reads once this exists.

**Phase 11d — `/api/v2/trends` and `/api/v2/sectors/:sector/summary` endpoints**
Reads pre-computed values from the aggregate table. Small session because the hard work was done in 11c.5. Wires into the existing v2 router alongside `/api/v2/stories`. Adds the "intelligence API" portfolio narrative.

**Phase 11e — Developer dashboard frontend**
Frontend UI at `/app/developer` (or similar) for API key management: create, list, revoke, see usage stats. Builds the **usage-reading service** we deferred from 11b (`getCurrentMinuteUsage`, `getRecentMinuteUsage`, or whatever shape the dashboard actually needs — decide in 11e, not pre-emptively). First user-facing surface for the API product inside SIGNAL itself.

**Phase 11f — Public API docs page**
`/api-docs` page with authentication section, endpoint reference, curl examples (must use `X-API-Key` header — the non-standard header will confuse developers without docs), rate limit documentation, error codes. Consider Redoc or similar for interactive rendering, but static markdown also fine for MVP.

---

## 🗓️ Later (deferred — will ship, not yet scheduled)

Committed work with no specific session slot. Reorder as priorities shift.

### Phase 11 extensions (after the 11e/f launch polish)
- **`tag=` filter** for `/api/v2/stories`. Requires: a tags system. `tags` table, `story_tags` join, tag backfill or classifier for existing stories. Own phase (probably Phase 11g).
- **`search=` filter** for `/api/v2/stories`. Requires: Postgres full-text search. `tsvector` column on stories with generated index, tokenization/stemming decisions. Own phase (probably Phase 11h).
- **Additional response fields** — `saves_count`, `comments_count`, `writer_name`. Pure additions, non-breaking. Ship when a real customer asks.
- **Team-owned API keys.** Currently user-owned only. Would need `team_id` column (nullable, one-of-user-or-team constraint) and team-scoped auth check in middleware. Phase 11 or later.
- **API key tiers / per-endpoint rate limits / monthly quotas.** Current implementation is single flat tier. Upgrade when pricing structure is real.

### Infrastructure / ops hygiene (from Phase 9 closeout)
- **P3 #9 — SendGrid domain authentication** to replace single-sender gmail. Blocks on purchasing a domain (signal.so taken — alternatives: readsignal.com, trysignal.io, signal.news). ~30 min once domain purchased. Required before any real-user launch or paid-tier announcement.
- **P3 #10 — pg connection error handling.** Shipped in Session 5, verify the branch is actually hit in prod (may require an intentional Redis/DB blip smoke test).
- **P3 #12 — File Railway Postgres query tab rendering bug report** with Railway support. Your task (10 min, not a session). `SELECT ... ORDER BY DESC LIMIT N` returns zero rows despite rows existing; filtered queries work.
- **P3 #13 — Investigate Railway Docker build cache** serving stale code on non-Dockerfile changes. Skip unless it becomes a blocker again; empty-commit workaround has proven reliable.
- **P3 #18 — Flatten `OneDrive/Desktop/signal-app/` path prefix.** ✅ Shipped 2026-04-27 — mass `git mv` + CI/Vercel/Railway root-directory updates. Tracked code now lives at the repo root. (Audit: `docs/discovery/restructure-stage1-findings.md`.)
- **P3 #19 — Wire `GIT_COMMIT_SHA` + `BUILD_TIME` through Railway build args** so `/health` shows real commit SHA instead of `"unknown"`. 10 min in Railway Variables UI, not a code change.

### Product direction (strategic, not tactical)
- **Phase 10 — Learning product (deferred pending product design).** Original plan was a thin "checkbox tracker" feature; revised scope is an Invo/LinkedIn Learning-caliber platform. Requires real product design work (competitive analysis, user research, design artifacts) before any implementation. Pick up after Phase 11 ships and ideally after APM applications are submitted so portfolio narrative doesn't pressure shortcuts.
- **Credentials / badge system.** Originally bundled with Phase 10. Separate product decision. Defer until Phase 10 is properly scoped.
- **Public profile pages (`/u/[id]`).** Bundled with Phase 10 originally. Requires new auth pattern (unauthenticated read access). Consider as part of Phase 10 redesign.

---

## 💭 Parking lot (ideas, not yet decided)

Things we've discussed but haven't committed to. Requires further product/design thinking before committing.

- **`why_it_matters_text` in API responses.** Strategic concern: leaking SIGNAL's personalization differentiator to downstream consumers without a personalization context. Would require designing how role personalization works for API consumers with multiple end-users (API key owner != story reader). Revisit only with a concrete product decision about how API personalization works.
- **API key scopes / permissions.** Currently every key can do everything. Scope system would let users create read-only keys, scoped-to-sector keys, etc. Useful once there's a real customer asking for it. Don't pre-build.
- **Webhooks for real-time story notifications.** Mentioned in original Phase 11 spec but cut. Interesting if there's a customer using SIGNAL as an alerting source (e.g. "notify me when AI story with keyword X appears"). Requires webhook delivery infra, retry logic, signing. Real work. Defer.
- **GraphQL layer** alongside REST v2. Mentioned occasionally. Not needed yet — REST is what B2B customers expect from a first API. Revisit if a customer asks.
- **API key rotation flow** (one-click generate new key + gracefully deprecate old one). Current API supports this via two keys in parallel but no dedicated UI. Ship when a customer hits the need.
- **Monthly rollup summaries** for sectors (e.g. "AI — April 2026 in review"). Could be content (writers produce them) or generated (aggregation over stories). Product decision first.

---

## 🪦 Abandoned

Things previously planned that will not ship. Kept here so future-you doesn't accidentally try to build them.

- **Original Phase 10 spec (checkbox-style learning path tracker).** Replaced by "real learning product" scope pending design work. Do not revive without revisiting the design conversation.
- **`sk_live_` key prefix.** Abandoned after GitHub Push Protection blocked due to Stripe secret-scanner false positive. Replaced with `sgnl_live_`. Don't reintroduce.
- **Admin-only API key provisioning model from original Phase 11 spec.** Self-service key creation via `/api/v1/me/api-keys` shipped instead. Don't resurrect the "admin creates keys for each customer" workflow — it's not an API product, it's consulting with API dress-up.
- **`accepted_at` column on `team_invites`.** Referenced in old CLAUDE.md but never implemented. Replaced by `used_at` + `revoked_at` (per "timestamp per state" principle from Phase 9). Schema docs updated in Session 5.
- **Bcrypt hashing for API keys.** Discussed briefly, replaced with HMAC-SHA256 before implementation. Don't migrate back — bcrypt buys nothing for 256-bit random inputs and costs ~100ms per auth.

---

## 📐 Planning heuristics (for future-you and any new Claude Code sessions)

Hard-won principles from this project. Internalize before scoping new phases.

- **One session = one tight slice.** Phase 9 proved that coherent-but-bounded sessions ship cleanly; Phase 11's 3-endpoint original spec would have shipped with quality compromises. If it won't fit in 60-120 minutes of Claude Code time with real tests, split it.
- **Ship less, ship better, add things when real users ask.** Generous feature speccing = maintenance surface. Every filter, every response field, every endpoint is a forever-commitment. Build what's defensibly needed, defer the rest explicitly.
- **Timestamp-per-state beats polymorphic boolean.** `used_at` + `revoked_at` > `status` enum + `status_changed_at`. Multiple nullable timestamps enable accurate audit without lossy migrations.
- **Fail-open for throttling, fail-closed for auth.** Rate limiting is not safety-critical; availability > strict enforcement. Auth is safety-critical; if auth is broken, reject the request.
- **Don't leak your differentiator.** SIGNAL's "why it matters to you" text is the product. An API without personalization context has no good way to surface it. Keep it inside the app until the personalization-for-API design is real.
- **GitHub secret scanners pattern-match on prefixes.** `sk_live_` means Stripe. Use vendor-specific prefixes (`sgnl_live_`) to avoid false positives on committed test fixtures.
- **Docker caches lie.** Railway's "Active + green checkmark" doesn't mean your code is running. `/health` endpoint returning commit SHA is load-bearing for diagnosis. Terse migration output ("done in 208ms" without naming migration files) is normal, verify via direct DB probe.
- **Path prefixes in tracked files compound.** The `OneDrive/Desktop/signal-app/` legacy prefix caused real friction every session for ~9 months before being flattened in #18 (2026-04-27). Lesson: address structural debt before it gets worse, or accept the cost explicitly.

---

## 🧭 Big-picture milestones

- **Meta RPM application: August 2026.** Phase 11 completion (11c through 11f) is the portfolio centerpiece for this application cycle. Target: all of Phase 11 shipped and running with real demo data by end of June 2026 to leave time for write-ups, practice pitches, and case prep.
- **Google APM application: late September 2026.** Phase 11 + 10 (the real one) both ideally shipped by this point. Stronger portfolio = more loop variety during interviews.
- **Before any real-user launch:** P3 #9 (domain + SendGrid auth), P3 #18 (flatten path prefix — optional but makes the repo presentable), P3 #19 (commit SHA in /health). These are the "could a real customer start using this today" gates.

---

*End of roadmap. When a section is stale, edit it. When a phase ships, move it from "In progress" to the completed log in `docs/PHASE_*_CLOSEOUT.md` files.*

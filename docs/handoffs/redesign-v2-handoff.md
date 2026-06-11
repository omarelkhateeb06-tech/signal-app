# SIGNAL — Redesign v2 Handoff

> Paste this into a fresh Claude Code chat **after** you drop in the screenshots of the new design concepts. It carries everything: what SIGNAL is, the moat, the board's verdict, everything done this session, current production state, and what to build next. You can then continue as if the conversation never broke.

---

## 0. How to read this

I'm handing you (a fresh Claude Code session) the full context of an in-flight design evolution. The first thing in this chat is a set of **screenshots of new feed-design concepts** produced by an external design tool. Your job is to (1) evaluate them against the moat and the board's direction below, (2) help pick/synthesize a direction, then (3) implement it in the real Next.js codebase. **Do not start writing code until we've agreed on a direction from the screenshots.** Read `C:\dev\signal-app\CLAUDE.md` first — it is the authoritative spec for the repo and overrides everything except a direct instruction from me (Omar).

---

## 1. What SIGNAL is

A daily intelligence briefing for professionals in **AI, Finance, and Semiconductors** (three sectors, hard-scoped). It pulls everything a practitioner would otherwise chase across Bloomberg, Substack, arXiv, Hacker News, SEC filings, and company newsrooms into **one ranked feed** — and, critically, **explains why each item matters to that specific reader** (their role, sector, seniority), at three depth tiers: **Accessible / Briefed / Technical**.

Stack: Next.js 14 (App Router) + React 18 frontend on Vercel; Express 4 + Drizzle/Postgres + Redis/BullMQ backend on Railway; Anthropic Haiku for commentary + native editorial. Repo: `C:\dev\signal-app`, single canonical clone, branch `main`. (Product is mid-rebrand to "Valo" conversationally, but the **codebase stays SIGNAL** until an explicit rename pass — keep using SIGNAL in code.)

---

## 2. The moat (the actual problem we're solving)

The original problem — restated from a moat-rediscovery critique I brought back this session:

A practitioner gets their professional intelligence from **7+ disconnected surfaces** (IG/TikTok explainers, X takes, Bloomberg/CNBC news, Substack editorial, Reddit/HN threads, arXiv/lab blogs, LinkedIn signals, company newsrooms). None talk to each other. Staying current is a second job.

The solution is **not** "put it all in one place" — that's table-stakes aggregation (Google News, Flipboard already do it). The moat is the **second layer**:

1. **Feed ranking** — what surfaces, in what order, for *you* (role/sectors/seniority).
2. **"Why this matters to you"** — a per-story explanation written for *your* specific context, surfaced as **the entry point for every item**. Different for a semiconductor packaging engineer vs. a quant vs. an AI researcher vs. a CS student.

**Two principles fall out of this and are the whole point of redesign v2:**
- **Lead with the explanation, not the headline.** The personalized "why it matters to you" is the hero text of every card; the source headline is secondary attribution ("— via Reuters / arXiv / SEC").
- **Format follows content type.** A 40-page arXiv paper is consumed differently than a 2-minute thread. Each content type gets its own card treatment and imagery. Uniform format flattens signal into sameness.

---

## 3. The board's verdict (8 advisors)

I ran the current production design + the moat critique past the advisory board. **Unanimous verdict: the engine is intact, but the surface deviated on the two things that *are* the moat.** Recoverable — it's a presentation-layer problem, not a foundation problem.

The two cardinal sins of the current (Swiss "Command Center") design:
1. **Uniform format** — every item (cross-sector chain, SEC filing reaction, research synthesis, community thread, news cluster) renders as the identical text row. This is the "boring / text after text after text." The Swiss two-panel made it *worse* than the prior magazine layout, because uniformity is its defining trait.
2. **The "why it matters to you" is buried** — behind a click and a Pro gate (right panel, on select). The one differentiator vs. Google News is hidden behind the entry point instead of *being* the entry point.

Board, condensed:
- **Contrarian:** "You buried your only differentiator behind a paywall and a click, then made every row look the same. That's an aggregator with great fonts."
- **First Principles:** "The job is 'why this matters to me, for everything.' Lead with the personalized take, not the headline."
- **Expansionist:** "Type-aware formatting is a platform unlock — it's how you'd eventually add tweets/video, each with native treatment."
- **Outsider:** "Omar's 'boring' is the cold-visitor reaction. Text-after-text = I bounce. Variety earns the scroll."
- **Executor:** "All buildable on current data — `source_type`, `generator_type`, `adapter`, multi-source count already exist. Caveat: personalized why-it-matters is Pro-gated, so free users get the generic hook."
- **Hormozi:** "The 'why it matters to you' is the $10. Hiding it behind a click means free users never see the value → no conversion. Make a teaser the visible hook."
- **Naval:** "World-class aggregation + a hidden explanation. Surface the explanation. A paper isn't a tweet — uniform format flattens signal."
- **Rubin:** "'Boring' is the honest verdict. The Swiss type system is a beautiful instrument playing one note. Vary the format to the content and it sings."

Two refinements I added (the critique was reasoning blind — it hadn't seen the new design):
- The Swiss is the *more* wrong of the two prior layouts on its own terms (uniformity is its trait). The fix is **not** "revert to the magazine" — it's the synthesis.
- The critique's content-type list (TikTok/X/LinkedIn/IG) is partly aspirational — **we don't ingest those.** Build for the types we actually have (see §6).

**Omar's own gut check that triggered this:** the platform, as nice as it is, is easy to get bored on — text after text after text. That instinct is correct and aligns with the board.

---

## 4. Everything done this session (chronological)

1. **Merged PR #143** — `feat(native): revive native-post engine — scheduler + /native 500 fix + Originals band`. Checked CI (Backend + Frontend green), squash-merged, confirmed `origin/main` at `426ad39` on top of `4bb9e9c` (#142, the Swiss Command Center feed).
2. **Verified the native fix on production** (project-nvrod.vercel.app, authed in Chrome):
   - `/native` now returns **200** (was 500 — the SQL fix holds); unauth curl correctly returns 401.
   - **SIGNAL Originals band is live** at the top of the feed with branded labels: `PRACTITIONER BRIEF · AI`, `PRACTITIONER BRIEF · FIN`, and `THE CONNECTION · FIN` (the cross-sector chain — the #1 differentiator — surfaced with its brand label).
   - The **auto-mark "N/M read" check-mark counter is removed**; ranked rows are clean single rows again.
   - Native cron is scheduled (daily 09:00 UTC); the 3 shown are the existing June-1 posts.
3. **Moat rediscovery** — I brought back the original problem statement + a critique (§2). Gave my read, then ran the **8-advisor board** (§3). Unanimous: engine intact, surface deviated, don't revert — evolve.
4. **Confirmed git state is fully pushed/merged/live** — `origin/main` = `426ad39`, clean tree. Production runs the full Swiss redesign + native engine + Through-Line + cleanups. Redesign v2 does **not** exist yet (no code).
5. **Wrote a design brief** for Omar's external design tool to generate redesign-v2 concepts (the brief is §7 below — the screenshots you're about to see are its output).
6. **Wrote this handoff.**

---

## 5. Current production state (what's live RIGHT NOW)

- Full **Swiss editorial redesign** (the "Command Center" two-panel feed, Fusion A — PR #142).
- **Native editorial engine** working: SIGNAL Originals band, `/native` 200, daily 09:00 UTC cron (`nativeGenerationScheduler`, `NATIVE_DAILY_CAP=25/day`, Haiku-authored, Redis-free).
- **Through-Line** (today's connecting thread) surface.
- Per-reader **depth-tiered commentary** (Accessible/Briefed/Technical) and per-user personalized "why it matters to you" (Phase 12c Haiku path, `commentary_cache`).
- **Paywall** (Phase 12g, 2-tier Free / Pro + 7-day pro_trial): free = 15 stories/day, accessible-depth only, 3 searches/day; **personalized commentary is Pro-gated**, free users get pre-generated `generic_commentary`.
- The check-mark/read-counter is **gone**.

`main` is clean and fully deployed. There is nothing unpushed.

---

## 6. The real content types (build for THESE — they exist in the data)

Format-follows-type must be built on what we actually ingest/generate. Fields available: `source_type`, `generator_type`, `adapter`, and a multi-source cluster count.

| Content type | Branded label | Treatment direction |
|---|---|---|
| Cross-sector causal chain (flagship — e.g. Fed → semi capex → AI cost) | **THE CONNECTION** | The hero: large, **illustrated**, causal chain visualized A → B → C |
| Research synthesis (what a set of arXiv papers means together) | **THE RESEARCH READ** | Scholarly/diagram motif, the synthesis leads |
| Community/practitioner synthesis (from HN) | **PRACTITIONER BRIEF** | Conversational, crowd/quote aesthetic |
| Earnings / SEC filing reaction | (data-led) | "The one number that mattered" — big stat as hero, terse |
| Multi-source news cluster (event covered by N outlets) | (editorial) | Source image + "covered by SemiAnalysis, Bloomberg +5" |
| Tool / repo spotlight | **WORTH AN AFTERNOON** | Mechanical/tooling motif, "why now" hook |

---

## 7. The design brief that produced the screenshots

(Given to Omar's external design tool alongside a screenshot of current prod. The concepts in this chat are its output.)

**Keep the visual identity** (it's good):
- **Type:** Playfair Display (serif headlines/masthead), Lora (serif body), DM Mono (uppercase metadata/labels/badges).
- **Palette:** warm cream `#FAF6F0` (light) / deep editorial dark; single terracotta accent `#8B4513`; sharp **0px** corners.
- Masthead: "DAILY INTELLIGENCE BRIEFING / SIGNAL", "PREPARED FOR: [name]", mono branded section labels.

**The problem to solve:** every item renders as the identical text row; the personalized "why it matters" is buried behind a click. Fix via the two principles in §2 (lead with the explanation; format follows type) + the card system in §6.

**Board-recommended elements to weave in:**
- Custom editorial **illustrations** for native types (THE CONNECTION especially) — the #1 monotony-killer.
- A small **SIGNAL credibility rating** on cards.
- **Multi-source proof** ("+N sources covered") + comment counts as social proof.
- A **free-tier teaser** of the personalized take with a subtle "Unlock the full read · Pro" (drives conversion — Hormozi's point).
- Optional "In Focus" topic chips + a "Latest" freshness cue.
- Keep the depth toggle + a saved-takeaways / Through-Line surface.

**Layout direction:** free to break from the rigid two-panel command center. Goal: a rich, varied, **scroll-worthy editorial feed** (Bloomberg/WSJ density and rhythm in SIGNAL's warm Swiss-editorial language) — big illustrated flagship, tight data cards, image-led news, quiet research reads — not a uniform list. Single-item reads can still open a focused detail view.

---

## 8. What I want you (the new session) to do

1. **Look at the screenshots** I'm pasting and evaluate each concept against: (a) does the **why-it-matters lead** every card? (b) does **format follow type** with real visual rhythm? (c) does it keep the Swiss identity (§7)? (d) does it surface the free-tier teaser → conversion? (e) is it buildable on our real data (§6)?
2. **Recommend a direction** (or a synthesis of concepts). Call out anything that's beautiful-but-unbuildable or that reintroduces uniformity.
3. Once we agree, **scope redesign-v2 as a concrete plan before touching code** — I want to start with the **card-type system + why-it-matters-as-hook**, *then* the vessel. Don't bundle a vessel rewrite with the card system in one commit.
4. Implement against the real codebase, honoring CLAUDE.md: TypeScript strict, tests ship with features, the three local gates (type-check/lint/test) before commit, small one-logical-change commits, branch `claude/<slug>` off `main`.

## 9. Constraints / traps to respect

- **CLAUDE.md is authoritative.** Read it. Migrations live in `backend/src/db/migrations/` (homegrown runner, not drizzle-kit). Don't resurrect dead scope (learning paths, sector-variant commentary shape).
- **Personalized commentary is Pro-gated.** Free users see `generic_commentary`, not the per-user take. The card's hero text must degrade gracefully: personalized for Pro, generic hook + "Unlock · Pro" teaser for free. Don't design a card that *requires* the personalized string to render.
- **Three sectors only** (`ai`, `finance`, `semiconductors`). We do **not** ingest TikTok/X/LinkedIn/IG — don't design card types for sources we don't have.
- **Depth tiers** (Accessible/Briefed/Technical) stay; keep the toggle.
- **Don't merge the stale `claude/swiss-command-feed` branch** if you see it — it's invalid/superseded.
- Verify visual work on a **real render** (preview tools / prod), not from description — Omar judges designs on renders, not prose.
- Omar's terminal is PowerShell; the CC tooling shell is bash. UMN campus Wi-Fi blocks port 5432.

---

*Generated at the end of the native-engine + moat-rediscovery session. Continue as if the conversation is unbroken.*

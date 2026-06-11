# CC Session: Pulse quad chart — impact × recency scatter view

## Ground rules
- Read-only audit first
- tsc clean both packages + all prior tests still green (baseline: backend 85 suites / 1267 passed / 0 failed, frontend 117 passed) **plus** your new tests, 0 failed, before reporting complete
- No commits — leave changes staged for review
- Shell is bash. Filter `*_TOKEN|*_KEY|*_SECRET` from any env inspection
- Do NOT execute prod SQL (there is no migration in this task anyway — see "No migration" below)

## What this is
A new **quad chart** ("The Pulse") — a 2×2 scatter view of the day's stories plotted on **impact (Y)** × **recency (X)**, so a reader can see at a glance what's both high-signal and fresh. Points are colored by sector and clickable through to the story detail page. This is a net-new visualization surface, not on the existing 12-series roadmap; it is tentatively labelled **Phase 12t**. If the roadmap slot is wrong, rename — nothing depends on the number.

### The four quadrants
| | Fresh (right) | Older (left) |
|---|---|---|
| **High impact (top)** | **Breaking** — act now | **Developing** — context still matters |
| **Low impact (bottom)** | **Emerging** — watch | **Fading** — nearly archived |

## Scope decisions (I made these because the questions were declined — veto any)
1. **Axes**: Y = `effective_score` (the 12f ranking score), X = `age_hours` since `published_at` (fall back to `created_at`). Fresher renders on the **right** (X reversed), so "Breaking" lands top-right where the eye goes first.
2. **Surface**: a new top-level authed page `/pulse` in the `(app)` route group, titled "The Pulse", with a sidebar entry — same pattern as the `/archive` page added in 12r.
3. **Data source**: a new **lean v1 endpoint** `GET /api/v1/stories/pulse`. Reusing the feed endpoint won't work — `shapeEvent` strips `effective_score` from the wire on purpose (see §Gotcha). The pulse endpoint re-exposes it.
4. **Gating**: auth + `requireProfile` only, no paywall. The pulse is an overview of headlines (like the feed list), not a detail view, so it burns no story-cap views and needs no `resolveEffectiveTier` call.
5. **Quadrant dividers**: computed **client-side at the median** of the returned set (median score, median age) so both axes always split into populated quadrants regardless of the day's distribution. Alternative (fixed thresholds: score ≥ 7, age ≤ 24h) is noted but not chosen — fixed lines leave quadrants empty on slow news days.

## Gotcha (read before touching the backend)
`effective_score` is computed in SQL by `eventEffectiveScoreExpr()` in `backend/src/controllers/storyController.ts` and used in the feed's `ORDER BY`, but `shapeEvent` **deliberately strips it from the wire** (see the `effectiveScore` comment on the `EventRow` interface). The pulse endpoint must SELECT it and emit it explicitly — do not try to read it off the feed response. The score is `numeric` in pg and can arrive as a string; coerce with `Number()` on the way out (the feed's in-memory sort already does this defensively). The score can also be **negative** (EDGAR sole-source penalty) — the chart's Y domain must allow negatives.

## Existing building blocks (audit these first)
- `backend/src/controllers/storyController.ts`
  - `eventEffectiveScoreExpr()` — the Y axis, exported.
  - `eventAgeHoursExpr()` — the X axis, already written (hours since `published_at` ?? `created_at`).
  - `eventHasEnabledSourceExpr()` — exclude events whose every source is disabled (the feed uses this; the pulse should too).
  - `getNativeStories` + the `/native` route registration (12r) — the **template** for a lean read endpoint registered before `/:id`.
- `backend/src/routes/stories.ts` — note the `/native` comment: literal segments register **before** `/:id` or Express treats them as a UUID.
- `frontend/src/lib/api.ts` — `getNativeStoriesRequest` is the wrapper pattern to copy.
- `frontend/src/types/story.ts` — `NativeArchiveItem` / `NativeArchiveResponse` are the lean-type pattern to copy.
- `frontend/src/components/teams/DashboardCharts.tsx` — existing **recharts** usage; copy its import + container conventions (recharts is already a dependency; do not add a new chart lib).
- `frontend/src/components/layout/Sidebar.tsx` — array-driven `NAV` with lucide icons; add the Pulse entry here.
- Sector palette: `var(--ai)`, `var(--finance)`, `var(--semis)` — the `SECTOR_VAR` maps in `FeedLead.tsx` / `StoryDetail.tsx`. Reuse exactly; do not introduce new colors.
- `frontend/src/app/(app)/archive/page.tsx` — the 12r page is the closest structural precedent (client component, `useQuery`, loading/empty/error states).

## No migration
The chart derives entirely from existing columns (`events.published_at`, `events.created_at`, and the source/save/age inputs to `effective_score`). No schema change, no `0045_*.sql`. If you find yourself writing a migration, stop and re-read the scope.

---

## Task 1 — Backend: `GET /api/v1/stories/pulse`

`backend/src/controllers/storyController.ts` — add `getPulse` (model it on `getNativeStories`):

- Query params (zod, like `feedQuerySchema`): `sectors` (optional CSV → string[]), `window_hours` (optional int, default 72, max 168), `limit` (optional int, default 60, max `MAX_LIMIT`).
- WHERE: `eventHasEnabledSourceExpr()` AND (optional `inArray(events.sector, sectors)`) AND published/created within `window_hours`. Empty `sectors` → all sectors (match feed semantics; if you want it personalized, read `userProfiles.sectors` like `getFeed` does, but default scope decision is **all sectors** — the pulse is a macro view).
- SELECT only what the chart needs: `id`, `headline`, `sector`, `effectiveScore: eventEffectiveScoreExpr()`, `ageHours: eventAgeHoursExpr()`, `publishedAt`, `createdAt`, plus `saveCount`/`commentCount` if you want them in the tooltip (optional).
- ORDER BY `effective_score` DESC, `LIMIT limit`. No `event_sources` batch, no `shapeEvent`, no paywall — keep it lean.
- Response envelope: `{ data: { items: PulseItem[], window_hours, total: items.length } }` where each item is `{ id, headline, sector, effective_score: Number(...), age_hours: Number(...), published_at }`.

`backend/src/routes/stories.ts` — register **before `/:id`**, after `/native`:
```ts
storiesRouter.get("/pulse", requireProfile, getPulse);
```

## Task 2 — Frontend types + api wrapper
- `frontend/src/types/story.ts`: add `PulseItem` (`id`, `headline`, `sector: Sector | string`, `effective_score: number`, `age_hours: number`, `published_at: string | null`) and `PulseResponse` (`items: PulseItem[]`, `window_hours: number`, `total: number`).
- `frontend/src/lib/api.ts`: add `getPulseRequest(params?: { sectors?: string[]; window_hours?: number; limit?: number })` — copy `getNativeStoriesRequest` shape, GET `/api/v1/stories/pulse`.

## Task 3 — Frontend: the quad chart component + page
- `frontend/src/components/pulse/QuadChart.tsx` (client component):
  - recharts `ScatterChart` with `XAxis` = `age_hours` **reversed** (`reversed` prop, so fresh = right), `YAxis` = `effective_score` (domain must allow negatives — use `['dataMin', 'dataMax']` with a little padding, or `['auto', 'auto']`).
  - One `Scatter` series per sector (so each gets its `SECTOR_VAR` fill), or a single series with per-point `fill`. Color strictly from the sector palette.
  - Two `ReferenceLine`s at the **median** age (vertical) and **median** score (horizontal), computed client-side from `items`, to draw the quadrant cross.
  - Four corner quadrant labels ("Breaking", "Developing", "Emerging", "Fading") positioned with `Label`/`ReferenceArea` or absolutely-positioned overlays.
  - `Tooltip` showing headline + sector + score (round to 1 dp) + a human age ("3h ago" via `timeAgo`).
  - Point `onClick` → `router.push(\`/stories/\${id}\`)`; cursor pointer.
  - Empty state when `items.length === 0`.
- `frontend/src/app/(app)/pulse/page.tsx`: client page, `useQuery(['pulse', sectors], () => getPulseRequest(...))`, masthead ("The Pulse" + a one-line dek), optional `SectorFilter` reuse, loading skeleton, error state, then `<QuadChart items={...} />`. Mirror `archive/page.tsx` structure.
- `frontend/src/components/layout/Sidebar.tsx`: add `{ href: "/pulse", label: "Pulse", icon: LayoutGrid }` (import `LayoutGrid` from `lucide-react`; `Grid2x2` / `ScatterChart` are fine alternatives if `LayoutGrid` reads wrong next to the others).

## Task 4 — Tests (ship with the feature, not after)
- Backend (`backend/tests/stories.integration.test.ts`, jest+supertest, `mock.queueSelect` pattern):
  - 401 without token.
  - happy path: stage `queueOnboarded()` + one pulse row, assert `items[0]` carries numeric `effective_score` + `age_hours` and the headline.
  - sector filter: pass `?sectors=finance`, assert the WHERE path runs (one staged row, 200).
  - empty window: stage `[]`, assert `items: []`.
  - (Coerce check) stage `effectiveScore` as a string ("7.5") and assert it comes back as a number on the wire — this guards the `Number()` coercion.
- Frontend (vitest):
  - `QuadChart` renders one point per item (query the rendered points / dots).
  - clicking a point calls the router push with the right id (mock `next/navigation`).
  - median divider lines render (two `ReferenceLine`s).
  - empty-state renders when `items=[]`.
  - Add `PulseItem` fixtures; no existing Story fixtures change (pulse types are standalone).

## Gates
- `npm run type-check --workspace=backend` clean
- `npm run type-check --workspace=frontend` clean
- `npm run lint --workspace=backend` clean
- `npm test --workspace=backend` — 1267 prior + your new tests, 0 failed
- `npm test --workspace=frontend -- --run` — 117 prior + your new tests, 0 failed
- UI check: load `/pulse`, confirm points render in the right quadrants, sector colors match the feed, a point click lands on `/stories/[id]`. If you can't run the dev server, say so explicitly.

## Report format
Files changed; endpoint shape (one sample `PulseItem` JSON); a note on whether quadrant dividers are median or fixed; new test counts (backend + frontend); any scope decision from above you overrode and why.

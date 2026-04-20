# SIGNAL — v2 API Reference

Authoritative reference for the `/api/v2/*` Intelligence API. All endpoints require a self-service API key (`X-API-Key: sgnl_live_...`) and are subject to per-key rate limiting (60 req/min, fail-open on Redis outage).

Error envelope (all endpoints):

```json
{ "error": { "code": "INVALID_QUERY", "message": "...", "details": { } } }
```

## `GET /api/v2/stories`

Keyset-paginated feed of published stories.

**Query params:**
- `sector` — `ai` / `finance` / `semiconductors` (optional)
- `since`, `until` — ISO-8601 datetimes with offset (optional)
- `author` — UUID (optional)
- `limit` — 1..100, default 50
- `cursor` — opaque, emitted by the previous page

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "headline": "...",
      "summary": "...",
      "url": "https://...",
      "published_at": "2026-04-15T10:30:00.000Z",
      "sector": "ai"
    }
  ],
  "pagination": { "next_cursor": "base64url|null", "has_more": false }
}
```

Drafts (`published_at IS NULL`) are excluded unconditionally.

## `GET /api/v2/trends/:sector`

Per-sector weekly trend series with derived momentum. Reads from `story_aggregates` (populated daily at 02:00 UTC by the aggregation cron).

**Path params:**
- `sector` — `ai` / `finance` / `semiconductors`. Unknown sectors return 400 `INVALID_SECTOR`.

**Query params:**
- `weeks` — integer 2..52, default 8. Below 2 returns 400 `INVALID_QUERY` (momentum needs two data points).

**Response:**
```json
{
  "data": {
    "sector": "ai",
    "as_of": "2026-04-20T02:00:00.000Z",
    "momentum": 1.0,
    "series": [
      { "period": "2026-W16", "story_count": 10, "save_count": 0 },
      { "period": "2026-W15", "story_count": 5,  "save_count": 0 }
    ]
  }
}
```

`series` is returned newest-first. `as_of` is the most recent `computed_at` across returned rows (null when no aggregates exist yet).

**Momentum semantics:**

```
momentum = (this_week_count - last_week_count) / max(last_week_count, 1)
```

The `max(·, 1)` floor avoids divide-by-zero on a 0→N jump, which would otherwise produce ±∞. As a side effect, the first non-zero week after a zero week reads as "this_week new stories" rather than undefined — intentional and documented for API consumers.

`momentum` is `null` when the caller requested fewer than two periods (explicit `weeks` below 2 is rejected at validation, but an empty DB also produces `momentum: null`).

`save_count` is always 0 in v1. The column is reserved so a future engagement-weighted aggregation can be added without a breaking API change.

## Aggregation job

- **Queue:** `signal-aggregation`
- **Job name:** `compute-sector-weekly`
- **Cron:** `0 2 * * *` UTC (daily, configurable via `AGGREGATION_CRON`)
- **Manual trigger (CLI):** `npm run run-aggregation [-- --period=2026-W16] --workspace=backend`

The job recomputes the current ISO week's rollup and upserts one row per known sector (zero-filling sectors with no stories that week). Re-running against the same period updates counts and bumps `computed_at`/`updated_at` — safe to trigger repeatedly for backfills.

When `REDIS_URL` is unset, the queue and worker log and no-op cleanly. The CLI still works (the job body is Redis-free — it talks directly to Postgres).

# SIGNAL — Schema & Seeding Reference

The authoritative schema lives in [`backend/src/db/schema.ts`](../backend/src/db/schema.ts). This doc focuses on the tables touched by content seeding and on the seeder itself.

## Content tables

### `stories`

| column                      | type            | notes                                         |
|-----------------------------|-----------------|-----------------------------------------------|
| `id`                        | uuid PK         | `defaultRandom()`                             |
| `sector`                    | varchar(50)     | one of `ai` / `finance` / `semiconductors`    |
| `headline`                  | varchar(255)    | not null                                      |
| `context`                   | text            | not null                                      |
| `why_it_matters`            | text            | **not null** — role-neutral fallback          |
| `why_it_matters_template`   | text            | JSON-stringified `{ai, finance, semiconductors}` |
| `source_url`                | text            | not null, **no unique constraint**            |
| `source_name`               | varchar(255)    | nullable                                      |
| `author_id`                 | uuid FK         | → `writers.id`, `on delete set null`          |
| `published_at`              | timestamptz     | must be set for v2 API to surface the story   |
| `created_at`, `updated_at`  | timestamptz     | `defaultNow()`                                |

Indexes: `(sector, published_at)`, `(created_at)`.

### `writers`

| column            | type         | notes                        |
|-------------------|--------------|------------------------------|
| `id`              | uuid PK      | `defaultRandom()`            |
| `name`            | varchar(255) | not null, **not unique**     |
| `email`           | varchar(255) | unique, nullable             |
| `bio`             | text         | nullable                     |
| `twitter_handle`  | varchar(100) | nullable                     |
| `sectors`         | jsonb        | `string[]`, nullable         |
| `created_at`      | timestamptz  | `defaultNow()`               |

There is **no `slug` column** and **no `updated_at` column**. `name` has no unique constraint — the seeder falls back to SELECT-by-name + INSERT-if-absent for upsert, which is acceptable for a manually-operated prod seed with explicit confirmation (concurrent seeders are not in scope).

## Seeding stories (`npm run seed:stories`)

The seeder loads hand-curated content from `backend/seed-data/stories.json` and inserts it idempotently. The JSON is checked into the repo — it's the content source of truth, not a migration artifact.

### JSON shape

```json
{
  "writers_seed": [
    {
      "placeholder_id": "SIGNAL_EDITORIAL",
      "name": "SIGNAL Editorial",
      "slug": "signal-editorial",          // accepted but dropped (no column)
      "bio": "..."
    }
  ],
  "stories": [
    {
      "sector": "ai" | "finance" | "semiconductors",
      "headline": "...",                    // max 255 chars
      "context": "...",
      "why_it_matters": "...",              // role-neutral fallback
      "why_it_matters_template": {
        "ai": "...",
        "finance": "...",
        "semiconductors": "..."
      },
      "source_url": "https://...",
      "source_name": "Publication Name",
      "author_id": "SIGNAL_EDITORIAL",     // string placeholder, resolved at insert
      "published_at": "2026-04-15T10:30:00Z"  // ISO-8601 with offset
    }
  ]
}
```

### Placeholder-based author resolution

`author_id` in the JSON is a *string placeholder* (e.g. `"SIGNAL_EDITORIAL"`), not a UUID. The seeder:

1. Upserts every `writers_seed` entry by matching on `name`.
2. Captures the real `writers.id` UUID into a `placeholder_id → uuid` map.
3. Resolves each story's `author_id` through the map before INSERT.

This keeps the JSON file static and committable to git without hardcoded UUIDs, and lets production and staging share the same seed file even though their writer UUIDs differ.

### Idempotency

`stories.source_url` has no unique constraint in the DB, so the seeder takes a pre-SELECT approach:

1. `SELECT source_url FROM stories WHERE source_url IN (...)` with all incoming URLs.
2. Partition the batch into `toInsert` (new) and `toSkip` (already present).
3. INSERT only the fresh rows.

Re-running the seeder with the same JSON is therefore a no-op. Stories already in the table are **not** updated in place — this is an additive load, not a migration.

### Running it

```bash
# From repo root
cd backend

# Dry-run (read-only: SELECTs to compute counts, no writes, prints a sample)
npm run seed:stories -- --dry-run

# Actual run (prompts for y/n confirmation, shows DATABASE_URL host/dbname)
npm run seed:stories

# Custom file path
npm run seed:stories -- --file=/absolute/path/to/stories.json

# CI: skip confirmation prompt (do NOT use against prod interactively)
npm run seed:stories -- --yes
```

The confirmation prompt prints `Database: <host>/<dbname>` extracted from `DATABASE_URL`, so you can visually verify you're pointing at prod vs. staging before typing `y`.

### Exit codes

- `0` — success, or clean no-op re-run, or user declined at the prompt.
- `1` — validation failure (per-item errors printed to stderr) or DB error.

### Verifying the seed after it runs

```bash
# Hit v2 API
curl https://<prod>/api/v2/stories?sector=ai \
  -H "Authorization: Bearer $SIGNAL_API_KEY" | jq '.pagination.has_more'
```

If `data` is non-empty and pagination has the expected shape, the seed landed.

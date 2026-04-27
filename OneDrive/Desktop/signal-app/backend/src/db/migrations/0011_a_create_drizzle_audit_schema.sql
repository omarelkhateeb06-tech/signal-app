-- 0011_a — Bootstrap migration creating the legacy drizzle.__drizzle_migrations
-- schema and table on databases that never ran drizzle-kit. The next migration
-- (0012) COMMENTs on this table and would fail with "schema 'drizzle' does
-- not exist" on fresh DBs without this bootstrap. On environments that did
-- run drizzle-kit pre-cutover (production, pre-cutover dev DBs), this is a
-- no-op — CREATE SCHEMA IF NOT EXISTS and CREATE TABLE IF NOT EXISTS are
-- both idempotent.
--
-- Surfaced during 12e.1 (PR #43) Task 2 verification when running
-- db:migrate against a fresh Postgres container failed at 0012. See PR #43
-- session notes for the discovery context.
--
-- Column shape matches drizzle-kit's standard generated shape so prod and
-- fresh DBs converge on the same schema for the deprecated audit table.
-- The table itself remains read-only / deprecated per CLAUDE.md §7 and
-- 0012's COMMENT — this bootstrap exists so that COMMENT has a target,
-- not to revive any write path.
--
-- Filename uses the `NNNN_a_*` mid-sequence-repair form (rather than `0014_*`)
-- so the bootstrap lands as a pending migration on fresh DBs and sorts
-- before 0012 in the runner's lexical ordering. The runner's filename
-- regex (backend/src/db/migrate.ts: /^\d{4}_.*\.sql$/) requires the
-- underscore to follow the four-digit prefix immediately, so a bare
-- `0011a_*` form would be filtered out. The `0011_a_*` form passes the
-- regex and still sorts before `0012_*` lexically. Establishes the
-- convention for future mid-sequence repair migrations: `NNNN_a_*`,
-- `NNNN_b_*`, etc.

CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT
);

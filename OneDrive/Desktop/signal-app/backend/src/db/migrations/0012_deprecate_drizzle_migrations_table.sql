-- 0012_deprecate_drizzle_migrations_table.sql
-- Deprecates drizzle.__drizzle_migrations. The table is replaced by
-- schema_migrations as of the homegrown runner. Retained read-only for
-- historical audit. Do not write.
COMMENT ON TABLE drizzle.__drizzle_migrations IS 'DEPRECATED 2026-04-25 — replaced by schema_migrations. Retained for historical audit. Do not write.';

-- Phase 12a: commentary model pivot from sector-variant to depth-variant.
--
-- The `why_it_matters_template` column stays TEXT (it has been TEXT since
-- migration 0000 — Phase 4.5 stored JSON-stringified payloads into it, not
-- JSONB). No DDL change to the column type or a CHECK constraint; shape is
-- enforced at the application layer (Zod schemas in seedStories.ts and the
-- v2 stories controller).
--
-- Old application shape (Phase 4.5):
--   { "ai": "...", "finance": "...", "semiconductors": "..." }
-- New application shape (Phase 12a):
--   { "accessible": "...", "standard": "...", "technical": "..." }
--
-- Data migration: `npm run regenerate-depth-variants --workspace=backend`
-- rewrites every existing row's template in place via the Anthropic API.
-- Rows stay TEXT-encoded; the parser accepts only the new shape going
-- forward, so running the v2 API before regeneration completes will
-- surface rows as `why_it_matters_template: null` rather than crash.
--
-- The COMMENT ON COLUMN below exists purely as operational documentation
-- — it's the only safe way to record the shape change in the migration
-- stream without an invalid-rows window or a retroactive DDL.

COMMENT ON COLUMN "stories"."why_it_matters_template" IS
  'Depth-variant commentary JSON (Phase 12a+): {accessible, standard, technical}. TEXT-encoded, not JSONB. Nullable during regeneration windows.';

-- Phase 12e.7a — saves and comments can target either a story or an event.
-- Adds a nullable event_id FK alongside the existing nullable-as-of-now
-- story_id FK, plus a CHECK constraint that exactly one is non-null. The
-- partial unique index on (user_id, event_id) preserves the no-duplicate-
-- saves-per-target invariant for the new branch (the existing
-- user_saves_user_story_unique still covers the story branch — its
-- (user_id, story_id) uniqueness is unaffected by the NULL drop because
-- Postgres treats NULLs as distinct in a unique constraint, so multiple
-- event-saves with story_id NULL coexist freely).
--
-- Existing rows: every row currently has story_id non-null and event_id
-- absent. After ADD COLUMN event_id (defaulting to NULL), every existing
-- row satisfies the CHECK (1 + 0 = 1).
--
-- Rejection-test for the CHECK (run manually post-migration if needed):
--   INSERT INTO user_saves (user_id, story_id, event_id) VALUES (
--     '<uuid>', NULL, NULL);                      -- rejected: 0 + 0 ≠ 1
--   INSERT INTO user_saves (user_id, story_id, event_id) VALUES (
--     '<uuid>', '<story-uuid>', '<event-uuid>');  -- rejected: 1 + 1 ≠ 1

BEGIN;

-- user_saves: story_id nullable + event_id FK + exactly-one constraint + partial unique index
ALTER TABLE user_saves ALTER COLUMN story_id DROP NOT NULL;
ALTER TABLE user_saves
  ADD COLUMN event_id UUID REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE user_saves
  ADD CONSTRAINT user_saves_exactly_one_target CHECK (
    (story_id IS NOT NULL)::int + (event_id IS NOT NULL)::int = 1
  );
CREATE UNIQUE INDEX user_saves_user_event_unique
  ON user_saves (user_id, event_id)
  WHERE event_id IS NOT NULL;

-- comments: same pattern
ALTER TABLE comments ALTER COLUMN story_id DROP NOT NULL;
ALTER TABLE comments
  ADD COLUMN event_id UUID REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE comments
  ADD CONSTRAINT comments_exactly_one_target CHECK (
    (story_id IS NOT NULL)::int + (event_id IS NOT NULL)::int = 1
  );
CREATE INDEX comments_event_idx ON comments (event_id)
  WHERE event_id IS NOT NULL;

COMMIT;

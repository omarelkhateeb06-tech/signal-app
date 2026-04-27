-- 0011_drop_phase12b_helper.sql
-- Drops a helper function (_phase12b_jsonb_to_text_array) that was found on prod
-- but shouldn't exist per 0008's migration logic. Origin: likely stray artifact
-- from manual prod SQL during 0008's development. Idempotent — no-op on environments
-- where the function never existed (e.g. dev).
DROP FUNCTION IF EXISTS _phase12b_jsonb_to_text_array(jsonb);

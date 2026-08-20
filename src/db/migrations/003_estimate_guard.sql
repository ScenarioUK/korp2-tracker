-- soloDays, aiFactor and aiDays are read-only in this app.
--
-- They mirror the estimates workbook. If they need to change, the workbook
-- changes and the tracker is re-seeded. Divergence is a variance, not a re-cut.
--
-- The MCP tool schemas already reject these fields, and no repository UPDATE
-- names these columns. This trigger is the backstop that makes the rule true
-- of the database rather than true of the code that happens to be in front of
-- it — including psql. Re-baselining for v6 is therefore a deliberate
-- migration that drops and recreates this trigger, which is the intent.

CREATE OR REPLACE FUNCTION korp2_reject_estimate_change() RETURNS trigger AS $$
BEGIN
  IF NEW.solo_days IS DISTINCT FROM OLD.solo_days
     OR NEW.ai_factor IS DISTINCT FROM OLD.ai_factor
     OR NEW.ai_days  IS DISTINCT FROM OLD.ai_days
  THEN
    RAISE EXCEPTION
      'solo_days, ai_factor and ai_days are read-only in this app (line %). They mirror the estimates workbook; re-seed to change them.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS build_lines_estimate_guard ON build_lines;

CREATE TRIGGER build_lines_estimate_guard
  BEFORE UPDATE ON build_lines
  FOR EACH ROW
  EXECUTE FUNCTION korp2_reject_estimate_change();

-- The current build block: what this session is for, and what it is not for.
--
-- This is delivery state, not a browser preference — the point of the tracker
-- is that the position does not live in one place only, and a do-not-do list
-- kept locally protects nobody. Nothing here is personal data: line ids, a time
-- box, and two lists of intentions.
CREATE TABLE IF NOT EXISTS build_blocks (
  id          bigserial   PRIMARY KEY,
  block_date  date        NOT NULL DEFAULT CURRENT_DATE,
  -- Free text: "09:30–12:30" is more useful here than two timestamps nobody
  -- keeps honest.
  time_box    text,
  -- Build line ids. Not a foreign key because arrays cannot carry one; the
  -- write path validates every id against build_lines before it lands.
  targets     text[]      NOT NULL DEFAULT '{}',
  do_list     text[]      NOT NULL DEFAULT '{}',
  do_not_list text[]      NOT NULL DEFAULT '{}',
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  -- The day log entry written when the block was closed, if it was.
  day_log_id  bigint      REFERENCES day_log (id) ON DELETE RESTRICT,
  actor       text        NOT NULL
);

-- At most one block open at a time. A unique index on a constant, restricted to
-- open rows, is what enforces that — opening a second while one is running is a
-- constraint violation rather than a silently forked plan.
CREATE UNIQUE INDEX IF NOT EXISTS build_blocks_one_open
  ON build_blocks ((true)) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS build_blocks_date_idx ON build_blocks (block_date DESC, opened_at DESC);

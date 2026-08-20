-- KORP2 tracker core tables.
--
-- Delivery metadata only: refs, estimates, statuses, blockers, owner names.
-- No resident data, no health & disability values, no protected
-- characteristics. If a column here ever looks like it wants to hold personal
-- data, that is a design error, not a schema gap.

CREATE TABLE IF NOT EXISTS baseline (
  -- Single row. The CHECK plus the DEFAULT makes a second row impossible.
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  iteration          text        NOT NULL,
  estimate_baseline  text        NOT NULL,
  solo_days          numeric(7,2) NOT NULL,
  ai_days            numeric(7,2) NOT NULL,
  line_count         integer     NOT NULL,
  generated_from     text,
  generated_on       date,
  warning            text,
  loaded_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  ref           text PRIMARY KEY,
  question      text NOT NULL,
  impact        text,
  owner         text,
  needed_by     text,
  hard_blocker  boolean     NOT NULL DEFAULT false,
  status        text        NOT NULL
    CHECK (status IN ('OPEN', 'CHASED', 'ANSWERED', 'CLOSED', 'SUPERSEDED')),
  last_chased   date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS questions_open_hard_idx
  ON questions (status, hard_blocker);

CREATE TABLE IF NOT EXISTS build_lines (
  id           text PRIMARY KEY,               -- L01..L46. This is the key, not ref.
  ref          text,                           -- Deliberately NOT UNIQUE and nullable:
                                               -- 110358 and 110391 each cover two distinct
                                               -- requirements, and L08/L09 have no ref at all.
  short_name   text        NOT NULL,           -- Always shown wherever ref is shown.
  epic         text,
  priority     text,
  build_type   text,
  owner        text,
  solo_days    numeric(7,2),                   -- read-only, see 003_estimate_guard.sql
  ai_factor    numeric(4,2),                   -- read-only
  ai_days      numeric(7,2),                   -- read-only
  confidence   text,
  status       text        NOT NULL
    CHECK (status IN ('NOT_STARTED', 'BLOCKED', 'IN_PROGRESS', 'BUILT',
                      'TESTED', 'DONE', 'DESCOPED', 'NOT_MINE')),
  actual_days  numeric(7,2) CHECK (actual_days IS NULL OR actual_days >= 0),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS build_lines_status_idx ON build_lines (status);
CREATE INDEX IF NOT EXISTS build_lines_ref_idx    ON build_lines (ref);
CREATE INDEX IF NOT EXISTS build_lines_owner_idx  ON build_lines (owner);

-- Which questions block which lines. A real foreign key, so a typo'd blocker
-- ref cannot be stored, and the hard-blocker consistency check is an ordinary
-- join. ON DELETE RESTRICT because nothing in this app is ever deleted.
CREATE TABLE IF NOT EXISTS line_blockers (
  line_id      text NOT NULL REFERENCES build_lines (id) ON DELETE RESTRICT,
  question_ref text NOT NULL REFERENCES questions (ref) ON DELETE RESTRICT,
  PRIMARY KEY (line_id, question_ref)
);

CREATE INDEX IF NOT EXISTS line_blockers_question_idx ON line_blockers (question_ref);

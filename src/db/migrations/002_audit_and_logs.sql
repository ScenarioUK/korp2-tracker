-- Audit trail and append-only logs.
--
-- "Every write appends to an audit trail ({ts, actor, entity, field, from, to}).
--  That is what replaces git history."
--
-- from/to are stored as from_value/to_value because FROM is a reserved word;
-- the MCP layer maps them back to from/to on the way out. entity_id is added
-- to the brief's tuple — without it an audit row cannot be traced to the line
-- or question it describes.

CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  actor      text        NOT NULL,   -- 'mcp' | 'ui' | 'seed'. Set by the surface, never by the caller.
  entity     text        NOT NULL,   -- 'build_line' | 'question'
  entity_id  text        NOT NULL,
  field      text        NOT NULL,
  from_value text,
  to_value   text
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id, ts DESC);

-- update_question appends a note rather than overwriting one.
CREATE TABLE IF NOT EXISTS question_notes (
  id           bigserial PRIMARY KEY,
  question_ref text        NOT NULL REFERENCES questions (ref) ON DELETE RESTRICT,
  ts           timestamptz NOT NULL DEFAULT now(),
  actor        text        NOT NULL,
  note         text        NOT NULL
);

CREATE INDEX IF NOT EXISTS question_notes_ref_idx ON question_notes (question_ref, ts DESC);

-- TOOLING is the cause that tells us whether the AI co-working factors hold.
CREATE TABLE IF NOT EXISTS variances (
  id          bigserial PRIMARY KEY,
  line_id     text        NOT NULL REFERENCES build_lines (id) ON DELETE RESTRICT,
  est_ai_days numeric(7,2) NOT NULL,
  actual_days numeric(7,2) NOT NULL,
  cause       text        NOT NULL
    CHECK (cause IN ('SCOPE', 'AMBIGUITY', 'DEPENDENCY_WAIT', 'ESTIMATE_ERROR', 'TOOLING')),
  declared_to text,
  ts          timestamptz NOT NULL DEFAULT now(),
  actor       text        NOT NULL
);

CREATE INDEX IF NOT EXISTS variances_line_idx ON variances (line_id, ts DESC);

CREATE TABLE IF NOT EXISTS day_log (
  id             bigserial PRIMARY KEY,
  log_date       date        NOT NULL,
  moved          text,
  decisions      text,
  blockers_moved text,
  tomorrow       text,
  ts             timestamptz NOT NULL DEFAULT now(),
  actor          text        NOT NULL
);

CREATE INDEX IF NOT EXISTS day_log_date_idx ON day_log (log_date DESC);

-- Nothing is deleted. Removing scope sets status to DESCOPED, requires a note,
-- and writes a row here. Seeded with the five pre-existing v5 descopes, which
-- have no line_id because they were removed before the lines were cut.
CREATE TABLE IF NOT EXISTS descope_audit (
  id                bigserial PRIMARY KEY,
  descoped_on       date        NOT NULL,
  item              text        NOT NULL,
  line_id           text        REFERENCES build_lines (id) ON DELETE RESTRICT,
  solo_days_removed numeric(7,2) NOT NULL DEFAULT 0,
  reason            text        NOT NULL,
  decision_ref      text,
  reversible        boolean     NOT NULL DEFAULT true,
  ts                timestamptz NOT NULL DEFAULT now(),
  actor             text        NOT NULL
);

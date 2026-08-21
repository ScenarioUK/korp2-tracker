-- A variance carries an optional free-text note alongside its cause.
--
-- The closed cause list says which of five things happened; the note says what
-- actually happened. TOOLING with "Copilot rewrote the plugin scaffold in one
-- pass" is worth far more later than TOOLING alone, and it is the only place
-- that detail can live — the estimate fields are read-only and the line's own
-- note is about the line, not about this divergence.
ALTER TABLE variances ADD COLUMN IF NOT EXISTS note text;

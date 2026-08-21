import type { Db } from '../db/pool.js';
import type { Baseline, Warning } from '../domain/types.js';
import { lineWarnings, summariseWarnings } from '../domain/warnings.js';
import { COMPLETE_STATUSES, OUT_OF_PROGRESS_STATUSES, STATUS_VOCABULARY, type Status } from '../domain/vocab.js';
import { BLOCKER_LATERAL } from './lines.js';

/**
 * The get_position rollup. No line detail — counts, days, blockers, warnings.
 *
 * Progress arithmetic follows the brief: DONE is the only completion state,
 * and NOT_MINE (Integration or BI owns the build) and DESCOPED come out of the
 * denominator rather than counting as complete.
 */

export interface Position {
  iteration: string;
  estimateBaseline: string;
  baselineWarning: string | null;
  counts: Record<Status, number>;
  progress: {
    lineCount: number;
    inScope: number;
    done: number;
    outOfScope: number;
    percentComplete: number;
  };
  days: {
    baselineSoloDays: number;
    baselineAiDays: number;
    actualDaysLogged: number;
    /** aiDays for just the lines that have an actualDays — the like-for-like comparison. */
    aiDaysForLinesWithActuals: number;
    /** aiDays still ahead: everything not DONE, DESCOPED or NOT_MINE. */
    aiDaysRemaining: number;
  };
  blockers: {
    openHardBlockerCount: number;
    openHardBlockerRefs: string[];
    linesWithOpenHardBlockers: number;
  };
  warnings: { code: string; count: number; lineIds: string[] }[];
}

export async function getBaseline(db: Db): Promise<Baseline | null> {
  const { rows } = await db.query<{
    iteration: string;
    estimate_baseline: string;
    solo_days: number;
    ai_days: number;
    line_count: number;
    generated_from: string | null;
    generated_on: string | null;
    warning: string | null;
  }>('SELECT * FROM baseline WHERE id = true');

  const row = rows[0];
  if (!row) return null;
  return {
    iteration: row.iteration,
    estimateBaseline: row.estimate_baseline,
    soloDays: row.solo_days,
    aiDays: row.ai_days,
    lineCount: row.line_count,
    generatedFrom: row.generated_from,
    generatedOn: row.generated_on,
    warning: row.warning,
  };
}

export async function getPosition(db: Db): Promise<Position> {
  const baseline = await getBaseline(db);

  const statusRows = await db.query<{ status: Status; count: string }>(
    'SELECT status, count(*)::text AS count FROM build_lines GROUP BY status',
  );
  const counts = Object.fromEntries(STATUS_VOCABULARY.map((s) => [s, 0])) as Record<Status, number>;
  for (const row of statusRows.rows) {
    counts[row.status] = Number.parseInt(row.count, 10);
  }

  const lineCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const outOfScope = OUT_OF_PROGRESS_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const done = COMPLETE_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const inScope = lineCount - outOfScope;

  const dayRows = await db.query<{
    actual_days_logged: number | null;
    ai_days_with_actuals: number | null;
    ai_days_remaining: number | null;
  }>(
    `SELECT COALESCE(sum(actual_days), 0)                                          AS actual_days_logged,
            COALESCE(sum(ai_days) FILTER (WHERE actual_days IS NOT NULL), 0)       AS ai_days_with_actuals,
            COALESCE(sum(ai_days) FILTER (WHERE status NOT IN ('DONE', 'DESCOPED', 'NOT_MINE')), 0)
                                                                                   AS ai_days_remaining
     FROM build_lines`,
  );
  const days = dayRows.rows[0];

  const blockerRows = await db.query<{ ref: string }>(
    // Natural order, not string order: refs are a letter prefix plus a number,
    // so a plain ORDER BY puts G15 between G1 and G2 and the list reads wrong
    // everywhere it is printed.
    `SELECT ref FROM questions
     WHERE status = 'OPEN' AND hard_blocker
     ORDER BY substring(ref from '^[A-Za-z]+'),
              COALESCE(NULLIF(substring(ref from '[0-9]+'), ''), '0')::int`,
  );

  const linesBlocked = await db.query<{ count: string }>(
    `SELECT count(DISTINCT lb.line_id)::text AS count
     FROM line_blockers lb
     JOIN questions q ON q.ref = lb.question_ref
     JOIN build_lines l ON l.id = lb.line_id
     WHERE q.status = 'OPEN' AND q.hard_blocker AND l.status <> 'DESCOPED'`,
  );

  // Only rows that could possibly trip a check are fetched — a line is a
  // candidate if it is BLOCKED (might have no blockers) or has an open hard
  // blocker (might not be BLOCKED).
  const candidateRows = await db.query<{
    id: string;
    ref: string | null;
    short_name: string;
    status: Status;
    blockers: string[];
    open_hard_blockers: string[];
  }>(
    `SELECT l.id, l.ref, l.short_name, l.status,
            COALESCE(b.all_refs, '{}'::text[])  AS blockers,
            COALESCE(b.open_hard, '{}'::text[]) AS open_hard_blockers
     FROM build_lines l
     ${BLOCKER_LATERAL}
     WHERE l.status = 'BLOCKED' OR b.open_hard IS NOT NULL
     ORDER BY l.id`,
  );

  const warnings: Warning[] = candidateRows.rows.flatMap((row) =>
    lineWarnings({
      id: row.id,
      ref: row.ref,
      shortName: row.short_name,
      status: row.status,
      blockers: row.blockers,
      openHardBlockers: row.open_hard_blockers,
    }),
  );

  return {
    iteration: baseline?.iteration ?? 'unknown',
    estimateBaseline: baseline?.estimateBaseline ?? 'unknown',
    baselineWarning: baseline?.warning ?? null,
    counts,
    progress: {
      lineCount,
      inScope,
      done,
      outOfScope,
      percentComplete: inScope > 0 ? Math.round((done / inScope) * 1000) / 10 : 0,
    },
    days: {
      baselineSoloDays: baseline?.soloDays ?? 0,
      baselineAiDays: baseline?.aiDays ?? 0,
      actualDaysLogged: days?.actual_days_logged ?? 0,
      aiDaysForLinesWithActuals: days?.ai_days_with_actuals ?? 0,
      aiDaysRemaining: days?.ai_days_remaining ?? 0,
    },
    blockers: {
      openHardBlockerCount: blockerRows.rows.length,
      openHardBlockerRefs: blockerRows.rows.map((r) => r.ref),
      linesWithOpenHardBlockers: Number.parseInt(linesBlocked.rows[0]?.count ?? '0', 10),
    },
    warnings: summariseWarnings(warnings),
  };
}

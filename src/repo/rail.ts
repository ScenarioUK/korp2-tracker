import type { Db } from '../db/pool.js';
import { STATUS_VOCABULARY, type Status } from '../domain/vocab.js';

/**
 * Day sums for the budget rail.
 *
 * getPosition counts lines; the rail measures days, because a line is not a
 * unit of anything — they run from 0 to 6 aiDays each. Kept separate from
 * Position so the MCP rollup stays the shape the connector already expects.
 */

export interface RailBand {
  lines: number;
  aiDays: number;
}

export interface Rail {
  /** Every status, including the ones severed from the track. */
  byStatus: Record<Status, RailBand>;
  /**
   * Days behind an OPEN hard blocker, whatever the line's declared status.
   * This is not the same claim as `counts.BLOCKED` — the two disagreeing is
   * the consistency check, so they are measured independently.
   */
  atRisk: RailBand;
}

export async function getRail(db: Db): Promise<Rail> {
  const statusRows = await db.query<{ status: Status; lines: string; ai_days: number }>(
    `SELECT status,
            count(*)::text            AS lines,
            COALESCE(sum(ai_days), 0) AS ai_days
     FROM build_lines
     GROUP BY status`,
  );

  const byStatus = Object.fromEntries(
    STATUS_VOCABULARY.map((status) => [status, { lines: 0, aiDays: 0 }]),
  ) as Record<Status, RailBand>;

  for (const row of statusRows.rows) {
    byStatus[row.status] = { lines: Number.parseInt(row.lines, 10), aiDays: row.ai_days };
  }

  // DESCOPED is excluded for the same reason it is excluded from the progress
  // denominator: it is out of scope, so an open question against it is not a risk.
  const atRiskRows = await db.query<{ lines: string; ai_days: number }>(
    `SELECT count(*)::text            AS lines,
            COALESCE(sum(ai_days), 0) AS ai_days
     FROM build_lines l
     WHERE l.status <> 'DESCOPED'
       AND EXISTS (
         SELECT 1
         FROM line_blockers lb
         JOIN questions q ON q.ref = lb.question_ref
         WHERE lb.line_id = l.id AND q.status = 'OPEN' AND q.hard_blocker
       )`,
  );

  const atRisk = atRiskRows.rows[0];

  return {
    byStatus,
    atRisk: {
      lines: Number.parseInt(atRisk?.lines ?? '0', 10),
      aiDays: atRisk?.ai_days ?? 0,
    },
  };
}

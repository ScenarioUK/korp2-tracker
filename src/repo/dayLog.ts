import type pg from 'pg';
import { withTransaction, type Db } from '../db/pool.js';
import { appendAudit, type Actor } from '../domain/audit.js';

/**
 * The day log: what moved, what was decided, what shifted on blockers, what is
 * next. Append-only — a second entry for the same date is another entry, not a
 * replacement.
 */

export interface DayLogInput {
  /** ISO date. Defaults to the server's current date. */
  date?: string;
  moved: string;
  decisions?: string;
  blockersMoved?: string;
  tomorrow?: string;
}

export interface LoggedDay {
  id: string;
  date: string;
  moved: string;
  decisions: string | null;
  blockersMoved: string | null;
  tomorrow: string | null;
  ts: string;
  entriesForDate: number;
}

export async function logDay(pool: pg.Pool, input: DayLogInput, actor: Actor): Promise<LoggedDay> {
  return withTransaction(pool, async (client) => {
    const clean = (value: string | undefined) => value?.trim() || null;

    const inserted = await client.query<{
      id: string;
      log_date: string;
      ts: Date;
    }>(
      `INSERT INTO day_log (log_date, moved, decisions, blockers_moved, tomorrow, actor)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6)
       RETURNING id::text AS id, log_date, ts`,
      [
        input.date ?? null,
        input.moved.trim(),
        clean(input.decisions),
        clean(input.blockersMoved),
        clean(input.tomorrow),
        actor,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Day log insert returned no row.');

    await appendAudit(client, actor, 'day_log', row.log_date, [
      { field: 'entry', from: null, to: input.moved.trim() },
    ]);

    const count = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM day_log WHERE log_date = $1',
      [row.log_date],
    );

    return {
      id: row.id,
      date: row.log_date,
      moved: input.moved.trim(),
      decisions: clean(input.decisions),
      blockersMoved: clean(input.blockersMoved),
      tomorrow: clean(input.tomorrow),
      ts: row.ts.toISOString(),
      entriesForDate: Number.parseInt(count.rows[0]?.count ?? '1', 10),
    };
  });
}

/** The whole log, newest first. Append-only, so this is the complete history. */
export interface DayLogRow {
  id: string;
  date: string;
  moved: string | null;
  decisions: string | null;
  blockersMoved: string | null;
  tomorrow: string | null;
  ts: string;
  actor: string;
}

export async function listDayLog(db: Db): Promise<DayLogRow[]> {
  const result = await db.query<{
    id: string;
    log_date: string;
    moved: string | null;
    decisions: string | null;
    blockers_moved: string | null;
    tomorrow: string | null;
    ts: Date;
    actor: string;
  }>(
    `SELECT id::text AS id, log_date, moved, decisions, blockers_moved, tomorrow, ts, actor
     FROM day_log
     ORDER BY log_date DESC, ts DESC, id DESC`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    date: row.log_date,
    moved: row.moved,
    decisions: row.decisions,
    blockersMoved: row.blockers_moved,
    tomorrow: row.tomorrow,
    ts: row.ts.toISOString(),
    actor: row.actor,
  }));
}

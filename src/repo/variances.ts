import type pg from 'pg';
import { withTransaction, type Db } from '../db/pool.js';
import { appendAudit, type Actor } from '../domain/audit.js';
import { NotFound } from '../domain/errors.js';
import type { VarianceCause } from '../domain/vocab.js';

/**
 * Variance logging.
 *
 * A variance records that a line landed away from its estimate and why. It
 * never changes the estimate — soloDays, aiFactor and aiDays mirror the
 * workbook and stay put. Divergence is a variance, not a re-cut.
 *
 * TOOLING is the cause that tells us whether the AI co-working factors hold.
 */

export interface VarianceInput {
  lineId: string;
  /** Defaults to the line's own aiDays, which is what it is being compared against. */
  estAiDays?: number;
  actualDays: number;
  cause: VarianceCause;
  note?: string | null;
  declaredTo?: string | null;
}

export interface LoggedVariance {
  id: string;
  lineId: string;
  ref: string | null;
  shortName: string;
  estAiDays: number;
  actualDays: number;
  differenceDays: number;
  cause: VarianceCause;
  note: string | null;
  declaredTo: string | null;
  ts: string;
}

export async function logVariance(pool: pg.Pool, input: VarianceInput, actor: Actor): Promise<LoggedVariance> {
  return withTransaction(pool, async (client) => insertVariance(client, input, actor));
}

/**
 * The insert itself, on a caller-supplied client.
 *
 * updateLine calls this inside its own transaction so that a line reaching DONE
 * off its estimate cannot be saved without the variance that explains it — the
 * two either both land or neither does.
 */
export async function insertVariance(
  client: pg.PoolClient,
  input: VarianceInput,
  actor: Actor,
): Promise<LoggedVariance> {
  const lineId = input.lineId.trim().toUpperCase();

  {
    const lineResult = await client.query<{
      id: string;
      ref: string | null;
      short_name: string;
      ai_days: number | null;
    }>('SELECT id, ref, short_name, ai_days FROM build_lines WHERE id = $1', [lineId]);

    const line = lineResult.rows[0];
    if (!line) {
      throw new NotFound(
        `No build line with id "${input.lineId}". A variance has to hang off a line — ids run L01 to L46.`,
      );
    }

    const estAiDays = input.estAiDays ?? line.ai_days ?? 0;
    const declaredTo = input.declaredTo?.trim() || null;
    const note = input.note?.trim() || null;

    const inserted = await client.query<{ id: string; ts: Date }>(
      `INSERT INTO variances (line_id, est_ai_days, actual_days, cause, note, declared_to, actor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id::text AS id, ts`,
      [lineId, estAiDays, input.actualDays, input.cause, note, declaredTo, actor],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Variance insert returned no row.');

    const difference = Math.round((input.actualDays - estAiDays) * 100) / 100;

    await appendAudit(client, actor, 'build_line', lineId, [
      {
        field: 'variance',
        from: null,
        to:
          `${input.cause}: ${estAiDays} estimated vs ${input.actualDays} actual ` +
          `(${difference > 0 ? '+' : ''}${difference} days)` +
          `${declaredTo ? `, declared to ${declaredTo}` : ''}${note ? `, note: ${note}` : ''}`,
      },
    ]);

    return {
      id: row.id,
      lineId,
      ref: line.ref,
      shortName: line.short_name,
      estAiDays,
      actualDays: input.actualDays,
      differenceDays: difference,
      cause: input.cause,
      note,
      declaredTo,
      ts: row.ts.toISOString(),
    };
  }
}

/**
 * Every logged variance, newest first, with the line fields the view needs.
 *
 * soloDays, aiFactor and buildType come along so the TOOLING rollup can show
 * the implied factor against the stated one. They are read here and never
 * written — divergence is a variance, not a re-cut of the estimate.
 */
export interface VarianceRow {
  id: string;
  ts: string;
  lineId: string;
  ref: string | null;
  shortName: string;
  buildType: string | null;
  soloDays: number | null;
  aiFactor: number | null;
  estAiDays: number;
  actualDays: number;
  differenceDays: number;
  cause: VarianceCause;
  note: string | null;
  declaredTo: string | null;
  actor: string;
}

export async function listVariances(db: Db): Promise<VarianceRow[]> {
  const result = await db.query<{
    id: string;
    ts: Date;
    line_id: string;
    ref: string | null;
    short_name: string;
    build_type: string | null;
    solo_days: number | null;
    ai_factor: number | null;
    est_ai_days: number;
    actual_days: number;
    cause: VarianceCause;
    note: string | null;
    declared_to: string | null;
    actor: string;
  }>(
    `SELECT v.id::text AS id, v.ts, v.line_id, v.est_ai_days, v.actual_days, v.cause,
            v.note, v.declared_to, v.actor,
            l.ref, l.short_name, l.build_type, l.solo_days, l.ai_factor
     FROM variances v
     JOIN build_lines l ON l.id = v.line_id
     ORDER BY v.ts DESC, v.id DESC`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    ts: row.ts.toISOString(),
    lineId: row.line_id,
    ref: row.ref,
    shortName: row.short_name,
    buildType: row.build_type,
    soloDays: row.solo_days,
    aiFactor: row.ai_factor,
    estAiDays: row.est_ai_days,
    actualDays: row.actual_days,
    differenceDays: Math.round((row.actual_days - row.est_ai_days) * 100) / 100,
    cause: row.cause,
    note: row.note,
    declaredTo: row.declared_to,
    actor: row.actor,
  }));
}

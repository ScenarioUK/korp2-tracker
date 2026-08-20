import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
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
  declaredTo: string | null;
  ts: string;
}

export async function logVariance(pool: pg.Pool, input: VarianceInput, actor: Actor): Promise<LoggedVariance> {
  const lineId = input.lineId.trim().toUpperCase();

  return withTransaction(pool, async (client) => {
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

    const inserted = await client.query<{ id: string; ts: Date }>(
      `INSERT INTO variances (line_id, est_ai_days, actual_days, cause, declared_to, actor)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text AS id, ts`,
      [lineId, estAiDays, input.actualDays, input.cause, declaredTo, actor],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Variance insert returned no row.');

    const difference = Math.round((input.actualDays - estAiDays) * 100) / 100;

    await appendAudit(client, actor, 'build_line', lineId, [
      {
        field: 'variance',
        from: null,
        to: `${input.cause}: ${estAiDays} estimated vs ${input.actualDays} actual (${difference > 0 ? '+' : ''}${difference} days)${declaredTo ? `, declared to ${declaredTo}` : ''}`,
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
      declaredTo,
      ts: row.ts.toISOString(),
    };
  });
}

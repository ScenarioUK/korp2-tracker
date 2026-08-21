import type pg from 'pg';
import { withTransaction, type Db } from '../db/pool.js';
import { appendAudit, changeFor, type Actor, type FieldChange } from '../domain/audit.js';
import { NotFound, RuleViolation } from '../domain/errors.js';
import type { AuditEntry, LineDetail, LineSummary, Page, QuestionSummary, VarianceEntry, Warning } from '../domain/types.js';
import { lineWarnings } from '../domain/warnings.js';
import { insertVariance, type VarianceInput } from './variances.js';
import type { BlockerStatus, Status } from '../domain/vocab.js';

/**
 * Build line reads.
 *
 * The projection here is the reason `ref` and `shortName` always travel
 * together: 110358 and 110391 each cover two distinct requirements, so a ref
 * on its own is ambiguous. Enforced once, here, rather than in each tool.
 */

/** Questions run to 600+ characters in the seed. List views truncate; the connector has a token ceiling. */
export const QUESTION_TRUNCATE_AT = 240;

export function truncate(text: string, limit = QUESTION_TRUNCATE_AT): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit).trimEnd()}…`, truncated: true };
}

export interface LineFilters {
  status?: Status;
  buildType?: string;
  owner?: string;
  priority?: string;
  hasBlockers?: boolean;
}

interface LineSummaryRow {
  id: string;
  ref: string | null;
  short_name: string;
  build_type: string | null;
  status: Status;
  ai_days: number | null;
  actual_days: number | null;
  blockers: string[];
  open_hard_blockers: string[];
}

/**
 * Refs are a letter prefix plus a number, so ORDER BY on the text puts G15
 * between G1 and G2. Sorting on (prefix, number) keeps every printed list —
 * a line's blockers, the rail's at-risk refs — in the order a person reads.
 */
const REF_ORDER = "substring(lb.question_ref from '^[A-Za-z]+'), " +
  "COALESCE(NULLIF(substring(lb.question_ref from '[0-9]+'), ''), '0')::int";

/**
 * One subquery gives both the full blocker list and the subset that is
 * currently an OPEN hard blocker, which is what the consistency check needs.
 */
export const BLOCKER_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT array_agg(lb.question_ref ORDER BY ${REF_ORDER}) AS all_refs,
           array_agg(lb.question_ref ORDER BY ${REF_ORDER})
             FILTER (WHERE q.status = 'OPEN' AND q.hard_blocker) AS open_hard
    FROM line_blockers lb
    JOIN questions q ON q.ref = lb.question_ref
    WHERE lb.line_id = l.id
  ) b ON true
`;

const SUMMARY_COLUMNS = `
  l.id, l.ref, l.short_name, l.build_type, l.status, l.ai_days, l.actual_days,
  COALESCE(b.all_refs, '{}'::text[])  AS blockers,
  COALESCE(b.open_hard, '{}'::text[]) AS open_hard_blockers
`;

function buildWhere(filters: LineFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const eq = (column: string, value: unknown) => {
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  };

  if (filters.status !== undefined) eq('l.status', filters.status);
  if (filters.buildType !== undefined) eq('l.build_type', filters.buildType);
  if (filters.owner !== undefined) eq('l.owner', filters.owner);
  if (filters.priority !== undefined) eq('l.priority', filters.priority);
  if (filters.hasBlockers !== undefined) {
    conditions.push(
      `${filters.hasBlockers ? 'EXISTS' : 'NOT EXISTS'} (SELECT 1 FROM line_blockers lb2 WHERE lb2.line_id = l.id)`,
    );
  }

  return { clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function toSummary(row: LineSummaryRow): LineSummary {
  return {
    id: row.id,
    ref: row.ref,
    shortName: row.short_name,
    buildType: row.build_type,
    status: row.status,
    aiDays: row.ai_days,
    actualDays: row.actual_days,
    blockers: row.blockers,
  };
}

export async function listLines(
  db: Db,
  filters: LineFilters,
  limit: number,
  offset: number,
): Promise<Page<LineSummary>> {
  const { clause, params } = buildWhere(filters);

  const countResult = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM build_lines l ${clause}`,
    params,
  );
  const total = Number.parseInt(countResult.rows[0]?.count ?? '0', 10);

  const result = await db.query<LineSummaryRow>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM build_lines l
     ${BLOCKER_LATERAL}
     ${clause}
     ORDER BY l.id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const nextOffset = offset + result.rows.length < total ? offset + result.rows.length : null;
  return { items: result.rows.map(toSummary), total, offset, nextOffset };
}

/**
 * Every line, with the columns the browser table shows, in one query.
 *
 * Deliberately unpaginated and unfiltered: 46 rows is one small response, and
 * filtering and sorting 46 rows in the browser is instant and needs no round
 * trip. listLines above stays paginated because the MCP connector has a token
 * ceiling; this surface does not.
 *
 * openHardBlockers travels alongside blockers so the table can mark a latent
 * blocker without a second call, and the warnings are computed here with the
 * same lineWarnings() the MCP side uses — one definition of inconsistent.
 */
export interface LineRow extends LineSummary {
  priority: string | null;
  owner: string | null;
  note: string | null;
  openHardBlockers: string[];
  /**
   * How many variances are already on file. The browser needs this to apply
   * the same "already explained" rule the DONE gate applies server-side,
   * rather than demanding a cause the server would not require.
   */
  varianceCount: number;
  warnings: Warning[];
}

export async function listAllLines(db: Db): Promise<LineRow[]> {
  const result = await db.query<
    LineSummaryRow & { priority: string | null; owner: string | null; note: string | null; variance_count: string }
  >(
    `SELECT ${SUMMARY_COLUMNS}, l.priority, l.owner, l.note,
            (SELECT count(*)::text FROM variances v WHERE v.line_id = l.id) AS variance_count
     FROM build_lines l
     ${BLOCKER_LATERAL}
     ORDER BY l.id`,
  );

  return result.rows.map((row) => ({
    ...toSummary(row),
    priority: row.priority,
    owner: row.owner,
    note: row.note,
    openHardBlockers: row.open_hard_blockers,
    varianceCount: Number.parseInt(row.variance_count, 10),
    warnings: lineWarnings({
      id: row.id,
      ref: row.ref,
      shortName: row.short_name,
      status: row.status,
      blockers: row.blockers,
      openHardBlockers: row.open_hard_blockers,
    }),
  }));
}

interface LineDetailRow extends LineSummaryRow {
  epic: string | null;
  priority: string | null;
  owner: string | null;
  solo_days: number | null;
  ai_factor: number | null;
  confidence: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

interface BlockerDetailRow {
  ref: string;
  question: string;
  owner: string | null;
  needed_by: string | null;
  hard_blocker: boolean;
  status: BlockerStatus;
  last_chased: string | null;
}

export async function getLine(db: Db, id: string): Promise<LineDetail | null> {
  const result = await db.query<LineDetailRow>(
    `SELECT ${SUMMARY_COLUMNS},
            l.epic, l.priority, l.owner, l.solo_days, l.ai_factor, l.confidence, l.note,
            l.created_at, l.updated_at
     FROM build_lines l
     ${BLOCKER_LATERAL}
     WHERE l.id = $1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;

  const blockerDetail = await db.query<BlockerDetailRow>(
    `SELECT q.ref, q.question, q.owner, q.needed_by, q.hard_blocker, q.status, q.last_chased
     FROM line_blockers lb
     JOIN questions q ON q.ref = lb.question_ref
     WHERE lb.line_id = $1
     ORDER BY q.hard_blocker DESC, q.ref`,
    [id],
  );

  const audit = await db.query<{
    ts: Date;
    actor: string;
    entity: string;
    field: string;
    from_value: string | null;
    to_value: string | null;
  }>(
    `SELECT ts, actor, entity, field, from_value, to_value
     FROM audit_log
     WHERE entity = 'build_line' AND entity_id = $1
     ORDER BY ts DESC, id DESC`,
    [id],
  );

  const variances = await db.query<{
    ts: Date;
    est_ai_days: number;
    actual_days: number;
    cause: string;
    declared_to: string | null;
    actor: string;
  }>(
    `SELECT ts, est_ai_days, actual_days, cause, declared_to, actor
     FROM variances
     WHERE line_id = $1
     ORDER BY ts DESC`,
    [id],
  );

  const summary = toSummary(row);

  return {
    ...summary,
    epic: row.epic,
    priority: row.priority,
    owner: row.owner,
    soloDays: row.solo_days,
    aiFactor: row.ai_factor,
    confidence: row.confidence,
    note: row.note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    blockerDetail: blockerDetail.rows.map((q): QuestionSummary => {
      const { text, truncated } = truncate(q.question);
      return {
        ref: q.ref,
        question: text,
        truncated,
        owner: q.owner,
        neededBy: q.needed_by,
        hardBlocker: q.hard_blocker,
        status: q.status,
        lastChased: q.last_chased,
      };
    }),
    warnings: lineWarnings({
      id: row.id,
      ref: row.ref,
      shortName: row.short_name,
      status: row.status,
      blockers: row.blockers,
      openHardBlockers: row.open_hard_blockers,
    }),
    audit: audit.rows.map(
      (a): AuditEntry => ({
        ts: a.ts.toISOString(),
        actor: a.actor,
        entity: a.entity,
        field: a.field,
        from: a.from_value,
        to: a.to_value,
      }),
    ),
    variances: variances.rows.map(
      (v): VarianceEntry => ({
        ts: v.ts.toISOString(),
        estAiDays: v.est_ai_days,
        actualDays: v.actual_days,
        cause: v.cause,
        declaredTo: v.declared_to,
        actor: v.actor,
      }),
    ),
  };
}

/**
 * The only writable fields on a build line.
 *
 * solo_days, ai_factor and ai_days are absent by construction — this UPDATE
 * cannot name them. The tool schema rejects them before they get here, and
 * the trigger from 003_estimate_guard.sql rejects them after.
 */
export interface LineUpdate {
  status?: Status;
  actualDays?: number | null;
  note?: string | null;
}

export interface VariancePrompt {
  aiDays: number;
  actualDays: number;
  differenceDays: number;
  message: string;
}

export interface UpdateLineOptions {
  /**
   * The variance to record alongside this change, in the same transaction.
   * est_ai_days is taken from the line, so this cannot restate the estimate.
   */
  variance?: Omit<VarianceInput, 'lineId' | 'estAiDays' | 'actualDays'>;
  /**
   * Refuse the write when it would leave the line DONE at a number of days
   * different from its estimate with no variance to explain it.
   *
   * The browser sets this and MCP does not, and that asymmetry is deliberate:
   * a form can block a save and hold the user there, a tool call cannot — so
   * MCP takes the write and returns varianceNeeded instead. Same rule, enforced
   * where each surface is able to enforce it.
   */
  requireVarianceOnDone?: boolean;
}

export interface UpdateLineResult {
  line: LineDetail;
  changes: FieldChange[];
  descopeRecorded: boolean;
  /** Set when a line reached DONE off its estimate and no variance has been logged. */
  varianceNeeded: VariancePrompt | null;
}

interface LineWriteRow {
  id: string;
  short_name: string;
  status: Status;
  actual_days: number | null;
  note: string | null;
  solo_days: number | null;
  ai_days: number | null;
}

export async function updateLine(
  pool: pg.Pool,
  rawId: string,
  update: LineUpdate,
  actor: Actor,
  options: UpdateLineOptions = {},
): Promise<UpdateLineResult> {
  const id = rawId.trim().toUpperCase();

  const { changes, descopeRecorded } = await withTransaction(pool, async (client) => {
    const current = await client.query<LineWriteRow>(
      `SELECT id, short_name, status, actual_days, note, solo_days, ai_days
       FROM build_lines WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = current.rows[0];
    if (!before) {
      throw new NotFound(
        `No build line with id "${rawId}". Ids run L01 to L46. If you have a requirement ref, ` +
          'use list_lines to find the matching line — a ref can map to two lines.',
      );
    }

    // Nothing is ever deleted. Removing scope sets DESCOPED and requires a note
    // saying why, which is also what the descope_audit row records.
    const enteringDescoped = update.status === 'DESCOPED' && before.status !== 'DESCOPED';
    const note = update.note === undefined ? undefined : (update.note?.trim() || null);
    if (enteringDescoped && !note) {
      throw new RuleViolation(
        `Cannot set ${id} to DESCOPED without a note. Removing scope requires a reason — it is ` +
          'written to the descope audit and is the only record of why the line went. ' +
          'Call update_line again with a note explaining the decision.',
      );
    }

    // What the line will look like once this write lands.
    const nextStatus = update.status ?? before.status;
    const nextActualDays = update.actualDays !== undefined ? update.actualDays : before.actual_days;
    const offEstimate =
      nextStatus === 'DONE' &&
      nextActualDays !== null &&
      before.ai_days !== null &&
      nextActualDays !== before.ai_days;

    // A variance already on file means the divergence has been explained once;
    // this write is an edit, not the moment of completion.
    const alreadyExplained = offEstimate
      ? (
          await client.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM variances WHERE line_id = $1',
            [id],
          )
        ).rows[0]?.count !== '0'
      : false;

    if (options.requireVarianceOnDone && offEstimate && !alreadyExplained && !options.variance) {
      const difference = Math.round(((nextActualDays as number) - (before.ai_days as number)) * 100) / 100;
      throw new RuleViolation(
        `Cannot save ${id} as DONE at ${nextActualDays} days against an estimate of ${before.ai_days} ` +
          `(${difference > 0 ? '+' : ''}${difference}) without a cause. This is how the AI co-working factors get ` +
          'validated against reality instead of asserted. Choose one of SCOPE, AMBIGUITY, DEPENDENCY_WAIT, ' +
          'ESTIMATE_ERROR or TOOLING — TOOLING is the one that tells us whether the factors hold.',
      );
    }

    const assignments: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (update.status !== undefined) set('status', update.status);
    if (update.actualDays !== undefined) set('actual_days', update.actualDays);
    if (note !== undefined) set('note', note);

    const fieldChanges = [
      update.status !== undefined ? changeFor('status', before.status, update.status) : null,
      update.actualDays !== undefined ? changeFor('actualDays', before.actual_days, update.actualDays) : null,
      note !== undefined ? changeFor('note', before.note, note) : null,
    ].filter((c): c is FieldChange => c !== null);

    if (assignments.length > 0) {
      params.push(id);
      await client.query(
        `UPDATE build_lines SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
        params,
      );
    }

    await appendAudit(client, actor, 'build_line', id, fieldChanges);

    if (options.variance && nextActualDays !== null) {
      await insertVariance(
        client,
        {
          lineId: id,
          actualDays: nextActualDays,
          cause: options.variance.cause,
          note: options.variance.note ?? null,
          declaredTo: options.variance.declaredTo ?? null,
        },
        actor,
      );
    }

    if (enteringDescoped) {
      await client.query(
        `INSERT INTO descope_audit (descoped_on, item, line_id, solo_days_removed, reason,
                                    decision_ref, reversible, actor)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, NULL, true, $5)`,
        [before.short_name, id, before.solo_days ?? 0, note, actor],
      );
    }

    return { changes: fieldChanges, descopeRecorded: enteringDescoped };
  });

  const line = await getLine(pool, id);
  if (!line) throw new NotFound(`Build line ${id} disappeared during the update.`);

  return { line, changes, descopeRecorded, varianceNeeded: variancePrompt(line) };
}

/**
 * "When a line moves to DONE and actualDays differs from aiDays, prompt for a
 *  cause before saving. This is the single most valuable behaviour in the app."
 *
 * MCP cannot block mid-write the way a UI form can, so the write succeeds and
 * the prompt comes back with it — the caller is told to log the variance next.
 */
function variancePrompt(line: LineDetail): VariancePrompt | null {
  if (line.status !== 'DONE') return null;
  if (line.actualDays === null || line.aiDays === null) return null;
  if (line.actualDays === line.aiDays) return null;
  if (line.variances.length > 0) return null;

  const difference = Math.round((line.actualDays - line.aiDays) * 100) / 100;
  return {
    aiDays: line.aiDays,
    actualDays: line.actualDays,
    differenceDays: difference,
    message:
      `${line.id} is DONE at ${line.actualDays} days against an estimate of ${line.aiDays} ` +
      `(${difference > 0 ? '+' : ''}${difference}). Call log_variance with a cause now — this is how the ` +
      'AI co-working factors get validated against reality instead of asserted. ' +
      'Use TOOLING if the difference came from the AI co-working itself.',
  };
}


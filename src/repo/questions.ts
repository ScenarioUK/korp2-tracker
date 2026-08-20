import type pg from 'pg';
import { withTransaction, type Db } from '../db/pool.js';
import { appendAudit, changeFor, type Actor, type FieldChange } from '../domain/audit.js';
import { NotFound } from '../domain/errors.js';
import type { Page, QuestionSummary } from '../domain/types.js';
import type { BlockerStatus, Status } from '../domain/vocab.js';
import { truncate } from './lines.js';

/**
 * Question reads.
 *
 * Question text in the seed runs past 600 characters, so list views truncate.
 * The exception is a lookup by ref: there is exactly one result, so the full
 * text is returned. That is the escape hatch for reading a blocker in full
 * without adding a ninth tool.
 */

export interface QuestionFilters {
  status?: BlockerStatus;
  hardBlocker?: boolean;
  owner?: string;
  ref?: string;
}

interface QuestionRow {
  ref: string;
  question: string;
  owner: string | null;
  needed_by: string | null;
  hard_blocker: boolean;
  status: BlockerStatus;
  last_chased: string | null;
  blocked_line_count: string;
}

export interface QuestionListItem extends QuestionSummary {
  /** How many build lines this question currently blocks. */
  blockedLines: number;
}

export async function listQuestions(
  db: Db,
  filters: QuestionFilters,
  limit: number,
  offset: number,
): Promise<Page<QuestionListItem>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const eq = (column: string, value: unknown) => {
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  };

  if (filters.status !== undefined) eq('q.status', filters.status);
  if (filters.hardBlocker !== undefined) eq('q.hard_blocker', filters.hardBlocker);
  if (filters.owner !== undefined) {
    // Owners in the seed are compound ("Simon Shewry / BDA"), so match loosely.
    params.push(`%${filters.owner}%`);
    conditions.push(`q.owner ILIKE $${params.length}`);
  }
  if (filters.ref !== undefined) eq('q.ref', filters.ref);

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM questions q ${clause}`,
    params,
  );
  const total = Number.parseInt(countResult.rows[0]?.count ?? '0', 10);

  const result = await db.query<QuestionRow>(
    `SELECT q.ref, q.question, q.owner, q.needed_by, q.hard_blocker, q.status, q.last_chased,
            (SELECT count(*)::text FROM line_blockers lb WHERE lb.question_ref = q.ref) AS blocked_line_count
     FROM questions q
     ${clause}
     ORDER BY q.hard_blocker DESC, q.ref
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  // A lookup by ref returns a single question, so there is no token risk in
  // returning it whole — and a truncated blocker is not much use.
  const full = filters.ref !== undefined;

  const items = result.rows.map((row): QuestionListItem => {
    const { text, truncated } = full ? { text: row.question, truncated: false } : truncate(row.question);
    return {
      ref: row.ref,
      question: text,
      truncated,
      owner: row.owner,
      neededBy: row.needed_by,
      hardBlocker: row.hard_blocker,
      status: row.status,
      lastChased: row.last_chased,
      blockedLines: Number.parseInt(row.blocked_line_count, 10),
    };
  });

  const nextOffset = offset + items.length < total ? offset + items.length : null;
  return { items, total, offset, nextOffset };
}

/** Statuses that mean the question is no longer waiting on anyone. */
const SETTLED: readonly BlockerStatus[] = ['ANSWERED', 'CLOSED', 'SUPERSEDED'];

export interface QuestionUpdate {
  status?: BlockerStatus;
  /** ISO date, or null to clear. */
  lastChased?: string | null;
  note?: string;
}

export interface AffectedLine {
  id: string;
  ref: string | null;
  shortName: string;
  status: Status;
}

export interface UpdateQuestionResult {
  question: QuestionListItem;
  changes: FieldChange[];
  noteAppended: boolean;
  affectedLines: AffectedLine[];
  /** Surfaced, never acted on — closing a question does not unblock lines by itself. */
  followUp: string | null;
}

export async function updateQuestion(
  pool: pg.Pool,
  rawRef: string,
  update: QuestionUpdate,
  actor: Actor,
): Promise<UpdateQuestionResult> {
  const ref = rawRef.trim().toUpperCase();

  const { changes, noteAppended, wasSettled } = await withTransaction(pool, async (client) => {
    const current = await client.query<{ ref: string; status: BlockerStatus; last_chased: string | null }>(
      'SELECT ref, status, last_chased FROM questions WHERE ref = $1 FOR UPDATE',
      [ref],
    );
    const before = current.rows[0];
    if (!before) {
      throw new NotFound(
        `No question with ref "${rawRef}". Refs look like G1, I3, R1, A2 or AI4. ` +
          'Use list_questions to see what exists.',
      );
    }

    const assignments: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (update.status !== undefined) set('status', update.status);
    if (update.lastChased !== undefined) set('last_chased', update.lastChased);

    const fieldChanges = [
      update.status !== undefined ? changeFor('status', before.status, update.status) : null,
      update.lastChased !== undefined ? changeFor('lastChased', before.last_chased, update.lastChased) : null,
    ].filter((c): c is FieldChange => c !== null);

    if (assignments.length > 0) {
      params.push(ref);
      await client.query(
        `UPDATE questions SET ${assignments.join(', ')}, updated_at = now() WHERE ref = $${params.length}`,
        params,
      );
    }

    // A note is appended, never overwritten — the history of what was chased
    // and what came back is the point of it.
    const note = update.note?.trim();
    if (note) {
      await client.query('INSERT INTO question_notes (question_ref, actor, note) VALUES ($1, $2, $3)', [
        ref,
        actor,
        note,
      ]);
      fieldChanges.push({ field: 'note', from: null, to: note });
    }

    await appendAudit(client, actor, 'question', ref, fieldChanges);

    return {
      changes: fieldChanges,
      noteAppended: Boolean(note),
      wasSettled: update.status !== undefined && SETTLED.includes(update.status) && !SETTLED.includes(before.status),
    };
  });

  const page = await listQuestions(pool, { ref }, 1, 0);
  const question = page.items[0];
  if (!question) throw new NotFound(`Question ${ref} disappeared during the update.`);

  const lines = await pool.query<{ id: string; ref: string | null; short_name: string; status: Status }>(
    `SELECT l.id, l.ref, l.short_name, l.status
     FROM line_blockers lb
     JOIN build_lines l ON l.id = lb.line_id
     WHERE lb.question_ref = $1
     ORDER BY l.id`,
    [ref],
  );
  const affectedLines: AffectedLine[] = lines.rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    shortName: r.short_name,
    status: r.status,
  }));

  const stillBlocked = affectedLines.filter((l) => l.status === 'BLOCKED');
  const followUp =
    wasSettled && stillBlocked.length > 0
      ? `${ref} is now ${question.status}, but ${stillBlocked.length} line(s) are still BLOCKED on it: ` +
        `${stillBlocked.map((l) => `${l.id} (${l.shortName})`).join(', ')}. ` +
        'Nothing has been unblocked automatically — move each line with update_line if it can now proceed.'
      : null;

  return { question, changes, noteAppended, affectedLines, followUp };
}

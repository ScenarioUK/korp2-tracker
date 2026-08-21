import type pg from 'pg';
import { withTransaction, type Db } from '../db/pool.js';
import { appendAudit, type Actor } from '../domain/audit.js';
import { NotFound, RuleViolation } from '../domain/errors.js';
import type { Status } from '../domain/vocab.js';

/**
 * The current build block.
 *
 * One block open at a time, enforced by a partial unique index rather than by
 * discipline. A block is a statement of intent for a session: what it is for,
 * and — the part that actually protects the time — what it is explicitly not
 * for. Closing it writes the day log entry in the same transaction, so a block
 * cannot be closed without saying what came of it.
 */

export interface BlockTarget {
  id: string;
  ref: string | null;
  shortName: string;
  status: Status;
  aiDays: number | null;
  actualDays: number | null;
}

export interface BuildBlock {
  id: string;
  blockDate: string;
  timeBox: string | null;
  /** Line ids, resolved to their names — a ref or an id alone is not enough. */
  targets: BlockTarget[];
  doList: string[];
  doNotList: string[];
  openedAt: string;
  closedAt: string | null;
  dayLogId: string | null;
}

export interface BlockInput {
  timeBox?: string | null;
  targets?: string[];
  doList?: string[];
  doNotList?: string[];
}

interface BlockRow {
  id: string;
  block_date: string;
  time_box: string | null;
  targets: string[];
  do_list: string[];
  do_not_list: string[];
  opened_at: Date;
  closed_at: Date | null;
  day_log_id: string | null;
}

async function resolveTargets(db: Db, ids: string[]): Promise<BlockTarget[]> {
  if (ids.length === 0) return [];
  const result = await db.query<{
    id: string;
    ref: string | null;
    short_name: string;
    status: Status;
    ai_days: number | null;
    actual_days: number | null;
  }>(
    `SELECT id, ref, short_name, status, ai_days, actual_days
     FROM build_lines WHERE id = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  return result.rows.map((row) => ({
    id: row.id,
    ref: row.ref,
    shortName: row.short_name,
    status: row.status,
    aiDays: row.ai_days,
    actualDays: row.actual_days,
  }));
}

async function hydrate(db: Db, row: BlockRow): Promise<BuildBlock> {
  return {
    id: row.id,
    blockDate: row.block_date,
    timeBox: row.time_box,
    targets: await resolveTargets(db, row.targets),
    doList: row.do_list,
    doNotList: row.do_not_list,
    openedAt: row.opened_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
    dayLogId: row.day_log_id,
  };
}

const SELECT_BLOCK = `id::text AS id, block_date, time_box, targets, do_list, do_not_list,
                      opened_at, closed_at, day_log_id::text AS day_log_id`;

export async function getOpenBlock(db: Db): Promise<BuildBlock | null> {
  const result = await db.query<BlockRow>(
    `SELECT ${SELECT_BLOCK} FROM build_blocks WHERE closed_at IS NULL`,
  );
  const row = result.rows[0];
  return row ? hydrate(db, row) : null;
}

/** The last few closed blocks, for the Today view's "what the last block was" line. */
export async function recentBlocks(db: Db, limit = 5): Promise<BuildBlock[]> {
  const result = await db.query<BlockRow>(
    `SELECT ${SELECT_BLOCK} FROM build_blocks
     WHERE closed_at IS NOT NULL
     ORDER BY closed_at DESC
     LIMIT $1`,
    [limit],
  );
  return Promise.all(result.rows.map((row) => hydrate(db, row)));
}

const clean = (items: string[] | undefined): string[] | undefined =>
  items?.map((item) => item.trim()).filter((item) => item !== '');

/** Targets have to be real lines; a block aimed at L99 is a typo, not a plan. */
async function assertTargetsExist(client: pg.PoolClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await client.query<{ id: string }>('SELECT id FROM build_lines WHERE id = ANY($1::text[])', [ids]);
  const known = new Set(found.rows.map((row) => row.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new RuleViolation(
      `No build line with id ${missing.join(', ')}. Ids run L01 to L46 — a target has to be a real line.`,
    );
  }
}

export async function openBlock(pool: pg.Pool, input: BlockInput, actor: Actor): Promise<BuildBlock> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string }>('SELECT id::text AS id FROM build_blocks WHERE closed_at IS NULL');
    if (existing.rows[0]) {
      throw new RuleViolation(
        'A build block is already open. Close it first — closing writes the day log entry, which is the ' +
          'record of what the block produced.',
      );
    }

    const targets = (clean(input.targets) ?? []).map((id) => id.toUpperCase());
    await assertTargetsExist(client, targets);

    const inserted = await client.query<BlockRow>(
      `INSERT INTO build_blocks (time_box, targets, do_list, do_not_list, actor)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_BLOCK}`,
      [input.timeBox?.trim() || null, targets, clean(input.doList) ?? [], clean(input.doNotList) ?? [], actor],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Block insert returned no row.');

    await appendAudit(client, actor, 'tracker', `block:${row.id}`, [
      { field: 'block', from: null, to: `opened with ${targets.length} target(s)${targets.length ? `: ${targets.join(', ')}` : ''}` },
    ]);

    return hydrate(client, row);
  });
}

export async function updateOpenBlock(pool: pg.Pool, input: BlockInput, actor: Actor): Promise<BuildBlock> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<BlockRow>(
      `SELECT ${SELECT_BLOCK} FROM build_blocks WHERE closed_at IS NULL FOR UPDATE`,
    );
    const before = current.rows[0];
    if (!before) throw new NotFound('No build block is open. Start one before editing it.');

    const targets = input.targets === undefined ? undefined : (clean(input.targets) ?? []).map((id) => id.toUpperCase());
    if (targets) await assertTargetsExist(client, targets);

    const assignments: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (input.timeBox !== undefined) set('time_box', input.timeBox?.trim() || null);
    if (targets !== undefined) set('targets', targets);
    if (input.doList !== undefined) set('do_list', clean(input.doList) ?? []);
    if (input.doNotList !== undefined) set('do_not_list', clean(input.doNotList) ?? []);

    if (assignments.length === 0) return hydrate(client, before);

    params.push(before.id);
    const updated = await client.query<BlockRow>(
      `UPDATE build_blocks SET ${assignments.join(', ')} WHERE id = $${params.length}::bigint
       RETURNING ${SELECT_BLOCK}`,
      params,
    );
    const row = updated.rows[0];
    if (!row) throw new Error('Block update returned no row.');

    await appendAudit(client, actor, 'tracker', `block:${before.id}`, [
      { field: 'block', from: before.targets.join(', ') || null, to: row.targets.join(', ') || null },
    ]);

    return hydrate(client, row);
  });
}

export interface CloseBlockInput {
  moved: string;
  decisions?: string | null;
  blockersMoved?: string | null;
  tomorrow?: string | null;
}

export interface CloseBlockResult {
  block: BuildBlock;
  dayLogId: string;
  date: string;
}

/**
 * Close the block and write its day log entry together.
 *
 * One transaction on purpose: a block closed with no record of what moved is
 * exactly the gap the day log exists to fill, and two separate calls would let
 * the second be skipped.
 */
export async function closeBlock(pool: pg.Pool, input: CloseBlockInput, actor: Actor): Promise<CloseBlockResult> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<BlockRow>(
      `SELECT ${SELECT_BLOCK} FROM build_blocks WHERE closed_at IS NULL FOR UPDATE`,
    );
    const before = current.rows[0];
    if (!before) throw new NotFound('No build block is open, so there is nothing to close.');

    const moved = input.moved.trim();
    if (moved === '') {
      throw new RuleViolation(
        'Closing a block needs at least "what moved". A block with no record of what came of it is the ' +
          'gap the day log exists to fill.',
      );
    }

    const tidy = (value: string | null | undefined) => value?.trim() || null;

    const logged = await client.query<{ id: string; log_date: string }>(
      `INSERT INTO day_log (log_date, moved, decisions, blockers_moved, tomorrow, actor)
       VALUES (CURRENT_DATE, $1, $2, $3, $4, $5)
       RETURNING id::text AS id, log_date`,
      [moved, tidy(input.decisions), tidy(input.blockersMoved), tidy(input.tomorrow), actor],
    );
    const log = logged.rows[0];
    if (!log) throw new Error('Day log insert returned no row.');

    const closed = await client.query<BlockRow>(
      `UPDATE build_blocks SET closed_at = now(), day_log_id = $1::bigint WHERE id = $2::bigint
       RETURNING ${SELECT_BLOCK}`,
      [log.id, before.id],
    );
    const row = closed.rows[0];
    if (!row) throw new Error('Block close returned no row.');

    await appendAudit(client, actor, 'day_log', log.log_date, [{ field: 'entry', from: null, to: moved }]);
    await appendAudit(client, actor, 'tracker', `block:${before.id}`, [
      { field: 'block', from: 'open', to: `closed, logged to ${log.log_date}` },
    ]);

    return { block: await hydrate(client, row), dayLogId: log.id, date: log.log_date };
  });
}

import type pg from 'pg';

/**
 * The audit trail.
 *
 * "Every write appends to an audit trail ({ts, actor, entity, field, from, to}).
 *  That is what replaces git history."
 *
 * Every write in this app goes through appendAudit inside the same transaction
 * as the change itself, so a change cannot land without its audit row.
 *
 * The actor is fixed per surface and set by the transport, never by the caller
 * — a tool argument would be unverifiable. Human attribution goes in a note.
 */
export const ACTOR_MCP = 'mcp';
export const ACTOR_UI = 'ui';
export const ACTOR_SEED = 'seed';

export type Actor = typeof ACTOR_MCP | typeof ACTOR_UI | typeof ACTOR_SEED;

export type AuditEntity = 'build_line' | 'question' | 'day_log' | 'tracker';

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** Everything in the trail is stored as text, so nulls stay distinguishable from "0". */
export function auditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/**
 * Returns a change only if the value actually moved. A write that sets a field
 * to what it already held produces no audit row — the trail records changes,
 * not calls.
 */
export function changeFor(field: string, before: unknown, after: unknown): FieldChange | null {
  const from = auditValue(before);
  const to = auditValue(after);
  return from === to ? null : { field, from, to };
}

export async function appendAudit(
  client: pg.PoolClient,
  actor: Actor,
  entity: AuditEntity,
  entityId: string,
  changes: FieldChange[],
): Promise<void> {
  for (const change of changes) {
    await client.query(
      `INSERT INTO audit_log (actor, entity, entity_id, field, from_value, to_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor, entity, entityId, change.field, change.from, change.to],
    );
  }
}

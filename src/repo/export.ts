import type { Db } from '../db/pool.js';
import {
  BLOCKER_STATUS_VOCABULARY,
  STATUS_VOCABULARY,
  VARIANCE_CAUSES,
  type BlockerStatus,
  type Status,
} from '../domain/vocab.js';
import { getBaseline } from './position.js';

/**
 * The whole tracker as one JSON document.
 *
 * Shaped to mirror docs/korp2-tracker-seed.json where the tables overlap, so a
 * reader who knows the seed can read an export without a second schema. The
 * parts that did not exist at seed time — the audit trail, variances, the day
 * log, build blocks — come after, under their own keys.
 *
 * The audit trail is included deliberately: the brief says it is what replaces
 * git history, and an export that dropped it would lose the only record of how
 * the position got where it is.
 *
 * Contents are delivery metadata only — refs, estimates, statuses, blockers and
 * owner names. There is no resident data in this database to export.
 */

export interface ExportDocument {
  meta: {
    exportedAt: string;
    schemaVersion: string;
    service: string;
    serviceVersion: string;
    iteration: string;
    estimateBaseline: string;
    baselineTotals: { soloDays: number; aiDays: number; lineCount: number };
    generatedFrom: string | null;
    generatedOn: string | null;
    warning: string | null;
    contents: string;
    counts: Record<string, number>;
  };
  statusVocabulary: readonly Status[];
  blockerStatusVocabulary: readonly BlockerStatus[];
  varianceCauses: readonly string[];
  buildLines: unknown[];
  openQuestions: unknown[];
  questionNotes: unknown[];
  variances: unknown[];
  dayLog: unknown[];
  buildBlocks: unknown[];
  descopeAudit: unknown[];
  auditTrail: unknown[];
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export async function buildExport(
  db: Db,
  service: { name: string; version: string },
  exportedAt: Date,
): Promise<ExportDocument> {
  const baseline = await getBaseline(db);

  const schema = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
  );

  // Lines carry their blocker refs inline, as the seed does — a ref list on the
  // line is how the file is actually read.
  const lines = await db.query<Record<string, unknown>>(
    `SELECT l.id, l.ref, l.short_name AS "shortName", l.epic, l.priority, l.build_type AS "buildType",
            l.owner, l.solo_days AS "soloDays", l.ai_factor AS "aiFactor", l.ai_days AS "aiDays",
            l.confidence, l.status, l.actual_days AS "actualDays", l.note,
            COALESCE(
              (SELECT array_agg(lb.question_ref ORDER BY
                        substring(lb.question_ref from '^[A-Za-z]+'),
                        COALESCE(NULLIF(substring(lb.question_ref from '[0-9]+'), ''), '0')::int)
               FROM line_blockers lb WHERE lb.line_id = l.id),
              '{}'::text[]
            ) AS blockers,
            l.created_at AS "createdAt", l.updated_at AS "updatedAt"
     FROM build_lines l
     ORDER BY l.id`,
  );

  const questions = await db.query<Record<string, unknown>>(
    `SELECT q.ref, q.question, q.impact, q.owner, q.needed_by AS "neededBy",
            q.hard_blocker AS "hardBlocker", q.status, q.last_chased AS "lastChased",
            COALESCE(
              (SELECT array_agg(lb.line_id ORDER BY lb.line_id)
               FROM line_blockers lb WHERE lb.question_ref = q.ref),
              '{}'::text[]
            ) AS "blocksLines",
            q.created_at AS "createdAt", q.updated_at AS "updatedAt"
     FROM questions q
     ORDER BY substring(q.ref from '^[A-Za-z]+'),
              COALESCE(NULLIF(substring(q.ref from '[0-9]+'), ''), '0')::int`,
  );

  const questionNotes = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, question_ref AS "questionRef", ts, actor, note
     FROM question_notes ORDER BY ts, id`,
  );

  const variances = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, line_id AS "lineId", est_ai_days AS "estAiDays", actual_days AS "actualDays",
            cause, note, declared_to AS "declaredTo", ts, actor
     FROM variances ORDER BY ts, id`,
  );

  const dayLog = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, log_date AS "date", moved, decisions,
            blockers_moved AS "blockersMoved", tomorrow, ts, actor
     FROM day_log ORDER BY log_date, ts, id`,
  );

  const buildBlocks = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, block_date AS "blockDate", time_box AS "timeBox", targets,
            do_list AS "doList", do_not_list AS "doNotList", opened_at AS "openedAt",
            closed_at AS "closedAt", day_log_id::text AS "dayLogId", actor
     FROM build_blocks ORDER BY opened_at, id`,
  );

  const descopeAudit = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, descoped_on AS "date", item, line_id AS "lineId",
            solo_days_removed AS "soloDaysRemoved", reason, decision_ref AS "decisionRef",
            reversible, ts, actor
     FROM descope_audit ORDER BY descoped_on, id`,
  );

  const auditTrail = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, ts, actor, entity, entity_id AS "entityId",
            field, from_value AS "from", to_value AS "to"
     FROM audit_log ORDER BY ts, id`,
  );

  return {
    meta: {
      exportedAt: exportedAt.toISOString(),
      schemaVersion: schema.rows[0]?.version ?? 'unknown',
      service: service.name,
      serviceVersion: service.version,
      iteration: baseline?.iteration ?? 'unknown',
      estimateBaseline: baseline?.estimateBaseline ?? 'unknown',
      baselineTotals: {
        soloDays: baseline?.soloDays ?? 0,
        aiDays: baseline?.aiDays ?? 0,
        lineCount: baseline?.lineCount ?? 0,
      },
      generatedFrom: baseline?.generatedFrom ?? null,
      generatedOn: baseline?.generatedOn ?? null,
      warning: baseline?.warning ?? null,
      contents:
        'Delivery metadata only: refs, estimates, statuses, blockers, owner names. ' +
        'No resident data, health and disability values or protected characteristics. ' +
        'soloDays, aiFactor and aiDays mirror the estimates workbook and are read-only in this app.',
      counts: {
        buildLines: lines.rowCount ?? 0,
        openQuestions: questions.rowCount ?? 0,
        questionNotes: questionNotes.rowCount ?? 0,
        variances: variances.rowCount ?? 0,
        dayLog: dayLog.rowCount ?? 0,
        buildBlocks: buildBlocks.rowCount ?? 0,
        descopeAudit: descopeAudit.rowCount ?? 0,
        auditTrail: auditTrail.rowCount ?? 0,
      },
    },
    statusVocabulary: STATUS_VOCABULARY,
    blockerStatusVocabulary: BLOCKER_STATUS_VOCABULARY,
    varianceCauses: VARIANCE_CAUSES,
    buildLines: lines.rows.map(withIsoTimestamps),
    openQuestions: questions.rows.map(withIsoTimestamps),
    questionNotes: questionNotes.rows.map(withIsoTimestamps),
    variances: variances.rows.map(withIsoTimestamps),
    dayLog: dayLog.rows.map(withIsoTimestamps),
    buildBlocks: buildBlocks.rows.map(withIsoTimestamps),
    descopeAudit: descopeAudit.rows.map(withIsoTimestamps),
    auditTrail: auditTrail.rows.map(withIsoTimestamps),
  };
}

/** Dates come back as Date objects; the file should hold ISO strings. */
function withIsoTimestamps(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? iso(value) : value;
  }
  return out;
}

/** Stable, dated, and sortable in a folder full of them. */
export function exportFilename(exportedAt: Date): string {
  return `korp2-tracker-export-${exportedAt.toISOString().slice(0, 10)}.json`;
}

import type { BlockerStatus, Status } from './vocab.js';

/**
 * Shapes returned to MCP callers.
 *
 * Rule from the brief: `ref` is not unique — 110358 and 110391 each cover two
 * distinct requirements — so any output carrying a ref also carries shortName.
 * That is why every line shape below has both fields and neither is optional.
 */

/** Narrow projection used by list_lines. Page size is capped for the connector token ceiling. */
export interface LineSummary {
  id: string;
  ref: string | null;
  shortName: string;
  buildType: string | null;
  status: Status;
  aiDays: number | null;
  actualDays: number | null;
  blockers: string[];
}

/** A question as it appears attached to a line, or in list_questions. */
export interface QuestionSummary {
  ref: string;
  question: string;
  truncated: boolean;
  owner: string | null;
  neededBy: string | null;
  hardBlocker: boolean;
  status: BlockerStatus;
  lastChased: string | null;
}

export interface AuditEntry {
  ts: string;
  actor: string;
  entity: string;
  field: string;
  from: string | null;
  to: string | null;
}

export interface VarianceEntry {
  ts: string;
  estAiDays: number;
  actualDays: number;
  cause: string;
  declaredTo: string | null;
  actor: string;
}

/** Full record returned by get_line. */
export interface LineDetail extends LineSummary {
  epic: string | null;
  priority: string | null;
  owner: string | null;
  soloDays: number | null;
  aiFactor: number | null;
  confidence: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  blockerDetail: QuestionSummary[];
  warnings: Warning[];
  audit: AuditEntry[];
  variances: VarianceEntry[];
}

export type WarningCode = 'BLOCKED_WITHOUT_BLOCKERS' | 'UNBLOCKED_WITH_OPEN_HARD_BLOCKER';

export interface Warning {
  code: WarningCode;
  lineId: string;
  ref: string | null;
  shortName: string;
  detail: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  /** Offset to pass to fetch the next page, or null when this is the last page. */
  nextOffset: number | null;
}

export interface Baseline {
  iteration: string;
  estimateBaseline: string;
  soloDays: number;
  aiDays: number;
  lineCount: number;
  generatedFrom: string | null;
  generatedOn: string | null;
  warning: string | null;
}

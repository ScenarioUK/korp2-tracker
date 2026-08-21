/**
 * Mirrors of the server shapes the shell reads. Kept as a hand-written mirror
 * rather than imported from src/ because the two sides compile under different
 * tsconfigs (NodeNext vs bundler) — one small duplication is cheaper than
 * making the build understand both.
 *
 * Source of truth: src/repo/position.ts and src/repo/rail.ts.
 */

export const STATUS_VOCABULARY = [
  'NOT_STARTED',
  'BLOCKED',
  'IN_PROGRESS',
  'BUILT',
  'TESTED',
  'DONE',
  'DESCOPED',
  'NOT_MINE',
] as const;

export type Status = (typeof STATUS_VOCABULARY)[number];

/**
 * The closed cause list. TOOLING is first because it is the one that tells us
 * whether the AI co-working factors hold, and it should not be the last thing
 * the eye reaches for.
 */
export const VARIANCE_CAUSES = ['TOOLING', 'ESTIMATE_ERROR', 'DEPENDENCY_WAIT', 'AMBIGUITY', 'SCOPE'] as const;

export type VarianceCause = (typeof VARIANCE_CAUSES)[number];

export interface Position {
  iteration: string;
  estimateBaseline: string;
  baselineWarning: string | null;
  counts: Record<Status, number>;
  progress: {
    lineCount: number;
    inScope: number;
    done: number;
    outOfScope: number;
    percentComplete: number;
  };
  days: {
    baselineSoloDays: number;
    baselineAiDays: number;
    actualDaysLogged: number;
    aiDaysForLinesWithActuals: number;
    aiDaysRemaining: number;
  };
  blockers: {
    openHardBlockerCount: number;
    openHardBlockerRefs: string[];
    linesWithOpenHardBlockers: number;
  };
  warnings: { code: string; count: number; lineIds: string[] }[];
}

export interface RailBand {
  lines: number;
  aiDays: number;
}

export interface Rail {
  byStatus: Record<Status, RailBand>;
  atRisk: RailBand;
}

export interface PositionResponse {
  position: Position;
  rail: Rail;
}

export interface Warning {
  code: 'BLOCKED_WITHOUT_BLOCKERS' | 'UNBLOCKED_WITH_OPEN_HARD_BLOCKER';
  lineId: string;
  ref: string | null;
  shortName: string;
  detail: string;
}

/** One row of the Lines register. Source of truth: src/repo/lines.ts listAllLines. */
export interface LineRow {
  id: string;
  ref: string | null;
  shortName: string;
  buildType: string | null;
  priority: string | null;
  owner: string | null;
  status: Status;
  aiDays: number | null;
  actualDays: number | null;
  note: string | null;
  blockers: string[];
  openHardBlockers: string[];
  varianceCount: number;
  warnings: Warning[];
}

export interface LinesResponse {
  lines: LineRow[];
}

export interface VariancePrompt {
  aiDays: number;
  actualDays: number;
  differenceDays: number;
  message: string;
}

export interface UpdateLineResponse {
  line: LineRow & { warnings: Warning[] };
  changes: { field: string; from: string | null; to: string | null }[];
  descopeRecorded: boolean;
  varianceNeeded: VariancePrompt | null;
}

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

export interface VariancesResponse {
  variances: VarianceRow[];
}

export interface LineUpdateBody {
  status?: Status;
  actualDays?: number | null;
  note?: string | null;
  variance?: { cause: VarianceCause; note?: string | null; declaredTo?: string | null };
}

export const BLOCKER_STATUS_VOCABULARY = ['OPEN', 'CHASED', 'ANSWERED', 'CLOSED', 'SUPERSEDED'] as const;
export type BlockerStatus = (typeof BLOCKER_STATUS_VOCABULARY)[number];

/** One row of the Blockers register. Source: src/repo/questions.ts listAllQuestions. */
export interface QuestionRow {
  ref: string;
  question: string;
  truncated: boolean;
  owner: string | null;
  neededBy: string | null;
  hardBlocker: boolean;
  status: BlockerStatus;
  lastChased: string | null;
  blockedLineIds: string[];
  blockedAiDays: number;
  noteCount: number;
}

export interface QuestionsResponse {
  questions: QuestionRow[];
}

export interface UpdateQuestionResponse {
  question: QuestionRow;
  changes: { field: string; from: string | null; to: string | null }[];
  affectedLines: { id: string; ref: string | null; shortName: string; status: Status }[];
  /** Settling a question never unblocks a line by itself. This says so. */
  followUp: string | null;
}

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
  targets: BlockTarget[];
  doList: string[];
  doNotList: string[];
  openedAt: string;
  closedAt: string | null;
  dayLogId: string | null;
}

export interface BlockResponse {
  open: BuildBlock | null;
  recent: BuildBlock[];
}

export interface CloseBlockResponse {
  block: BuildBlock;
  dayLogId: string;
  date: string;
}

export interface DayLogEntry {
  id: string;
  date: string;
  moved: string | null;
  decisions: string | null;
  blockersMoved: string | null;
  tomorrow: string | null;
  ts: string;
  actor: string;
}

export interface DayLogResponse {
  entries: DayLogEntry[];
}

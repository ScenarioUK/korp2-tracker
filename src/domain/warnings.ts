import type { Warning } from './types.js';
import type { Status } from './vocab.js';

/**
 * Consistency checks from the brief §2.
 *
 * "Setting status: BLOCKED with an empty blockers array, or a non-blocked
 *  status while a linked question is OPEN and hardBlocker: true, should raise
 *  a warning in the UI and in get_position. Surface it — do not auto-resolve."
 *
 * These are warnings, never rejections. A write that trips one still succeeds
 * and returns the warning alongside the result.
 */

export interface WarningInput {
  id: string;
  ref: string | null;
  shortName: string;
  status: Status;
  /** Every question ref linked to this line. */
  blockers: string[];
  /** Subset of `blockers` whose question is currently OPEN and hardBlocker. */
  openHardBlockers: string[];
}

export function lineWarnings(line: WarningInput): Warning[] {
  const found: Warning[] = [];
  const base = { lineId: line.id, ref: line.ref, shortName: line.shortName };

  if (line.status === 'BLOCKED' && line.blockers.length === 0) {
    found.push({
      ...base,
      code: 'BLOCKED_WITHOUT_BLOCKERS',
      detail: 'Status is BLOCKED but no question is linked to this line. What is it blocked on?',
    });
  }

  // A DESCOPED line is out of scope, so an open hard blocker against it is not
  // an inconsistency. Every other non-BLOCKED status is, including NOT_MINE —
  // a hard blocker on Integration's or BI's build is still worth surfacing.
  if (line.status !== 'BLOCKED' && line.status !== 'DESCOPED' && line.openHardBlockers.length > 0) {
    found.push({
      ...base,
      code: 'UNBLOCKED_WITH_OPEN_HARD_BLOCKER',
      detail:
        `Status is ${line.status} but hard blocker(s) ${line.openHardBlockers.join(', ')} are still OPEN. ` +
        'Either the question is answered and its status is stale, or this line should be BLOCKED.',
    });
  }

  return found;
}

export function summariseWarnings(warnings: Warning[]): { code: string; count: number; lineIds: string[] }[] {
  const byCode = new Map<string, string[]>();
  for (const w of warnings) {
    const ids = byCode.get(w.code) ?? [];
    ids.push(w.lineId);
    byCode.set(w.code, ids);
  }
  return [...byCode.entries()].map(([code, lineIds]) => ({ code, count: lineIds.length, lineIds }));
}

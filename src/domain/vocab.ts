import { z } from 'zod';

/**
 * The three closed vocabularies.
 *
 * These arrays are the single source of truth. The CHECK constraints in
 * src/db/migrations mirror them, and src/seed/load.ts asserts that the
 * vocabulary arrays in docs/korp2-tracker-seed.json match them — so a seed
 * file that quietly gains a new status fails at boot instead of loading.
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

export const BLOCKER_STATUS_VOCABULARY = ['OPEN', 'CHASED', 'ANSWERED', 'CLOSED', 'SUPERSEDED'] as const;

export const VARIANCE_CAUSES = ['SCOPE', 'AMBIGUITY', 'DEPENDENCY_WAIT', 'ESTIMATE_ERROR', 'TOOLING'] as const;

export type Status = (typeof STATUS_VOCABULARY)[number];
export type BlockerStatus = (typeof BLOCKER_STATUS_VOCABULARY)[number];
export type VarianceCause = (typeof VARIANCE_CAUSES)[number];

export const statusEnum = z.enum(STATUS_VOCABULARY);
export const blockerStatusEnum = z.enum(BLOCKER_STATUS_VOCABULARY);
export const varianceCauseEnum = z.enum(VARIANCE_CAUSES);

/**
 * Progress accounting.
 *
 * DONE is the only completion state — BUILT is untested, TESTED is untested
 * against the definition of done in the brief. NOT_MINE means Integration or
 * BI owns the build, so it must not count toward progress; DESCOPED is out of
 * scope. Both are removed from the denominator, not counted as complete.
 */
export const COMPLETE_STATUSES: readonly Status[] = ['DONE'];
export const OUT_OF_PROGRESS_STATUSES: readonly Status[] = ['NOT_MINE', 'DESCOPED'];

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUS_VOCABULARY as readonly string[]).includes(value);
}

export function isBlockerStatus(value: unknown): value is BlockerStatus {
  return typeof value === 'string' && (BLOCKER_STATUS_VOCABULARY as readonly string[]).includes(value);
}

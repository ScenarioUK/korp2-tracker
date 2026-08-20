import { z } from 'zod';

/**
 * Input schema for a write tool.
 *
 * Strict: anything not named in the shape is rejected rather than silently
 * dropped. That is the first of the three defences on the read-only estimate
 * fields (the repository UPDATEs never name those columns, and the trigger in
 * 003_estimate_guard.sql is the backstop), and it means a caller that thinks it
 * changed aiDays is told otherwise instead of getting a cheerful success.
 *
 * The JSON Schema this produces carries additionalProperties: false, so the
 * constraint is visible to the client before it ever makes the call.
 */
export function writeInput<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Rejected — this tool does not accept: ${issue.keys.join(', ')}. ` +
          'soloDays, aiFactor and aiDays in particular are read-only: they mirror the estimates ' +
          'workbook, and if they need to change the workbook changes and the tracker is re-seeded. ' +
          'A difference between an estimate and reality is a variance, not a re-cut — use log_variance.'
        : undefined,
  });
}

/** A plain ISO date. Nothing here needs a time or a timezone. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date, YYYY-MM-DD.');

/**
 * Free text on a write. Bounded so a tool call cannot become a document store,
 * and every description that uses it repeats the standing rule: this holds
 * delivery metadata, never resident data, health & disability values or
 * protected characteristics.
 */
export const NO_PERSONAL_DATA =
  'Delivery metadata only. Never put resident data, health & disability values, protected ' +
  'characteristics or any other personal data in this field — the tracker is not cleared to hold it.';

export function freeText(max: number) {
  return z.string().max(max);
}

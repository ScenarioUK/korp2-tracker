/**
 * Day counts run in quarter-day steps, so one decimal is enough unless the
 * value lands on a quarter. 62 reads "62.0", 1.25 reads "1.25" — never "62.00".
 */
export function fmtDays(days: number): string {
  return Number.isInteger(days * 10) ? days.toFixed(1) : days.toFixed(2);
}

/** Clock only. The date is in the masthead's baseline tag, not on every write. */
export function fmtClock(at: Date): string {
  return at.toLocaleTimeString('en-GB', { hour12: false });
}

/** Signed day counts read as movement, so the sign is never dropped. */
export function fmtSignedDays(days: number): string {
  if (days === 0) return `±${fmtDays(0)}d`;
  return `${days > 0 ? '+' : '−'}${fmtDays(Math.abs(days))}d`;
}

export interface Variance {
  /** actual − estimate, in days. */
  days: number;
  /** (actual − estimate) / estimate, or null when there is no estimate to divide by. */
  ratio: number | null;
  /** The proportion as a signed percentage, or why there isn't one. */
  proportion: string;
}

/**
 * A variance stated two ways, because the two say different things: 0.5 days
 * over is nothing on a 6-day line and a doubling on a 0.5-day one.
 */
export function varianceOf(estimateDays: number, actualDays: number): Variance {
  const days = Math.round((actualDays - estimateDays) * 100) / 100;
  if (estimateDays === 0) {
    return { days, ratio: null, proportion: days === 0 ? '±0%' : 'no estimate to compare' };
  }
  const ratio = days / estimateDays;
  const pct = Math.round(ratio * 100);
  return { days, ratio, proportion: `${pct === 0 ? '±' : pct > 0 ? '+' : '−'}${Math.abs(pct)}%` };
}

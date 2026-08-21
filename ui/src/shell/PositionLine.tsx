import type { Position } from '../types';
import { fmtDays } from '../format';

/**
 * Brief §5's position strip: lines DONE out of 46, actual against baseline,
 * open hard blocker count. Days are signed and like-for-like; there is no
 * percentage here or anywhere else in the interface.
 */
export function PositionLine({ position }: { position: Position }): React.JSX.Element {
  const { progress, days, blockers } = position;
  const hasActuals = days.actualDaysLogged > 0 || days.aiDaysForLinesWithActuals > 0;
  const delta = days.actualDaysLogged - days.aiDaysForLinesWithActuals;

  return (
    <div className="positionline">
      <span>
        DONE <b>{progress.done}</b> / {progress.lineCount} lines
      </span>
      {progress.outOfScope > 0 ? (
        <>
          <span className="sep">·</span>
          <span>
            <b>{progress.inScope}</b> in scope · {progress.outOfScope} not mine or descoped
          </span>
        </>
      ) : null}

      <span className="sep">·</span>
      {hasActuals ? (
        <span>
          actual <b>{fmtDays(days.actualDaysLogged)}d</b> against baseline{' '}
          <b>{fmtDays(days.aiDaysForLinesWithActuals)}d</b> for the same lines{' '}
          <b>
            {delta === 0 ? '±' : delta > 0 ? '+' : '−'}
            {fmtDays(Math.abs(delta))}d
          </b>
        </span>
      ) : (
        <span>
          actual <b>—</b> against baseline <b>{fmtDays(days.baselineAiDays)}d</b> · nothing logged yet
        </span>
      )}

      <span className="sep">·</span>
      <span>
        <b>{blockers.openHardBlockerCount}</b> open hard blockers · {blockers.linesWithOpenHardBlockers} lines
      </span>

      <span className="sep">·</span>
      <span>
        {fmtDays(days.aiDaysRemaining)}d remaining of {fmtDays(days.baselineAiDays)}d
      </span>
    </div>
  );
}

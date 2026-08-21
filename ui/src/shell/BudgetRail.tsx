import type { Position, Rail, Status } from '../types';
import { fmtDays } from '../format';

/**
 * The budget rail — the signature element.
 *
 * A single 62.0 AI-day track, not a progress bar. Fill is ordered by state
 * rather than by line order, so the shape of the delivery reads left to right,
 * and one hue at four densities encodes how far along each band is: solid is
 * DONE, denser hatch is further on. No percentage appears anywhere.
 */

/** Fill order along the track. Not the vocabulary order — this is the journey. */
const TRACK_ORDER: readonly Status[] = ['DONE', 'TESTED', 'BUILT', 'IN_PROGRESS', 'BLOCKED', 'NOT_STARTED'];

/**
 * Severed from the track: their days are in the v5 baseline but must never
 * count toward progress. NOT_MINE is Integration's or BI's build; DESCOPED is
 * out of scope. Shown beyond a hairline gap so the exclusion is visible.
 */
const SEVERED_ORDER: readonly Status[] = ['NOT_MINE', 'DESCOPED'];

const LABELS: Record<Status, string> = {
  DONE: 'done',
  TESTED: 'tested',
  BUILT: 'built',
  IN_PROGRESS: 'in progress',
  BLOCKED: 'blocked',
  NOT_STARTED: 'not started',
  NOT_MINE: 'not mine',
  DESCOPED: 'descoped',
};

/** Width of the hairline break between the track and the severed stub. */
const GAP_PCT = 1.2;
/** Below this a segment is too narrow to hold its own label legibly. */
const LABEL_MIN_PCT = 9;
const SCALE_DIVISIONS = 5;

export function BudgetRail({ position, rail }: { position: Position; rail: Rail }): React.JSX.Element {
  const baseline = position.days.baselineAiDays;

  const severedBands = SEVERED_ORDER.map((status) => ({ status, ...rail.byStatus[status] })).filter(
    (band) => band.aiDays > 0,
  );
  const severedDays = severedBands.reduce((sum, band) => sum + band.aiDays, 0);
  const severedLines = severedBands.reduce((sum, band) => sum + band.lines, 0);
  const trackDays = baseline - severedDays;

  const usable = severedDays > 0 ? 100 - GAP_PCT : 100;
  const pct = (days: number): number => (baseline > 0 ? (days / baseline) * usable : 0);
  /**
   * The axis runs 0–62 continuously; the gap is a visual break inserted at the
   * point where the severed days start, so anything past it shifts by the gap.
   */
  const axis = (days: number): number => pct(days) + (days > trackDays ? GAP_PCT : 0);

  const trackBands = TRACK_ORDER.map((status) => ({ status, ...rail.byStatus[status] })).filter(
    (band) => band.aiDays > 0,
  );

  const { actualDaysLogged, aiDaysForLinesWithActuals } = position.days;
  const hasActuals = actualDaysLogged > 0 || aiDaysForLinesWithActuals > 0;
  const delta = actualDaysLogged - aiDaysForLinesWithActuals;

  const scale = Array.from({ length: SCALE_DIVISIONS + 1 }, (_, i) => (baseline / SCALE_DIVISIONS) * i);

  return (
    <div className="rail" role="img" aria-label={railSentence(position, rail)}>
      <div className="rail__scale" aria-hidden="true">
        <span className="rail__scale-mark rail__scale-mark--first" style={{ left: 0 }}>
          AI-DAYS 0
        </span>
        {scale.slice(1).map((value, i) => (
          <span
            key={value}
            className={`rail__scale-mark${i === SCALE_DIVISIONS - 1 ? ' rail__scale-mark--last' : ''}`}
            style={{ left: `${axis(value)}%` }}
          >
            {fmtDays(value)}
          </span>
        ))}
      </div>

      {/*
        The marks get their own rows rather than overflowing the track, so the
        scale numerals and the labels never collide. All rows share the rail's
        padding, so a left percentage means the same x in every one of them.
      */}
      <div className="rail__marks rail__marks--above" aria-hidden="true">
        {hasActuals ? (
          <div className="rail__mark rail__mark--baseline" style={{ left: `${axis(aiDaysForLinesWithActuals)}%` }}>
            baseline {fmtDays(aiDaysForLinesWithActuals)}
          </div>
        ) : null}
      </div>

      <div className="rail__track">
        <div className="rail__run" style={{ width: `${pct(trackDays)}%` }}>
          {trackBands.map((band) => {
            const width = pct(band.aiDays);
            return (
              <div
                key={band.status}
                className={`seg seg--${band.status}`}
                style={{ width: `${(band.aiDays / trackDays) * 100}%` }}
                title={`${LABELS[band.status]} — ${fmtDays(band.aiDays)} AI-days, ${band.lines} lines`}
              >
                {width >= LABEL_MIN_PCT ? (
                  <span className="seg__label">
                    {LABELS[band.status]} {fmtDays(band.aiDays)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {severedDays > 0 ? (
          <>
            <div className="rail__gap" style={{ width: `${GAP_PCT}%` }} />
            <div
              className="rail__stub"
              style={{ width: `${pct(severedDays)}%` }}
              title={`severed from the track — ${severedLines} lines, ${fmtDays(severedDays)} AI-days, not counted toward progress`}
            >
              {severedBands.map((b) => LABELS[b.status]).join(' + ')} {fmtDays(severedDays)}
            </div>
          </>
        ) : null}
      </div>

      <div className="rail__marks rail__marks--below" aria-hidden="true">
        {hasActuals ? (
          <div className="rail__mark rail__mark--actual" style={{ left: `${axis(actualDaysLogged)}%` }}>
            actual {fmtDays(actualDaysLogged)} {signed(delta)}
          </div>
        ) : null}
      </div>

      <div className="rail__legend">
        {trackBands.map((band) => (
          <span key={band.status}>
            {LABELS[band.status]} <b>{fmtDays(band.aiDays)}</b> · {band.lines} lines
          </span>
        ))}
        {severedDays > 0 ? (
          <span>
            severed <b>{fmtDays(severedDays)}</b> · {severedLines} lines
          </span>
        ) : null}
        <span>
          {/* Like-for-like, in days, signed. Never a percentage. */}
          {hasActuals ? (
            <>
              actual against baseline <b>{signed(delta)}</b>
            </>
          ) : (
            'no actual days logged yet'
          )}
        </span>
      </div>

      <div className="rail__atrisk">
        <div className="rail__atrisk-scale" aria-hidden="true" />
        <div className="rail__atrisk-bar" style={{ width: `${pct(rail.atRisk.aiDays)}%` }} aria-hidden="true" />
        <span className="rail__atrisk-label">
          {rail.atRisk.aiDays > 0 ? (
            <>
              AT RISK {fmtDays(rail.atRisk.aiDays)} of {fmtDays(baseline)} · {rail.atRisk.lines} lines{' '}
              <span className="rail__atrisk-refs">behind {position.blockers.openHardBlockerRefs.join(' ')}</span>
            </>
          ) : (
            <span className="rail__atrisk-refs">nothing behind an open hard blocker</span>
          )}
        </span>
      </div>
    </div>
  );
}

function signed(days: number): string {
  if (days === 0) return `±${fmtDays(0)}d`;
  return `${days > 0 ? '+' : '−'}${fmtDays(Math.abs(days))}d`;
}

/**
 * The rail says the same sentence to a screen reader that it draws, including
 * the at-risk figure — status is never carried by colour alone.
 */
function railSentence(position: Position, rail: Rail): string {
  const bands = [...TRACK_ORDER, ...SEVERED_ORDER]
    .map((status) => ({ status, ...rail.byStatus[status] }))
    .filter((band) => band.aiDays > 0)
    .map((band) => `${LABELS[band.status]} ${fmtDays(band.aiDays)} days across ${band.lines} lines`)
    .join('; ');

  const refs = position.blockers.openHardBlockerRefs;
  const risk =
    rail.atRisk.aiDays > 0
      ? `${fmtDays(rail.atRisk.aiDays)} of ${fmtDays(position.days.baselineAiDays)} AI-days are behind ${
          refs.length
        } open hard blockers: ${refs.join(', ')}.`
      : 'No AI-days are behind an open hard blocker.';

  const actuals =
    position.days.actualDaysLogged > 0 || position.days.aiDaysForLinesWithActuals > 0
      ? `Actual ${fmtDays(position.days.actualDaysLogged)} days against a baseline of ${fmtDays(
          position.days.aiDaysForLinesWithActuals,
        )} days for the same lines.`
      : 'No actual days logged yet.';

  return `Budget rail. Baseline ${fmtDays(position.days.baselineAiDays)} AI-days. ${bands}. ${risk} ${actuals}`;
}

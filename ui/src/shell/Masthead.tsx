import type { Position } from '../types';
import { fmtClock } from '../format';

/**
 * The v6 caveat is not a dismissible banner. The seed says re-baseline before
 * reading actuals as variance, and the masthead is the one place that warning
 * cannot be scrolled away from.
 */
export function Masthead({ position, loadedAt }: { position: Position; loadedAt: Date }): React.JSX.Element {
  return (
    <header className="masthead">
      <div>
        <span className="masthead__name">{position.iteration.toUpperCase()}</span>
        <span className="sep"> · </span>
        <span className="quiet">baseline {position.estimateBaseline}</span>
      </div>
      <div className="masthead__right">
        {position.baselineWarning ? (
          <span className="caveat" title={position.baselineWarning}>
            ▲ v6 PENDING, WILL INCREASE
          </span>
        ) : null}
        <span>loaded {fmtClock(loadedAt)}</span>
      </div>
    </header>
  );
}

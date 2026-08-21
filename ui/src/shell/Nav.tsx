import type { Position } from '../types';

/**
 * Five views. Text only — no icon sidebar, and the active state is weight plus
 * a bone underline rather than a colour, because colour encodes status.
 */
export const VIEWS = ['LINES', 'BLOCKERS', 'VARIANCES', 'TODAY', 'LOG'] as const;
export type View = (typeof VIEWS)[number];

export function Nav({
  view,
  onChange,
  position,
}: {
  view: View;
  onChange: (next: View) => void;
  position: Position;
}): React.JSX.Element {
  const counts: Record<View, string | null> = {
    LINES: String(position.progress.lineCount),
    BLOCKERS: `${position.blockers.openHardBlockerCount} hard`,
    VARIANCES: null,
    TODAY: null,
    LOG: null,
  };

  return (
    <nav className="nav" aria-label="Views">
      {VIEWS.map((item) => (
        <button
          key={item}
          type="button"
          className="nav__item"
          aria-current={item === view ? 'page' : undefined}
          onClick={() => onChange(item)}
        >
          {item}
          {counts[item] ? <span className="nav__count">{counts[item]}</span> : null}
        </button>
      ))}
    </nav>
  );
}

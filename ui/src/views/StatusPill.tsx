import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STATUS_VOCABULARY, type Status } from '../types';

/**
 * One hue at four densities, plus one alarm. Colour never carries the meaning
 * on its own — every pill also carries its word, so the encoding survives
 * greyscale, colour blindness and a screen reader.
 *
 * The keys are the vocabulary's own order, which is why there are exactly
 * eight and nothing is left over.
 */
export const STATUS_KEYS: Record<Status, string> = Object.fromEntries(
  STATUS_VOCABULARY.map((status, i) => [status, String(i + 1)]),
) as Record<Status, string>;

export function StatusPill({ status }: { status: Status }): React.JSX.Element {
  return <span className={`pill pill--${status}`}>{status}</span>;
}

/**
 * Changing status is a menu anchored to the cell, not a modal: nothing dims,
 * nothing moves, and the row you are editing stays where it was.
 */
export function StatusMenu({
  current,
  onPick,
  onDismiss,
}: {
  current: Status;
  onPick: (next: Status) => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);

  // The grid scrolls, so a menu opened on a low row would be clipped by it.
  useLayoutEffect(() => {
    const menu = ref.current;
    const grid = menu?.closest('.grid');
    if (!menu || !grid) return;
    setFlip(menu.getBoundingClientRect().bottom > grid.getBoundingClientRect().bottom);
  }, []);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[data-current="true"]')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };
    const onPointer = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [onDismiss]);

  return (
    <div className={`statusmenu${flip ? ' statusmenu--flip' : ''}`} ref={ref} role="menu" aria-label="Set status">
      {STATUS_VOCABULARY.map((status) => (
        <button
          key={status}
          type="button"
          role="menuitem"
          className="statusmenu__item"
          data-current={status === current}
          onClick={() => onPick(status)}
        >
          <span className="statusmenu__key">{STATUS_KEYS[status]}</span>
          <StatusPill status={status} />
          {status === 'DESCOPED' ? <span className="statusmenu__gate">needs a note</span> : null}
          {status === current ? <span className="statusmenu__gate">current</span> : null}
        </button>
      ))}
    </div>
  );
}

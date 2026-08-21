import { useEffect, useRef } from 'react';
import { fmtDays, fmtSignedDays, varianceOf } from '../format';
import { VARIANCE_CAUSES, type LineRow, type Status, type VarianceCause } from '../types';

/**
 * The two gated writes, both as sub-rows inside the table rather than modals:
 * the row you are editing stays where it is and nothing dims.
 */

export interface DaysDraft {
  kind: 'DAYS';
  id: string;
  /** The status this write is heading for, or null when only days are changing. */
  toStatus: Status | null;
  actual: string;
  cause: VarianceCause | null;
  note: string;
  declaredTo: string;
}

export interface DescopeDraft {
  kind: 'DESCOPE';
  id: string;
  note: string;
}

export type Draft = DaysDraft | DescopeDraft;

/** Empty is a real value — it means "no actual recorded", not zero. */
export function parseDays(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= 999 ? Math.round(value * 100) / 100 : null;
}

/**
 * Whether this write needs a cause before it can be saved: DONE, off its
 * estimate, and not already explained by a variance on file. Mirrors the rule
 * updateLine enforces inside the transaction, so the form never demands
 * something the server would not, or lets through something it would refuse.
 */
export function needsCause(line: LineRow, draft: DaysDraft): boolean {
  const status = draft.toStatus ?? line.status;
  const actual = parseDays(draft.actual);
  return (
    status === 'DONE' &&
    actual !== null &&
    line.aiDays !== null &&
    actual !== line.aiDays &&
    line.varianceCount === 0
  );
}

export function daysDraftIsValid(line: LineRow, draft: DaysDraft): boolean {
  const status = draft.toStatus ?? line.status;
  const actual = parseDays(draft.actual);
  // Reaching DONE without saying how long it took is not a completion.
  if (status === 'DONE' && actual === null) return false;
  if (draft.actual.trim() !== '' && actual === null) return false;
  return !needsCause(line, draft) || draft.cause !== null;
}

export function DaysEditor({
  line,
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  line: LineRow;
  draft: DaysDraft;
  onChange: (next: DaysDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}): React.JSX.Element {
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);

  const actual = parseDays(draft.actual);
  const estimate = line.aiDays;
  const showVariance = actual !== null && estimate !== null && actual !== estimate;
  const variance = showVariance ? varianceOf(estimate, actual) : null;
  const causeRequired = needsCause(line, draft);
  const valid = daysDraftIsValid(line, draft);

  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !saving) onSave();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="editor__line">
        <span className="editor__lead">
          {line.id}
          {draft.toStatus ? ` → ${draft.toStatus}` : ' · actual days'}
        </span>
        <span className="editor__label">estimate</span>
        <span className="editor__figure">{estimate === null ? '—' : `${fmtDays(estimate)}d`}</span>
        <span className="editor__label">actual</span>
        <input
          ref={first}
          className="editor__days"
          value={draft.actual}
          inputMode="decimal"
          placeholder="0.00"
          aria-label="Actual days"
          onChange={(event) => onChange({ ...draft, actual: event.target.value })}
        />

        {/* Days and proportion together: 0.5 over is nothing on a 6-day line
            and a doubling on a 0.5-day one. */}
        {variance ? (
          <>
            <span className="editor__variance">{fmtSignedDays(variance.days)}</span>
            <span className="editor__variance">{variance.proportion}</span>
            <VarianceBar ratio={variance.ratio} />
          </>
        ) : (
          <span className="editor__label">
            {actual === null ? 'days it actually took' : 'on estimate — no cause needed'}
          </span>
        )}
      </div>

      {causeRequired ? (
        <div className="editor__line">
          <span className="editor__lead editor__lead--required">cause</span>
          {VARIANCE_CAUSES.map((cause) => (
            <button
              key={cause}
              type="button"
              className="cause"
              aria-pressed={draft.cause === cause}
              onClick={() => onChange({ ...draft, cause })}
              title={
                cause === 'TOOLING'
                  ? 'The difference came from the AI co-working itself. This is the one that validates the factors.'
                  : undefined
              }
            >
              {cause}
            </button>
          ))}
        </div>
      ) : null}

      <div className="editor__line">
        {causeRequired ? (
          <>
            <span className="editor__label">note</span>
            <input
              className="editor__text"
              value={draft.note}
              placeholder="what actually happened (optional)"
              aria-label="Variance note"
              onChange={(event) => onChange({ ...draft, note: event.target.value })}
            />
            <span className="editor__label">declared to</span>
            <input
              className="editor__who"
              value={draft.declaredTo}
              placeholder="optional"
              aria-label="Declared to"
              onChange={(event) => onChange({ ...draft, declaredTo: event.target.value })}
            />
          </>
        ) : (
          <span className="editor__spacer" />
        )}
        <button type="submit" className="gate__submit" disabled={!valid || saving}>
          {saving ? 'SAVING' : 'SAVE'}
        </button>
        <button type="button" className="linkish" onClick={onCancel}>
          cancel
        </button>
      </div>

      {causeRequired && draft.cause === null ? (
        <p className="editor__why text">
          A cause is required before this saves. It is how the AI co-working factors get validated against reality
          instead of asserted — the estimate itself never changes.
        </p>
      ) : null}
    </form>
  );
}

/**
 * Zero-centred, greyscale — a cause is not a status, so it gets no colour.
 * Clamped at ±100% of the estimate so a 10× overrun cannot push the scale flat.
 */
function VarianceBar({ ratio }: { ratio: number | null }): React.JSX.Element {
  if (ratio === null) return <span className="editor__label">no estimate to compare</span>;
  const clamped = Math.max(-1, Math.min(1, ratio));
  const width = Math.abs(clamped) * 50;
  return (
    <span className="vbar" aria-hidden="true">
      <span className="vbar__zero" />
      <span
        className="vbar__fill"
        style={clamped < 0 ? { right: '50%', width: `${width}%` } : { left: '50%', width: `${width}%` }}
      />
      {Math.abs(ratio) > 1 ? <span className="vbar__over">▸</span> : null}
    </span>
  );
}

export function DescopeEditor({
  line,
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  line: LineRow;
  draft: DescopeDraft;
  onChange: (next: DescopeDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}): React.JSX.Element {
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.note.trim() !== '' && !saving) onSave();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="editor__line">
        <span className="editor__lead">{line.id} → DESCOPED</span>
        <span className="editor__label">
          Nothing is deleted; this needs a reason, and it is written to the descope audit.
        </span>
        <input
          ref={first}
          className="editor__text"
          value={draft.note}
          placeholder="why is this coming out of scope?"
          aria-label="Descope reason"
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
        <button type="submit" className="gate__submit" disabled={draft.note.trim() === '' || saving}>
          {saving ? 'SAVING' : 'SAVE'}
        </button>
        <button type="button" className="linkish" onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}

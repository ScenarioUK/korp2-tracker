import { useCallback, useEffect, useState } from 'react';
import { RuleViolation, Unauthorized, apiGet, apiPatch, apiPost } from '../api';
import { fmtDays } from '../format';
import type { BlockResponse, BuildBlock, CloseBlockResponse } from '../types';
import { StatusPill } from './StatusPill';

/**
 * Today: the current build block.
 *
 * The do-not-do list is the part that earns its place. A list of what a session
 * is for is a plan; a list of what it is explicitly not for is the thing that
 * survives contact with an interesting distraction at 11am.
 *
 * Closing the block prompts for the day log entry and writes both together, so
 * a block cannot quietly end with no record of what came of it.
 */

interface Draft {
  timeBox: string;
  targets: string;
  doList: string;
  doNotList: string;
}

interface CloseDraft {
  moved: string;
  decisions: string;
  blockersMoved: string;
  tomorrow: string;
}

const EMPTY_CLOSE: CloseDraft = { moved: '', decisions: '', blockersMoved: '', tomorrow: '' };

const toDraft = (block: BuildBlock | null): Draft => ({
  timeBox: block?.timeBox ?? '',
  targets: (block?.targets ?? []).map((t) => t.id).join(' '),
  doList: (block?.doList ?? []).join('\n'),
  doNotList: (block?.doNotList ?? []).join('\n'),
});

const lines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

const ids = (value: string): string[] =>
  value
    .split(/[\s,]+/)
    .map((id) => id.trim().toUpperCase())
    .filter((id) => id !== '');

export function TodayView({ token, onDataChanged }: { token: string; onDataChanged: () => void }): React.JSX.Element {
  const [block, setBlock] = useState<BuildBlock | null>(null);
  const [recent, setRecent] = useState<BuildBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft(null));
  const [closing, setClosing] = useState<CloseDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await apiGet<BlockResponse>('/block', token);
      setBlock(data.open);
      setRecent(data.recent);
      setDraft(toDraft(data.open));
      setLoaded(true);
    } catch (cause) {
      if (cause instanceof Unauthorized) return;
      setError((cause as Error).message);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (work: () => Promise<void>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await work();
      } catch (cause) {
        if (cause instanceof Unauthorized) return;
        setError(cause instanceof RuleViolation ? cause.message : `Could not save. ${(cause as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const body = (): Record<string, unknown> => ({
    timeBox: draft.timeBox.trim() || null,
    targets: ids(draft.targets),
    doList: lines(draft.doList),
    doNotList: lines(draft.doNotList),
  });

  const start = (): void =>
    void run(async () => {
      const result = await apiPost<{ block: BuildBlock }>('/block', token, body());
      setBlock(result.block);
      setDraft(toDraft(result.block));
      setNotice(null);
    });

  const save = (): void =>
    void run(async () => {
      const result = await apiPatch<{ block: BuildBlock }>('/block', token, body());
      setBlock(result.block);
      setDraft(toDraft(result.block));
      setNotice('Block saved.');
    });

  const close = (): void =>
    void run(async () => {
      if (!closing || closing.moved.trim() === '') return;
      const result = await apiPost<CloseBlockResponse>('/block/close', token, {
        moved: closing.moved.trim(),
        decisions: closing.decisions.trim() || null,
        blockersMoved: closing.blockersMoved.trim() || null,
        tomorrow: closing.tomorrow.trim() || null,
      });
      setClosing(null);
      setNotice(`Block closed and logged to ${result.date}. It is in the LOG view.`);
      onDataChanged();
      await load();
    });

  if (error && !loaded) {
    return (
      <main className="view">
        <p className="gate__error text" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!loaded) return <div className="loading">LOADING BLOCK…</div>;

  const unresolved = ids(draft.targets).filter((id) => !(block?.targets ?? []).some((t) => t.id === id));

  return (
    <main className="view view--today">
      <div className="today">
        <section className="panel">
          <h2 className="panel__title">
            {block ? 'BLOCK OPEN' : 'NO BLOCK OPEN'}
            <span className="panel__hint">
              {block
                ? `${block.blockDate}${block.timeBox ? ` · ${block.timeBox}` : ''} · opened ${block.openedAt.slice(11, 16)}`
                : 'start one to fix what this session is for — and what it is not'}
            </span>
          </h2>

          <div className="field">
            <label className="field__label" htmlFor="timebox">
              TIME BOX
            </label>
            <input
              id="timebox"
              className="field__input"
              value={draft.timeBox}
              placeholder="09:30–12:30"
              onChange={(event) => setDraft({ ...draft, timeBox: event.target.value })}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="targets">
              TARGET LINES
            </label>
            <input
              id="targets"
              className="field__input"
              value={draft.targets}
              placeholder="L02 L05 L26"
              onChange={(event) => setDraft({ ...draft, targets: event.target.value })}
            />
          </div>

          {/* Ids resolved to their names: an id on its own does not say what it is. */}
          {block && block.targets.length > 0 ? (
            <ul className="targets">
              {block.targets.map((target) => (
                <li key={target.id} className="targets__row">
                  <span className="targets__id">{target.id}</span>
                  <span className="targets__ref">{target.ref ?? '—'}</span>
                  <span className="targets__name text">{target.shortName}</span>
                  <StatusPill status={target.status} />
                  <span className="targets__days">
                    {target.aiDays === null ? '—' : `${fmtDays(target.aiDays)}d`}
                    {target.actualDays === null ? '' : ` · actual ${fmtDays(target.actualDays)}d`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {unresolved.length > 0 ? (
            <p className="field__note text">
              {unresolved.join(', ')} {unresolved.length === 1 ? 'is' : 'are'} not saved yet — press{' '}
              {block ? 'SAVE BLOCK' : 'START BLOCK'} to resolve {unresolved.length === 1 ? 'it' : 'them'}.
            </p>
          ) : null}
        </section>

        <section className="panel">
          <h2 className="panel__title">
            DO
            <span className="panel__hint">one per line</span>
          </h2>
          <textarea
            className="field__area"
            value={draft.doList}
            rows={6}
            aria-label="Do list"
            placeholder={'Schema for L02\nUnit tests for L05'}
            onChange={(event) => setDraft({ ...draft, doList: event.target.value })}
          />
        </section>

        <section className="panel panel--donot">
          <h2 className="panel__title">
            DO NOT
            <span className="panel__hint">the list that protects the block</span>
          </h2>
          <textarea
            className="field__area"
            value={draft.doNotList}
            rows={6}
            aria-label="Do not do list"
            placeholder={'Do not start L04 — G11 is open\nDo not refactor the plugin scaffold'}
            onChange={(event) => setDraft({ ...draft, doNotList: event.target.value })}
          />
        </section>
      </div>

      <div className="today__actions">
        {block ? (
          <>
            <button type="button" className="gate__submit" onClick={save} disabled={busy}>
              {busy ? 'SAVING' : 'SAVE BLOCK'}
            </button>
            <button
              type="button"
              className="gate__submit"
              onClick={() => setClosing(closing ? null : EMPTY_CLOSE)}
              disabled={busy}
            >
              {closing ? 'KEEP IT OPEN' : 'CLOSE BLOCK…'}
            </button>
          </>
        ) : (
          <button type="button" className="gate__submit" onClick={start} disabled={busy}>
            {busy ? 'STARTING' : 'START BLOCK'}
          </button>
        )}
        {notice ? <span className="today__notice">{notice}</span> : null}
        {error ? (
          <span className="today__error text" role="alert">
            {error}
          </span>
        ) : null}
        <span className="filters__spacer" />
        {recent[0] ? (
          <span className="quiet">
            last block {recent[0].blockDate}
            {recent[0].timeBox ? ` · ${recent[0].timeBox}` : ''} · {recent[0].targets.length} target
            {recent[0].targets.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {closing ? (
        <form
          className="closing"
          onSubmit={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <h2 className="panel__title">
            END OF BLOCK
            <span className="panel__hint">
              written to the day log in the same transaction as the close — a block cannot end with no record
            </span>
          </h2>

          <div className="closing__grid">
            <label className="field">
              <span className="field__label">WHAT MOVED · required</span>
              <textarea
                className="field__area"
                rows={3}
                autoFocus
                value={closing.moved}
                placeholder="L02 schema built and tested, L05 half-built"
                onChange={(event) => setClosing({ ...closing, moved: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">DECISIONS BANKED</span>
              <textarea
                className="field__area"
                rows={3}
                value={closing.decisions}
                placeholder="Related tables for conditions, per R1"
                onChange={(event) => setClosing({ ...closing, decisions: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">BLOCKERS MOVED</span>
              <textarea
                className="field__area"
                rows={3}
                value={closing.blockersMoved}
                placeholder="G3 chased, nothing back"
                onChange={(event) => setClosing({ ...closing, blockersMoved: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">TOMORROW</span>
              <textarea
                className="field__area"
                rows={3}
                value={closing.tomorrow}
                placeholder="Finish L05, start L26"
                onChange={(event) => setClosing({ ...closing, tomorrow: event.target.value })}
              />
            </label>
          </div>

          <div className="today__actions">
            <button type="submit" className="gate__submit" disabled={busy || closing.moved.trim() === ''}>
              {busy ? 'CLOSING' : 'CLOSE AND LOG'}
            </button>
            <button type="button" className="linkish" onClick={() => setClosing(null)}>
              cancel
            </button>
            {closing.moved.trim() === '' ? <span className="quiet">“what moved” is required</span> : null}
          </div>
        </form>
      ) : null}
    </main>
  );
}

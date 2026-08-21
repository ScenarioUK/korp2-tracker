import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RuleViolation, Unauthorized, apiGet, apiPatch } from '../api';
import { fmtDays } from '../format';
import {
  STATUS_VOCABULARY,
  type LineRow,
  type LineUpdateBody,
  type LinesResponse,
  type Status,
  type UpdateLineResponse,
} from '../types';
import { DaysEditor, DescopeEditor, daysDraftIsValid, needsCause, parseDays, type Draft } from './LineEditors';
import { FilterStrip, NO_FILTERS, applyFilters, type Filters } from './FilterStrip';
import { StatusMenu, StatusPill } from './StatusPill';

/**
 * The Lines register: all 46 build lines in one table.
 *
 * Filtering and sorting happen here rather than on the server. 46 rows arrive
 * in one response, so a round trip per keystroke would buy nothing and cost
 * the instant feel that makes the table usable.
 */

type SortKey =
  | 'id'
  | 'ref'
  | 'shortName'
  | 'buildType'
  | 'priority'
  | 'owner'
  | 'aiDays'
  | 'actualDays'
  | 'status'
  | 'blockers';

interface Column {
  key: SortKey;
  label: string;
  className: string;
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'id', label: 'ID', className: 'c-id' },
  { key: 'ref', label: 'REF', className: 'c-ref' },
  { key: 'shortName', label: 'NAME', className: 'c-name' },
  { key: 'buildType', label: 'TYPE', className: 'c-type' },
  { key: 'priority', label: 'PRI', className: 'c-pri' },
  { key: 'owner', label: 'OWNER', className: 'c-owner' },
  { key: 'aiDays', label: 'AI', className: 'c-num', numeric: true },
  { key: 'actualDays', label: 'ACT', className: 'c-num', numeric: true },
  { key: 'status', label: 'STATUS', className: 'c-status' },
  { key: 'blockers', label: 'BLOCKERS', className: 'c-blockers' },
];

/** MoSCoW is an order, not an alphabet — sorting it as text reads as nonsense. */
const PRIORITY_RANK: Record<string, number> = { Must: 0, Should: 1, Could: 2, Want: 3 };

function compare(a: LineRow, b: LineRow, key: SortKey): number {
  const nulls = (x: unknown, y: unknown): number | null => {
    const xn = x === null || x === undefined;
    const yn = y === null || y === undefined;
    if (xn && yn) return 0;
    if (xn) return 1; // absent values sort last whichever way the column points
    if (yn) return -1;
    return null;
  };

  switch (key) {
    case 'aiDays':
    case 'actualDays': {
      const n = nulls(a[key], b[key]);
      return n ?? (a[key] as number) - (b[key] as number);
    }
    case 'blockers':
      return a.blockers.length - b.blockers.length || a.openHardBlockers.length - b.openHardBlockers.length;
    case 'status':
      return STATUS_VOCABULARY.indexOf(a.status) - STATUS_VOCABULARY.indexOf(b.status);
    case 'priority': {
      const n = nulls(a.priority, b.priority);
      return n ?? (PRIORITY_RANK[a.priority as string] ?? 99) - (PRIORITY_RANK[b.priority as string] ?? 99);
    }
    case 'ref': {
      const n = nulls(a.ref, b.ref);
      if (n !== null) return n;
      // Refs are numeric strings; compare them as numbers so 110358 < 110537.
      return Number.parseInt(a.ref as string, 10) - Number.parseInt(b.ref as string, 10);
    }
    default: {
      const n = nulls(a[key], b[key]);
      return n ?? String(a[key]).localeCompare(String(b[key]), 'en-GB');
    }
  }
}

export function LinesView({ token, onDataChanged }: { token: string; onDataChanged: () => void }): React.JSX.Element {
  const [lines, setLines] = useState<LineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'id', dir: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
/**
   * A staged write that cannot commit yet: DESCOPED needs a note, and DONE off
   * its estimate needs a cause. Everything else commits on the keystroke.
   */
  const [draft, setDraft] = useState<Draft | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<LinesResponse>('/lines', token)
      .then((data) => setLines(data.lines))
      .catch((cause: unknown) => {
        if (cause instanceof Unauthorized) return; // App handles the sign-out
        setError((cause as Error).message);
      });
  }, [token]);

  const visible = useMemo(() => {
    if (!lines) return [];
    const filtered = applyFilters(lines, filters);
    return [...filtered].sort((a, b) => compare(a, b, sort.key) * sort.dir || a.id.localeCompare(b.id));
  }, [lines, filters, sort]);

  /** Refs are not unique: 110358 and 110391 each cover two distinct requirements. */
  const sharedRefs = useMemo(() => {
    const seen = new Map<string, string[]>();
    for (const line of lines ?? []) {
      if (!line.ref) continue;
      seen.set(line.ref, [...(seen.get(line.ref) ?? []), line.id]);
    }
    return new Map([...seen].filter(([, ids]) => ids.length > 1));
  }, [lines]);

  const commit = useCallback(
    async (id: string, body: LineUpdateBody): Promise<void> => {
      setSaving(id);
      setRowError(null);
      try {
        const result = await apiPatch<UpdateLineResponse>(`/lines/${id}`, token, body);
        setLines((current) => current?.map((line) => (line.id === id ? { ...line, ...result.line } : line)) ?? null);
        setDraft(null);
        setMenuFor(null);
        onDataChanged(); // the rail and the position line move with it
      } catch (cause) {
        if (cause instanceof Unauthorized) return;
        setRowError({
          id,
          message: cause instanceof RuleViolation ? cause.message : `Could not save. ${(cause as Error).message}`,
        });
      } finally {
        setSaving(null);
      }
    },
    [token, onDataChanged],
  );

  /**
   * Two statuses stage instead of committing. DESCOPED needs a reason, because
   * nothing is ever deleted and removing scope is a decision. DONE needs the
   * days it took, and a cause when those days differ from the estimate. Every
   * other status commits on the keystroke.
   */
  const setStatus = useCallback(
    (id: string, next: Status): void => {
      setMenuFor(null);
      const line = lines?.find((l) => l.id === id);
      if (!line || line.status === next) return;
      setSelected(id);

      if (next === 'DESCOPED') {
        setDraft({ kind: 'DESCOPE', id, note: '' });
        return;
      }
      if (next === 'DONE') {
        setDraft({
          kind: 'DAYS',
          id,
          toStatus: 'DONE',
          actual: line.actualDays === null ? '' : String(line.actualDays),
          cause: null,
          note: '',
          declaredTo: '',
        });
        return;
      }
      void commit(id, { status: next });
    },
    [lines, commit],
  );

  /** `a` records the days a line took without moving it on. */
  const editDays = useCallback(
    (id: string): void => {
      const line = lines?.find((l) => l.id === id);
      if (!line) return;
      setMenuFor(null);
      setDraft({
        kind: 'DAYS',
        id,
        toStatus: null,
        actual: line.actualDays === null ? '' : String(line.actualDays),
        cause: null,
        note: '',
        declaredTo: '',
      });
    },
    [lines],
  );

  const saveDraft = useCallback((): void => {
    if (!draft || !lines) return;
    const line = lines.find((l) => l.id === draft.id);
    if (!line) return;

    if (draft.kind === 'DESCOPE') {
      if (draft.note.trim() === '') return;
      void commit(draft.id, { status: 'DESCOPED', note: draft.note.trim() });
      return;
    }

    if (!daysDraftIsValid(line, draft)) return;
    const body: LineUpdateBody = { actualDays: parseDays(draft.actual) };
    if (draft.toStatus) body.status = draft.toStatus;
    if (needsCause(line, draft) && draft.cause) {
      body.variance = {
        cause: draft.cause,
        note: draft.note.trim() || null,
        declaredTo: draft.declaredTo.trim() || null,
      };
    }
    void commit(draft.id, body);
  }, [draft, lines, commit]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (draft || menuFor) return;
    const index = visible.findIndex((line) => line.id === selected);

    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(visible[Math.min(index + 1, visible.length - 1)]?.id ?? visible[0]?.id ?? null);
      return;
    }
    if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(visible[Math.max(index - 1, 0)]?.id ?? null);
      return;
    }
    if (event.key === 'Escape') {
      setSelected(null);
      setRowError(null);
      return;
    }
    if (event.key === 'a' && selected) {
      event.preventDefault();
      editDays(selected);
      return;
    }

    const status = STATUS_VOCABULARY[Number.parseInt(event.key, 10) - 1];
    if (status && selected) {
      event.preventDefault();
      setStatus(selected, status);
    }
  };

  if (error) {
    return (
      <main className="view">
        <p className="gate__error text" role="alert">
          {error}
        </p>
      </main>
    );
  }

  if (!lines) return <div className="loading">LOADING LINES…</div>;

  return (
    <main className="view view--lines">
      <FilterStrip lines={lines} filters={filters} onChange={setFilters} shown={visible.length} />

      <div
        className="grid"
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="group"
        aria-label="Build lines. Select a row and press 1 to 8 to set its status."
      >
        <table className="lines">
          <caption className="visually-hidden">
            All KORP2 Iteration 1 build lines. A ref is not unique, so every ref is shown beside its short name.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="c-flags" title="warnings and blockers">
                <span className="visually-hidden">Markers</span>
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.className}
                  aria-sort={sort.key === column.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="sorter"
                    onClick={() =>
                      setSort((current) =>
                        current.key === column.key
                          ? { key: column.key, dir: current.dir === 1 ? -1 : 1 }
                          : { key: column.key, dir: 1 },
                      )
                    }
                  >
                    {column.label}
                    <span className="sorter__dir" aria-hidden="true">
                      {sort.key === column.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => {
              const shared = line.ref ? sharedRefs.get(line.ref) : undefined;
              const hardBlocked = line.openHardBlockers.length > 0;
              const isSelected = line.id === selected;

              return (
                <Fragment key={line.id}>
                  <tr
                    className={`row${isSelected ? ' row--selected' : ''}${saving === line.id ? ' row--saving' : ''}`}
                    onClick={() => setSelected(line.id)}
                    aria-selected={isSelected}
                  >
                    <td className="c-flags">
                      {line.warnings.map((warning) => (
                        <span key={warning.code} className="marker marker--warn" title={warning.detail}>
                          ▲
                        </span>
                      ))}
                      {line.varianceCount > 0 ? (
                        <span
                          className="marker marker--variance"
                          title={`${line.varianceCount} variance${line.varianceCount === 1 ? '' : 's'} logged against this line — see the VARIANCES view`}
                        >
                          ◆
                        </span>
                      ) : null}
                    </td>

                    <td className="c-id">{line.id}</td>

                    <td className="c-ref">
                      {line.ref ?? <span className="quiet">—</span>}
                      {shared ? (
                        <span
                          className="marker marker--shared"
                          title={`Ref ${line.ref} covers ${shared.length} distinct requirements: ${shared.join(', ')}. Read it with the name beside it.`}
                        >
                          ⧉
                        </span>
                      ) : null}
                    </td>

                    {/* The name sits immediately beside the ref, always. A ref alone is ambiguous. */}
                    <td className="c-name">
                      <span className="text" title={line.shortName}>
                        {line.shortName}
                      </span>
                    </td>

                    <td className="c-type">{line.buildType ?? <span className="quiet">—</span>}</td>
                    <td className="c-pri">{line.priority ?? <span className="quiet">—</span>}</td>
                    <td className="c-owner">{line.owner ?? <span className="quiet">—</span>}</td>
                    <td className="c-num">{line.aiDays === null ? <span className="quiet">—</span> : fmtDays(line.aiDays)}</td>
                    <td className="c-num">
                      {line.actualDays === null ? <span className="quiet">—</span> : fmtDays(line.actualDays)}
                    </td>

                    <td className="c-status">
                      <button
                        type="button"
                        className="pillbutton"
                        aria-haspopup="menu"
                        aria-expanded={menuFor === line.id}
                        disabled={saving === line.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(line.id);
                          setMenuFor(menuFor === line.id ? null : line.id);
                        }}
                      >
                        <StatusPill status={line.status} />
                      </button>
                      {menuFor === line.id ? (
                        <StatusMenu
                          current={line.status}
                          onPick={(next) => setStatus(line.id, next)}
                          onDismiss={() => setMenuFor(null)}
                        />
                      ) : null}
                    </td>

                    <td className="c-blockers">
                      {line.blockers.length === 0 ? (
                        <span className="quiet">—</span>
                      ) : (
                        <>
                          <span
                            className={`marker ${hardBlocked ? 'marker--hard' : 'marker--soft'}`}
                            title={
                              hardBlocked
                                ? `Open hard blocker(s): ${line.openHardBlockers.join(', ')}`
                                : `${line.blockers.length} linked question(s), none an open hard blocker`
                            }
                          >
                            ⚑
                          </span>
                          <span className="blockerrefs">
                            {line.blockers.map((ref) => (
                              <span
                                key={ref}
                                className={line.openHardBlockers.includes(ref) ? 'blockerref blockerref--hard' : 'blockerref'}
                              >
                                {ref}
                              </span>
                            ))}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>

                  {draft?.id === line.id ? (
                    <tr key={`${line.id}-editor`} className="subrow">
                      <td colSpan={COLUMNS.length + 1}>
                        {draft.kind === 'DESCOPE' ? (
                          <DescopeEditor
                            line={line}
                            draft={draft}
                            onChange={setDraft}
                            onCancel={() => setDraft(null)}
                            onSave={saveDraft}
                            saving={saving === line.id}
                          />
                        ) : (
                          <DaysEditor
                            line={line}
                            draft={draft}
                            onChange={setDraft}
                            onCancel={() => setDraft(null)}
                            onSave={saveDraft}
                            saving={saving === line.id}
                          />
                        )}
                      </td>
                    </tr>
                  ) : null}

                  {rowError?.id === line.id ? (
                    <tr key={`${line.id}-error`} className="subrow subrow--error">
                      <td colSpan={COLUMNS.length + 1}>
                        <span className="text" role="alert">
                          {rowError.message}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 ? <p className="grid__empty text">No lines match these filters.</p> : null}
      </div>

    </main>
  );
}

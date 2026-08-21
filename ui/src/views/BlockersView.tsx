import { useCallback, useEffect, useMemo, useState } from 'react';
import { RuleViolation, Unauthorized, apiGet, apiPatch } from '../api';
import { fmtDays } from '../format';
import {
  BLOCKER_STATUS_VOCABULARY,
  type BlockerStatus,
  type QuestionRow,
  type QuestionsResponse,
  type UpdateQuestionResponse,
} from '../types';

/**
 * The Blockers register: all 35 questions.
 *
 * Sorted by the AI-days each one blocks, descending, on open — that ordering
 * is a chase list, and nothing else in the tracker tells you which question to
 * chase first. The days column deliberately does not sum: questions overlap,
 * so a total would be a lie.
 */

type SortKey = 'ref' | 'question' | 'owner' | 'neededBy' | 'status' | 'lastChased' | 'blockedAiDays';

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'ref', label: 'REF', className: 'c-qref' },
  { key: 'question', label: 'QUESTION', className: 'c-name' },
  { key: 'owner', label: 'OWNER', className: 'c-qowner' },
  { key: 'neededBy', label: 'NEEDED BY', className: 'c-needed' },
  { key: 'status', label: 'STATUS', className: 'c-qstatus' },
  { key: 'lastChased', label: 'CHASED', className: 'c-chased' },
  { key: 'blockedAiDays', label: 'DAYS', className: 'c-num' },
];

function compare(a: QuestionRow, b: QuestionRow, key: SortKey): number {
  if (key === 'blockedAiDays') return a.blockedAiDays - b.blockedAiDays;
  if (key === 'status') {
    return BLOCKER_STATUS_VOCABULARY.indexOf(a.status) - BLOCKER_STATUS_VOCABULARY.indexOf(b.status);
  }
  if (key === 'ref') {
    // G15 belongs after G2, not between G1 and G2.
    const parse = (ref: string): [string, number] => [
      ref.replace(/[0-9]+$/, ''),
      Number.parseInt(ref.replace(/^[A-Za-z]+/, ''), 10) || 0,
    ];
    const [ap, an] = parse(a.ref);
    const [bp, bn] = parse(b.ref);
    return ap.localeCompare(bp) || an - bn;
  }
  const av = a[key];
  const bv = b[key];
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return String(av).localeCompare(String(bv), 'en-GB');
}

interface Filters {
  status: BlockerStatus | null;
  hardBlocker: boolean | null;
  owner: string | null;
}

const NO_FILTERS: Filters = { status: null, hardBlocker: null, owner: null };

export function BlockersView({ token, onDataChanged }: { token: string; onDataChanged: () => void }): React.JSX.Element {
  const [questions, setQuestions] = useState<QuestionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'blockedAiDays', dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ ref: string; message: string } | null>(null);
  const [followUp, setFollowUp] = useState<{ ref: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    apiGet<QuestionsResponse>('/questions', token)
      .then((data) => setQuestions(data.questions))
      .catch((cause: unknown) => {
        if (cause instanceof Unauthorized) return;
        setError((cause as Error).message);
      });
  }, [token]);

  const owners = useMemo(
    () => [...new Set((questions ?? []).map((q) => q.owner).filter((o): o is string => o !== null))].sort(),
    [questions],
  );

  const visible = useMemo(() => {
    const rows = (questions ?? []).filter((q) => {
      if (filters.status !== null && q.status !== filters.status) return false;
      if (filters.hardBlocker !== null && q.hardBlocker !== filters.hardBlocker) return false;
      if (filters.owner !== null && q.owner !== filters.owner) return false;
      return true;
    });
    return rows.sort((a, b) => compare(a, b, sort.key) * sort.dir || a.ref.localeCompare(b.ref));
  }, [questions, filters, sort]);

  const commit = useCallback(
    async (ref: string, body: { status?: BlockerStatus; lastChased?: string | null }): Promise<void> => {
      setSaving(ref);
      setRowError(null);
      setFollowUp(null);
      try {
        const result = await apiPatch<UpdateQuestionResponse>(`/questions/${ref}`, token, body);
        setQuestions(
          (current) =>
            current?.map((q) =>
              q.ref === ref ? { ...q, status: result.question.status, lastChased: result.question.lastChased } : q,
            ) ?? null,
        );
        // Settling a question does not unblock a line; the server says so and
        // the row repeats it rather than quietly moving anything.
        if (result.followUp) setFollowUp({ ref, message: result.followUp });
        onDataChanged();
      } catch (cause) {
        if (cause instanceof Unauthorized) return;
        setRowError({
          ref,
          message: cause instanceof RuleViolation ? cause.message : `Could not save. ${(cause as Error).message}`,
        });
      } finally {
        setSaving(null);
      }
    },
    [token, onDataChanged],
  );

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const index = visible.findIndex((q) => q.ref === selected);
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(visible[Math.min(index + 1, visible.length - 1)]?.ref ?? visible[0]?.ref ?? null);
      return;
    }
    if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(visible[Math.max(index - 1, 0)]?.ref ?? null);
      return;
    }
    if (event.key === 'Escape') {
      setSelected(null);
      setRowError(null);
      setFollowUp(null);
      return;
    }
    if (!selected) return;
    if (event.key === 'c') {
      event.preventDefault();
      void commit(selected, { lastChased: today() });
      return;
    }
    const status = BLOCKER_STATUS_VOCABULARY[Number.parseInt(event.key, 10) - 1];
    if (status) {
      event.preventDefault();
      void commit(selected, { status });
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
  if (!questions) return <div className="loading">LOADING QUESTIONS…</div>;

  const counts = Object.fromEntries(
    BLOCKER_STATUS_VOCABULARY.map((status) => [status, questions.filter((q) => q.status === status).length]),
  ) as Record<BlockerStatus, number>;

  return (
    <main className="view view--lines">
      <div className="filters">
        <button type="button" className="chip" aria-pressed={filters.status === null} onClick={() => setFilters({ ...filters, status: null })}>
          ALL <span className="chip__count">{questions.length}</span>
        </button>
        {BLOCKER_STATUS_VOCABULARY.map((status) => (
          <button
            key={status}
            type="button"
            className="chip"
            aria-pressed={filters.status === status}
            onClick={() => setFilters({ ...filters, status: filters.status === status ? null : status })}
            disabled={counts[status] === 0 && filters.status !== status}
          >
            {status} <span className="chip__count">{counts[status]}</span>
          </button>
        ))}

        <span className="filters__rule" aria-hidden="true" />

        <button
          type="button"
          className="chip"
          aria-pressed={filters.hardBlocker === true}
          onClick={() => setFilters({ ...filters, hardBlocker: filters.hardBlocker === true ? null : true })}
        >
          ⚑ HARD <span className="chip__count">{questions.filter((q) => q.hardBlocker).length}</span>
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={filters.hardBlocker === false}
          onClick={() => setFilters({ ...filters, hardBlocker: filters.hardBlocker === false ? null : false })}
        >
          SOFT <span className="chip__count">{questions.filter((q) => !q.hardBlocker).length}</span>
        </button>

        <label className="filters__select">
          owner
          <select value={filters.owner ?? ''} onChange={(e) => setFilters({ ...filters, owner: e.target.value || null })}>
            <option value="">any</option>
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>

        <span className="filters__spacer" />
        <span className="filters__shown">
          {visible.length === questions.length ? `${questions.length} questions` : `${visible.length} of ${questions.length}`}
        </span>
        {filters.status !== null || filters.hardBlocker !== null || filters.owner !== null ? (
          <button type="button" className="linkish" onClick={() => setFilters(NO_FILTERS)}>
            clear filters
          </button>
        ) : null}
      </div>

      <div
        className="grid"
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="group"
        aria-label="Open questions. Select a row, press 1 to 5 to set status, c to stamp chased today."
      >
        <table className="lines">
          <caption className="visually-hidden">
            Open questions blocking KORP2 Iteration 1, sorted by the AI-days each blocks.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="c-flags">
                <span className="visually-hidden">Hard blocker</span>
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.className}
                  aria-sort={sort.key === column.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  title={
                    column.key === 'blockedAiDays'
                      ? 'AI-days blocked by this question. Questions overlap, so this column does not sum.'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="sorter"
                    onClick={() =>
                      setSort((current) =>
                        current.key === column.key
                          ? { key: column.key, dir: current.dir === 1 ? -1 : 1 }
                          : { key: column.key, dir: column.key === 'blockedAiDays' ? -1 : 1 },
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
              <th scope="col" className="c-blocks">
                <span className="sorter">BLOCKS</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((q) => (
              <QuestionRowView
                key={q.ref}
                question={q}
                selected={q.ref === selected}
                saving={saving === q.ref}
                expanded={expanded === q.ref}
                onSelect={() => setSelected(q.ref)}
                onToggle={() => setExpanded(expanded === q.ref ? null : q.ref)}
                onStatus={(status) => void commit(q.ref, { status })}
                onChase={() => void commit(q.ref, { lastChased: today() })}
                rowError={rowError?.ref === q.ref ? rowError.message : null}
                followUp={followUp?.ref === q.ref ? followUp.message : null}
              />
            ))}
          </tbody>
        </table>
      </div>

    </main>
  );
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function QuestionRowView({
  question,
  selected,
  saving,
  expanded,
  onSelect,
  onToggle,
  onStatus,
  onChase,
  rowError,
  followUp,
}: {
  question: QuestionRow;
  selected: boolean;
  saving: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onStatus: (status: BlockerStatus) => void;
  onChase: () => void;
  rowError: string | null;
  followUp: string | null;
}): React.JSX.Element {
  return (
    <>
      <tr
        className={`row${selected ? ' row--selected' : ''}${saving ? ' row--saving' : ''}`}
        onClick={onSelect}
        aria-selected={selected}
      >
        <td className="c-flags">
          {question.hardBlocker ? (
            <span
              className={question.status === 'OPEN' ? 'marker marker--hard' : 'marker marker--soft'}
              title={question.status === 'OPEN' ? 'Open hard blocker' : 'Hard blocker, no longer open'}
            >
              ⚑
            </span>
          ) : null}
        </td>
        <td className="c-qref">{question.ref}</td>
        <td className="c-name">
          <button type="button" className="qtext text" onClick={onToggle} title="Show the whole question">
            {question.question}
          </button>
        </td>
        <td className="c-qowner" title={question.owner ?? undefined}>
          {question.owner ?? <span className="quiet">—</span>}
        </td>
        <td className="c-needed" title={question.neededBy ?? undefined}>
          {question.neededBy ?? <span className="quiet">—</span>}
        </td>
        <td className="c-qstatus">
          <select
            className="qstatus"
            value={question.status}
            disabled={saving}
            aria-label={`Status of ${question.ref}`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onStatus(event.target.value as BlockerStatus)}
          >
            {BLOCKER_STATUS_VOCABULARY.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </td>
        <td className="c-chased">
          <button
            type="button"
            className="chase"
            disabled={saving}
            title="Stamp last-chased with today's date"
            onClick={(event) => {
              event.stopPropagation();
              onChase();
            }}
          >
            {question.lastChased ?? <span className="quiet">never</span>}
          </button>
        </td>
        <td className="c-num">{question.blockedAiDays === 0 ? <span className="quiet">—</span> : fmtDays(question.blockedAiDays)}</td>
        <td className="c-blocks">
          {question.blockedLineIds.length === 0 ? (
            <span className="quiet">—</span>
          ) : (
            <span className="blockerrefs" title={`Blocks ${question.blockedLineIds.length} line(s)`}>
              {question.blockedLineIds.map((id) => (
                <span key={id} className="blockerref">
                  {id}
                </span>
              ))}
            </span>
          )}
        </td>
      </tr>

      {expanded ? (
        <tr className="subrow">
          <td colSpan={9}>
            <p className="qfull text">{question.question}</p>
          </td>
        </tr>
      ) : null}

      {followUp ? (
        <tr className="subrow subrow--error">
          <td colSpan={9}>
            <span className="text" role="status">
              {followUp}
            </span>
          </td>
        </tr>
      ) : null}

      {rowError ? (
        <tr className="subrow subrow--error">
          <td colSpan={9}>
            <span className="text" role="alert">
              {rowError}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

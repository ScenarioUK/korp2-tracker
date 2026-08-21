import { STATUS_VOCABULARY, type LineRow, type Status } from '../types';

/**
 * A compact control strip, not a sidebar: at 1280 the width belongs to the
 * table. The status chips carry live counts, so the strip doubles as the
 * status breakdown and there is no separate summary row.
 */

export interface Filters {
  status: Status | null;
  buildType: string | null;
  owner: string | null;
  hasBlockers: boolean | null;
}

export const NO_FILTERS: Filters = { status: null, buildType: null, owner: null, hasBlockers: null };

export function isFiltered(filters: Filters): boolean {
  return Object.values(filters).some((value) => value !== null);
}

export function applyFilters(lines: LineRow[], filters: Filters): LineRow[] {
  return lines.filter((line) => {
    if (filters.status !== null && line.status !== filters.status) return false;
    if (filters.buildType !== null && line.buildType !== filters.buildType) return false;
    if (filters.owner !== null && line.owner !== filters.owner) return false;
    if (filters.hasBlockers !== null && line.blockers.length > 0 !== filters.hasBlockers) return false;
    return true;
  });
}

function distinct(lines: LineRow[], pick: (line: LineRow) => string | null): string[] {
  return [...new Set(lines.map(pick).filter((value): value is string => value !== null))].sort();
}

export function FilterStrip({
  lines,
  filters,
  onChange,
  shown,
}: {
  lines: LineRow[];
  filters: Filters;
  onChange: (next: Filters) => void;
  shown: number;
}): React.JSX.Element {
  const counts = Object.fromEntries(
    STATUS_VOCABULARY.map((status) => [status, lines.filter((line) => line.status === status).length]),
  ) as Record<Status, number>;

  const set = <K extends keyof Filters>(key: K, value: Filters[K]): void => onChange({ ...filters, [key]: value });

  return (
    <div className="filters">
      <button
        type="button"
        className="chip"
        aria-pressed={filters.status === null}
        onClick={() => set('status', null)}
      >
        ALL <span className="chip__count">{lines.length}</span>
      </button>

      {STATUS_VOCABULARY.map((status) => (
        <button
          key={status}
          type="button"
          className="chip"
          aria-pressed={filters.status === status}
          // A second press on an active chip clears it — no separate × to hit.
          onClick={() => set('status', filters.status === status ? null : status)}
          disabled={counts[status] === 0 && filters.status !== status}
        >
          {status} <span className="chip__count">{counts[status]}</span>
        </button>
      ))}

      <span className="filters__rule" aria-hidden="true" />

      <label className="filters__select">
        type
        <select value={filters.buildType ?? ''} onChange={(e) => set('buildType', e.target.value || null)}>
          <option value="">any</option>
          {distinct(lines, (line) => line.buildType).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="filters__select">
        owner
        <select value={filters.owner ?? ''} onChange={(e) => set('owner', e.target.value || null)}>
          <option value="">any</option>
          {distinct(lines, (line) => line.owner).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="filters__select">
        blockers
        <select
          value={filters.hasBlockers === null ? '' : filters.hasBlockers ? 'yes' : 'no'}
          onChange={(e) => set('hasBlockers', e.target.value === '' ? null : e.target.value === 'yes')}
        >
          <option value="">any</option>
          <option value="yes">has blockers</option>
          <option value="no">none</option>
        </select>
      </label>

      <span className="filters__spacer" />

      <span className="filters__shown">
        {shown === lines.length ? `${lines.length} lines` : `${shown} of ${lines.length} lines`}
      </span>
      {isFiltered(filters) ? (
        <button type="button" className="linkish" onClick={() => onChange(NO_FILTERS)}>
          clear filters
        </button>
      ) : null}
    </div>
  );
}

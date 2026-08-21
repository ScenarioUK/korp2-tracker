import { useEffect, useState } from 'react';
import { Unauthorized, apiGet } from '../api';
import { fmtDays, fmtSignedDays, varianceOf } from '../format';
import type { DayLogEntry, DayLogResponse, VarianceRow, VariancesResponse } from '../types';

/**
 * The day log, newest first, with the variance register beside it.
 *
 * They belong on one screen: the log says what happened, the variances say what
 * it cost against the estimate. Reading either alone is how a day that felt
 * fine and a day that quietly burned two days of budget look identical.
 */
export function LogView({ token }: { token: string }): React.JSX.Element {
  const [entries, setEntries] = useState<DayLogEntry[] | null>(null);
  const [variances, setVariances] = useState<VarianceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiGet<DayLogResponse>('/daylog', token), apiGet<VariancesResponse>('/variances', token)])
      .then(([log, vs]) => {
        setEntries(log.entries);
        setVariances(vs.variances);
      })
      .catch((cause: unknown) => {
        if (cause instanceof Unauthorized) return;
        setError((cause as Error).message);
      });
  }, [token]);

  if (error) {
    return (
      <main className="view">
        <p className="gate__error text" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!entries || !variances) return <div className="loading">LOADING LOG…</div>;

  return (
    <main className="view view--log">
      <section className="logcol">
        <h2 className="panel__title">
          DAY LOG
          <span className="panel__hint">
            {entries.length === 0
              ? 'nothing logged yet — closing a build block writes an entry'
              : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, newest first`}
          </span>
        </h2>

        {entries.length === 0 ? (
          <p className="logempty text">
            The log fills itself: every build block you close writes what moved, what was decided, what shifted on
            blockers and what is next.
          </p>
        ) : (
          <ol className="daylog">
            {entries.map((entry) => (
              <li key={entry.id} className="daylog__entry">
                <div className="daylog__head">
                  <span className="daylog__date">{entry.date}</span>
                  <span className="daylog__time">{entry.ts.slice(11, 16)}</span>
                  <span className="daylog__actor quiet">{entry.actor}</span>
                </div>
                <Field label="MOVED" value={entry.moved} />
                <Field label="DECISIONS" value={entry.decisions} />
                <Field label="BLOCKERS" value={entry.blockersMoved} />
                <Field label="TOMORROW" value={entry.tomorrow} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="logcol logcol--variances">
        <h2 className="panel__title">
          VARIANCE REGISTER
          <span className="panel__hint">
            {variances.length === 0 ? 'none logged' : `${variances.length} logged · rollup by cause in VARIANCES`}
          </span>
        </h2>

        {variances.length === 0 ? (
          <p className="logempty text">
            A variance is written whenever a line reaches DONE at a number of days different from its estimate.
          </p>
        ) : (
          <table className="lines">
            <thead>
              <tr>
                <th scope="col" className="c-when">WHEN</th>
                <th scope="col" className="c-id">LINE</th>
                <th scope="col" className="c-cause">CAUSE</th>
                <th scope="col" className="c-num">EST</th>
                <th scope="col" className="c-num">ACT</th>
                <th scope="col" className="c-num">Δ</th>
                <th scope="col" className="c-num">OF EST</th>
              </tr>
            </thead>
            <tbody>
              {variances.map((row) => {
                const v = varianceOf(row.estAiDays, row.actualDays);
                return (
                  <tr key={row.id} className="row">
                    <td className="c-when">{row.ts.slice(0, 10)}</td>
                    <td className="c-id" title={row.shortName}>
                      {row.lineId}
                    </td>
                    <td className="c-cause">{row.cause}</td>
                    <td className="c-num">{fmtDays(row.estAiDays)}</td>
                    <td className="c-num">{fmtDays(row.actualDays)}</td>
                    <td className="c-num">{fmtSignedDays(v.days)}</td>
                    <td className="c-num">{v.proportion}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string | null }): React.JSX.Element | null {
  if (!value) return null;
  return (
    <div className="daylog__field">
      <span className="daylog__label">{label}</span>
      <span className="text">{value}</span>
    </div>
  );
}

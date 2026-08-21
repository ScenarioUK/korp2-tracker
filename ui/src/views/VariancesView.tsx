import { useEffect, useMemo, useState } from 'react';
import { Unauthorized, apiGet } from '../api';
import { fmtDays, fmtSignedDays, varianceOf } from '../format';
import { VARIANCE_CAUSES, type VarianceCause, type VarianceRow, type VariancesResponse } from '../types';

/**
 * The Variances register.
 *
 * A flat list of variances wastes the most valuable thing the tracker records:
 * TOOLING, ESTIMATE_ERROR and DEPENDENCY_WAIT are three completely different
 * problems that look identical in aggregate. So the rollup by cause comes
 * first, and the rows sit under it.
 */

/** The stated factors, by build type. Mirrors the estimates workbook; read-only. */
const STATED_FACTOR_NOTE = 'Stated factor from the estimates workbook. Read-only — divergence is a variance, not a re-cut.';

export function VariancesView({ token }: { token: string }): React.JSX.Element {
  const [variances, setVariances] = useState<VarianceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<VariancesResponse>('/variances', token)
      .then((data) => setVariances(data.variances))
      .catch((cause: unknown) => {
        if (cause instanceof Unauthorized) return;
        setError((cause as Error).message);
      });
  }, [token]);

  const byCause = useMemo(() => {
    const rows = variances ?? [];
    // All five, always, in this order. A cause with nothing against it shows a
    // zero rather than vanishing: "we have logged nothing against tooling" is
    // itself a finding.
    return VARIANCE_CAUSES.map((cause) => {
      const mine = rows.filter((row) => row.cause === cause);
      const est = round(mine.reduce((sum, row) => sum + row.estAiDays, 0));
      const actual = round(mine.reduce((sum, row) => sum + row.actualDays, 0));
      return { cause, n: mine.length, est, actual, delta: round(actual - est) };
    });
  }, [variances]);

  const tooling = useMemo(() => impliedFactors(variances ?? []), [variances]);

  const widest = Math.max(1, ...byCause.map((row) => Math.abs(row.delta)));

  if (error) {
    return (
      <main className="view">
        <p className="gate__error text" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!variances) return <div className="loading">LOADING VARIANCES…</div>;

  return (
    <main className="view view--variances">
      <section className="rollup">
        <h2 className="rollup__title">
          BY CAUSE
          <span className="rollup__hint">
            {variances.length === 0
              ? 'nothing logged yet — a cause is required whenever a line reaches DONE off its estimate'
              : `${variances.length} variance${variances.length === 1 ? '' : 's'} logged`}
          </span>
        </h2>

        <table className="lines rollup__table">
          <thead>
            <tr>
              <th scope="col" className="c-cause">CAUSE</th>
              <th scope="col" className="c-num">N</th>
              <th scope="col" className="c-num">EST AI</th>
              <th scope="col" className="c-num">ACTUAL</th>
              <th scope="col" className="c-num">Δ DAYS</th>
              <th scope="col" className="c-bar">
                <span className="rollup__scale">
                  <span>under</span>
                  <span>0</span>
                  <span>over</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {byCause.map((row) => (
              <tr key={row.cause} className={`row${row.n === 0 ? ' row--empty' : ''}`}>
                <td className="c-cause">
                  {row.cause}
                  {row.cause === 'TOOLING' ? (
                    <span className="rollup__tag" title="The cause that tells us whether the AI co-working factors hold.">
                      factors
                    </span>
                  ) : null}
                </td>
                <td className="c-num">{row.n}</td>
                <td className="c-num">{row.n === 0 ? <span className="quiet">—</span> : fmtDays(row.est)}</td>
                <td className="c-num">{row.n === 0 ? <span className="quiet">—</span> : fmtDays(row.actual)}</td>
                <td className="c-num">{row.n === 0 ? <span className="quiet">—</span> : fmtSignedDays(row.delta)}</td>
                <td className="c-bar">{row.n === 0 ? null : <CauseBar delta={row.delta} widest={widest} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rollup">
        <h2 className="rollup__title">
          TOOLING — IMPLIED FACTOR BY BUILD TYPE
          <span className="rollup__hint">
            never blended across types: the stated factors differ, so one figure would compare against nothing
          </span>
        </h2>

        <table className="lines rollup__table">
          <thead>
            <tr>
              <th scope="col" className="c-cause">BUILD TYPE</th>
              <th scope="col" className="c-num">LINES</th>
              <th scope="col" className="c-num">SOLO</th>
              <th scope="col" className="c-num">ACTUAL</th>
              <th scope="col" className="c-num">IMPLIED</th>
              <th scope="col" className="c-num">STATED</th>
              <th scope="col" className="c-bar">Δ</th>
            </tr>
          </thead>
          <tbody>
            {tooling.length === 0 ? (
              <tr className="row row--empty">
                <td colSpan={7} className="quiet">
                  No TOOLING variances logged. Nothing yet tests whether the factors hold.
                </td>
              </tr>
            ) : (
              tooling.map((row) => (
                <tr key={row.buildType} className={`row${row.suppressed ? ' row--empty' : ''}`}>
                  <td className="c-cause">{row.buildType}</td>
                  <td className="c-num">{row.lines}</td>
                  {row.suppressed ? (
                    <td colSpan={5} className="quiet">
                      — suppressed: {row.lines} line{row.lines === 1 ? '' : 's'}, not evidence
                    </td>
                  ) : (
                    <>
                      <td className="c-num">{fmtDays(row.solo)}</td>
                      <td className="c-num">{fmtDays(row.actual)}</td>
                      <td className="c-num" title="Derived: actual ÷ solo. Never written back.">
                        {row.implied === null ? <span className="quiet">—</span> : row.implied.toFixed(2)}
                      </td>
                      <td className="c-num" title={STATED_FACTOR_NOTE}>
                        {row.stated === null ? <span className="quiet">—</span> : row.stated.toFixed(2)}
                      </td>
                      <td className="c-bar">
                        {row.implied === null || row.stated === null ? (
                          <span className="quiet">—</span>
                        ) : (
                          signedFactor(row.implied - row.stated)
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="rollup__foot text">
          Implied factor is derived for display and never written back — <code>soloDays</code>, <code>aiFactor</code> and{' '}
          <code>aiDays</code> mirror the estimates workbook.
        </p>
      </section>

      <section className="rollup rollup--rows">
        <h2 className="rollup__title">LOGGED VARIANCES</h2>
        <div className="grid grid--flush">
          <table className="lines">
            <thead>
              <tr>
                <th scope="col" className="c-when">WHEN</th>
                <th scope="col" className="c-id">LINE</th>
                <th scope="col" className="c-name">NAME</th>
                <th scope="col" className="c-cause">CAUSE</th>
                <th scope="col" className="c-num">EST</th>
                <th scope="col" className="c-num">ACTUAL</th>
                <th scope="col" className="c-num">Δ</th>
                <th scope="col" className="c-num">OF EST</th>
                <th scope="col" className="c-who">DECLARED TO</th>
                <th scope="col" className="c-note">NOTE</th>
              </tr>
            </thead>
            <tbody>
              {variances.length === 0 ? (
                <tr className="row row--empty">
                  <td colSpan={10} className="quiet">
                    No variances logged yet.
                  </td>
                </tr>
              ) : (
                variances.map((row) => {
                  const v = varianceOf(row.estAiDays, row.actualDays);
                  return (
                    <tr key={row.id} className="row">
                      <td className="c-when">{row.ts.slice(0, 16).replace('T', ' ')}</td>
                      <td className="c-id">{row.lineId}</td>
                      <td className="c-name">
                        <span className="text" title={row.shortName}>
                          {row.shortName}
                        </span>
                      </td>
                      <td className="c-cause">{row.cause}</td>
                      <td className="c-num">{fmtDays(row.estAiDays)}</td>
                      <td className="c-num">{fmtDays(row.actualDays)}</td>
                      <td className="c-num">{fmtSignedDays(v.days)}</td>
                      <td className="c-num">{v.proportion}</td>
                      <td className="c-who">{row.declaredTo ?? <span className="quiet">—</span>}</td>
                      <td className="c-note">
                        {row.note ? (
                          <span className="text" title={row.note}>
                            {row.note}
                          </span>
                        ) : (
                          <span className="quiet">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function signedFactor(delta: number): string {
  const rounded = Math.round(delta * 100) / 100;
  if (rounded === 0) return '±0.00';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(2)}`;
}

interface ToolingRow {
  buildType: string;
  lines: number;
  solo: number;
  actual: number;
  implied: number | null;
  stated: number | null;
  suppressed: boolean;
}

/**
 * One row per build type, each against its own stated factor — never blended.
 * A type with fewer than two lines is suppressed: one line is an anecdote, and
 * it would be the most quotable number on the screen.
 */
function impliedFactors(rows: VarianceRow[]): ToolingRow[] {
  const tooling = rows.filter((row) => row.cause === 'TOOLING' && row.buildType !== null);
  const types = [...new Set(tooling.map((row) => row.buildType as string))].sort();

  return types.map((buildType) => {
    const mine = tooling.filter((row) => row.buildType === buildType);
    // One variance per line for this purpose; a line logged twice counts once.
    const byLine = new Map(mine.map((row) => [row.lineId, row]));
    const lines = [...byLine.values()];
    const solo = round(lines.reduce((sum, row) => sum + (row.soloDays ?? 0), 0));
    const actual = round(lines.reduce((sum, row) => sum + row.actualDays, 0));
    const stated = lines[0]?.aiFactor ?? null;

    return {
      buildType,
      lines: lines.length,
      solo,
      actual,
      implied: lines.length >= 2 && solo > 0 ? round(actual / solo) : null,
      stated,
      suppressed: lines.length < 2,
    };
  });
}

/** Zero-centred and greyscale: a cause is not a status, so it gets no colour. */
function CauseBar({ delta, widest }: { delta: number; widest: number }): React.JSX.Element {
  const width = (Math.abs(delta) / widest) * 50;
  return (
    <span className="vbar vbar--wide" aria-hidden="true">
      <span className="vbar__zero" />
      <span
        className="vbar__fill"
        style={delta < 0 ? { right: '50%', width: `${width}%` } : { left: '50%', width: `${width}%` }}
      />
    </span>
  );
}

export type { VarianceCause };

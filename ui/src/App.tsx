import { useCallback, useEffect, useState } from 'react';
import { Unauthorized, apiGet, clearToken, readToken, writeToken } from './api';
import { TokenGate } from './TokenGate';
import { BudgetRail } from './shell/BudgetRail';
import { Masthead } from './shell/Masthead';
import { Nav, type View } from './shell/Nav';
import { PositionLine } from './shell/PositionLine';
import { StatusBar } from './shell/StatusBar';
import { LinesView } from './views/LinesView';
import { VariancesView } from './views/VariancesView';
import { BlockersView } from './views/BlockersView';
import { TodayView } from './views/TodayView';
import { LogView } from './views/LogView';
import type { PositionResponse } from './types';

/**
 * The persistent shell: masthead, budget rail, position line, nav, view, status
 * bar. Everything above the view is always on screen — the rail in particular,
 * because the point of it is that you cannot look at a line without seeing what
 * it costs against the budget.
 */
export function App(): React.JSX.Element {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [data, setData] = useState<PositionResponse | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date>(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('LINES');

  /** A rejected token is dropped, not retried — back to the paste screen. */
  const signOut = useCallback(() => {
    clearToken();
    setToken(null);
    setData(null);
    setError(null);
  }, []);

  /** Re-read the rollup. Called on load, and again after any line write. */
  const loadPosition = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const next = await apiGet<PositionResponse>('/position', token);
      setData(next);
      setLoadedAt(new Date());
      setError(null);
    } catch (cause) {
      if (cause instanceof Unauthorized) {
        signOut();
        return;
      }
      setError((cause as Error).message);
    }
  }, [token, signOut]);

  useEffect(() => {
    void loadPosition();
  }, [loadPosition]);

  if (!token) {
    return (
      <TokenGate
        onAccepted={(accepted) => {
          writeToken(accepted);
          setToken(accepted);
        }}
      />
    );
  }

  if (error) {
    return (
      <div className="gate">
        <div className="gate__panel">
          <h1 className="gate__title">TRACKER UNREACHABLE</h1>
          <p className="gate__error text" role="alert">
            {error}
          </p>
          <p className="gate__note text">
            The token is still held. Reload to try again, or{' '}
            <button type="button" className="linkish" onClick={signOut}>
              forget token
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="loading">LOADING POSITION…</div>;
  }

  return (
    <div className="shell">
      <Masthead position={data.position} loadedAt={loadedAt} />
      <BudgetRail position={data.position} rail={data.rail} />
      <PositionLine position={data.position} />
      <Nav view={view} onChange={setView} position={data.position} />
      {view === 'LINES' ? (
        <LinesView token={token} onDataChanged={() => void loadPosition()} />
      ) : view === 'BLOCKERS' ? (
        <BlockersView token={token} onDataChanged={() => void loadPosition()} />
      ) : view === 'VARIANCES' ? (
        <VariancesView token={token} />
      ) : view === 'TODAY' ? (
        <TodayView token={token} onDataChanged={() => void loadPosition()} />
      ) : (
        <LogView token={token} />
      )}
      <StatusBar view={view} position={data.position} rail={data.rail} token={token} onSignOut={signOut} />
    </div>
  );
}

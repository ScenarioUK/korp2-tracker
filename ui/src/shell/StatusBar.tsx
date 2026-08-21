import { useState } from 'react';
import { Unauthorized, apiDownload } from '../api';
import type { Position, Rail } from '../types';
import type { View } from './Nav';
import { fmtDays } from '../format';

/**
 * The editor idiom: what is selected, what is loaded, and the one action
 * available right now. It advertises nothing that does not exist yet — there
 * are no keyboard shortcuts in this cut, so it does not claim any.
 */
export function StatusBar({
  view,
  position,
  rail,
  token,
  onSignOut,
}: {
  view: View;
  position: Position;
  rail: Rail;
  token: string;
  onSignOut: () => void;
}): React.JSX.Element {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  const download = async (): Promise<void> => {
    setExporting(true);
    setExported(null);
    try {
      const name = await apiDownload('/export', token, 'korp2-tracker-export.json');
      setExported(name);
    } catch (cause) {
      if (cause instanceof Unauthorized) {
        onSignOut();
        return;
      }
      setExported(`export failed: ${(cause as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <footer className="statusbar">
      <div className="statusbar__left">
        <span>view {view}</span>
        <span className="sep">·</span>
        <span>{position.progress.lineCount} lines</span>
        <span className="sep">·</span>
        <span>{fmtDays(rail.atRisk.aiDays)}d at risk</span>
        {position.warnings.length > 0 ? (
          <>
            <span className="sep">·</span>
            <span>
              ▲ {position.warnings.reduce((sum, w) => sum + w.count, 0)} consistency warnings
            </span>
          </>
        ) : null}
      </div>
      <div className="statusbar__left">
        {view === 'LINES' ? (
          <span>
            <b>1</b>–<b>8</b> status · <b>a</b> actual days · <b>j</b>/<b>k</b> move · <b>Esc</b> deselect
          </span>
        ) : null}
        {view === 'BLOCKERS' ? (
          <span>
            <b>1</b>–<b>5</b> status · <b>c</b> chased today · <b>j</b>/<b>k</b> move · days-blocked overlaps and does not sum
          </span>
        ) : null}
        {exported ? <span className="statusbar__note">{exported}</span> : null}
        <button
          type="button"
          className="linkish"
          onClick={() => void download()}
          disabled={exporting}
          title="Download the whole dataset as JSON, including the audit trail"
        >
          {exporting ? 'exporting…' : 'export JSON'}
        </button>
        <button type="button" className="linkish" onClick={onSignOut}>
          forget token
        </button>
      </div>
    </footer>
  );
}

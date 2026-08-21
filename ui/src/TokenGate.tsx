import { useState, type FormEvent } from 'react';
import { Unauthorized, apiGet } from './api';
import type { PositionResponse } from './types';

/**
 * The one auth screen. Paste UI_TOKEN, and it is checked by making the call
 * the app makes anyway — if /api/position answers, the token is good.
 *
 * The token never enters the URL. It is held in localStorage for this browser
 * only, and dropped the moment the server rejects it.
 */
export function TokenGate({ onAccepted }: { onAccepted: (token: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const token = value.trim();
    if (!token || checking) return;

    setChecking(true);
    setError(null);
    try {
      await apiGet<PositionResponse>('/position', token);
      onAccepted(token);
    } catch (cause) {
      setError(
        cause instanceof Unauthorized
          ? 'Token rejected. Check UI_TOKEN in the app environment.'
          : `Could not reach the tracker. ${(cause as Error).message}`,
      );
      setChecking(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate__panel" onSubmit={submit}>
        <h1 className="gate__title">KORP2 DELIVERY TRACKER</h1>
        <p className="gate__sub text">Delivery metadata only. No resident data, no health &amp; disability values.</p>

        <label className="gate__label" htmlFor="ui-token">
          UI_TOKEN
        </label>
        <div className="gate__field">
          <input
            id="ui-token"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            aria-describedby={error ? 'gate-error' : 'gate-note'}
          />
          <button type="submit" className="gate__submit" disabled={checking || value.trim() === ''}>
            {checking ? 'CHECKING' : 'ENTER'}
          </button>
        </div>

        {error ? (
          <p className="gate__error text" id="gate-error" role="alert">
            {error}
          </p>
        ) : null}

        <p className="gate__note text" id="gate-note">
          Held in this browser only, and sent as a bearer header on every request — never in a URL. Use “forget token”
          in the status bar to clear it.
        </p>
      </form>
    </div>
  );
}

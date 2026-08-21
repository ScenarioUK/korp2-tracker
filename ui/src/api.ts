/**
 * The token and the fetch wrapper.
 *
 * UI_TOKEN is pasted once and held in localStorage for this browser only. It
 * travels in an Authorization header on every call and never in a URL or query
 * string. A 401 means the token is no longer good, so it is dropped and the
 * paste screen comes back — there is no retry loop and no silent failure.
 */

const TOKEN_KEY = 'korp2.ui.token';

export class Unauthorized extends Error {
  constructor() {
    super('Token rejected.');
    this.name = 'Unauthorized';
  }
}

export function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private windows and blocked site data both throw. Treat as signed out.
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Nothing to do — the token still works for this page's lifetime.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Already unreachable; nothing to clear.
  }
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });

  if (response.status === 401) throw new Unauthorized();

  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

/** A rule in CLAUDE.md was broken. The message is written to be read, so it is kept. */
export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

export async function apiPatch<T>(path: string, token: string, body: unknown): Promise<T> {
  return send<T>('PATCH', path, token, body);
}

export async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  return send<T>('POST', path, token, body);
}

async function send<T>(method: string, path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) throw new Unauthorized();

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    if (response.status === 422 || response.status === 404 || response.status === 409) {
      throw new RuleViolation(detail?.message ?? `${response.status} ${response.statusText}`);
    }
    throw new Error(detail?.message ?? `${path} failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

/**
 * Download a file from an authenticated endpoint.
 *
 * Deliberately not a link or window.open: those cannot carry an Authorization
 * header, so the only way to make them work would be a token in the query
 * string — which would then sit in browser history, server logs and referrers.
 * Instead the response is fetched with the header, held as a blob, and handed
 * to a synthetic anchor. The object URL is revoked straight after.
 */
export async function apiDownload(path: string, token: string, fallbackName: string): Promise<string> {
  const response = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (response.status === 401) throw new Unauthorized();
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${response.statusText}`);

  // The server names the file; the fallback only applies if the header is
  // stripped by something in front of us.
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking immediately can race the download in some browsers; a tick is enough.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return filename;
}

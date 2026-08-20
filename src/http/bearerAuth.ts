import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Bearer token auth for /mcp.
 *
 * Proportionate for a single-user internal tool, per the brief §4: Claude
 * stores header values securely and sends them on every request. Entra ID
 * OAuth is the upgrade path if per-user identity is ever required.
 *
 * The token is only ever read from the Authorization header — never from a
 * query string, and it is never logged.
 */
export function bearerAuth(expectedToken: string) {
  const expected = Buffer.from(expectedToken, 'utf8');

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer (.+)$/i.exec(header.trim());

    if (!match?.[1]) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token.' });
      return;
    }

    const presented = Buffer.from(match[1].trim(), 'utf8');

    // timingSafeEqual throws on a length mismatch, so compare lengths first.
    // Length is not secret; the bytes are.
    const ok = presented.length === expected.length && timingSafeEqual(presented, expected);

    if (!ok) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'unauthorized', message: 'Invalid bearer token.' });
      return;
    }

    next();
  };
}

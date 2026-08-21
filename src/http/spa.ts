import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Config } from '../config.js';

/**
 * Serves the built SPA as static files from this same Express app, which is
 * what the deployment constraint in CLAUDE.md requires — one container, one
 * origin, no separate static host.
 *
 * The app is a single HTML file plus content-hashed assets, so assets cache
 * hard and the HTML never does. Any GET that is not an asset falls through to
 * index.html; client-side routing takes it from there.
 */
export function mountSpa(app: express.Express, config: Config): void {
  const uiDir = path.resolve(config.uiDir);
  const indexFile = path.join(uiDir, 'index.html');

  if (!existsSync(indexFile)) {
    console.warn(`[boot] no built UI at ${uiDir} — run \`npm run build\`. /mcp and /health are unaffected.`);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.status(503).type('text/plain').send('UI not built. Run `npm run build`.');
    });
    return;
  }

  // Vite fingerprints everything under /assets, so those are immutable.
  app.use(
    '/assets',
    express.static(path.join(uiDir, 'assets'), {
      immutable: true,
      maxAge: '1y',
      fallthrough: false,
    }),
  );

  app.use(express.static(uiDir, { index: false, maxAge: '1h' }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Everything the page needs is same-origin — fonts included, since they are
    // self-hosted rather than pulled from a font CDN.
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join('; '),
    );
    res.sendFile(indexFile);
  });
}

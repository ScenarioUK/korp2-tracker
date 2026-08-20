import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import type pg from 'pg';
import type { Config } from '../config.js';
import { createMcpServer } from '../mcp/server.js';
import { bearerAuth } from './bearerAuth.js';
import { healthHandler } from './health.js';

/**
 * Two routes: GET /health (open) and POST /mcp (bearer).
 *
 * /mcp is Streamable HTTP, stateless — a fresh transport per request with
 * sessionIdGenerator undefined, closed when the response ends. That survives
 * App Platform restarts and more than one instance, which a session-keyed
 * transport would not. This is not SSE; SSE is deprecated in the current spec.
 */
export function createApp(pool: pg.Pool, config: Config): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', healthHandler(pool, config));

  app.post(
    '/mcp',
    bearerAuth(config.mcpToken),
    express.json({ limit: '1mb' }),
    async (req: Request, res: Response): Promise<void> => {
      const server = createMcpServer(pool, config);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      res.on('close', () => {
        void transport.close().catch(() => undefined);
        void server.close().catch(() => undefined);
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('[mcp] request failed:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    },
  );

  // Stateless mode has no server-initiated stream and no session to delete.
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'This endpoint is stateless Streamable HTTP. Use POST /mcp.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[http] unhandled error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

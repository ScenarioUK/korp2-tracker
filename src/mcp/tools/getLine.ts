import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import { z } from 'zod';
import { getLine } from '../../repo/lines.js';
import { errorResult, guard, jsonResult } from '../result.js';

export function registerGetLine(server: McpServer, pool: pg.Pool): void {
  server.registerTool(
    'get_line',
    {
      title: 'Get one KORP2 build line in full',
      description:
        'Use this when you need everything about one build line: estimates, blockers with the question ' +
        'text behind them, any logged variances, and the full audit trail of who changed what and when. ' +
        'Takes the line id (L01–L46), not a ref — refs are not unique. If you only have a ref, call ' +
        'list_lines first to find which id or ids it maps to.',
      inputSchema: {
        id: z.string().describe('Build line id, L01 through L46.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) =>
      guard('get_line', async () => {
        const line = await getLine(pool, id.trim().toUpperCase());
        if (!line) {
          return errorResult(
            `No build line with id "${id}". Ids run L01 to L46. If you have a requirement ref, ` +
              'use list_lines to find the matching line — a ref can map to two lines.',
          );
        }
        return jsonResult(line);
      }),
  );
}

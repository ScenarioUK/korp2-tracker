import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import { getPosition } from '../../repo/position.js';
import { guard, jsonResult } from '../result.js';

export function registerGetPosition(server: McpServer, pool: pg.Pool): void {
  server.registerTool(
    'get_position',
    {
      title: 'KORP2 delivery position',
      description:
        'Use this first to answer "where is KORP2 Iteration 1 right now?" or "how are we doing?". ' +
        'Returns the rollup only: line counts by status, DONE against the in-scope total, days logged ' +
        'against the v5 baseline, how many hard blockers are still open, and any consistency warnings. ' +
        'No line detail — follow up with list_lines for that. ' +
        'NOT_MINE lines (Integration or BI own the build) and DESCOPED lines are excluded from the ' +
        'progress denominator rather than counted as complete.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => guard('get_position', async () => jsonResult(await getPosition(pool))),
  );
}

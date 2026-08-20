import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import { ACTOR_MCP } from '../../domain/audit.js';
import { logDay, type DayLogInput } from '../../repo/dayLog.js';
import { NO_PERSONAL_DATA, freeText, isoDate, writeInput } from '../schema.js';
import { guard, jsonResult } from '../result.js';

export function registerLogDay(server: McpServer, pool: pg.Pool): void {
  server.registerTool(
    'log_day',
    {
      title: 'Log the end of a KORP2 build block',
      description:
        'Use this at the end of a build block to bank what happened: what moved, what was decided, ' +
        'what shifted on blockers, and what is next. Entries are append-only and dated — a second ' +
        'entry for the same day is another entry, not a replacement. ' +
        'This is the running narrative of the delivery; korp2-decisions-log.md holds why a decision ' +
        'was made, this holds what happened on the day. ' +
        NO_PERSONAL_DATA,
      inputSchema: writeInput({
        date: isoDate.optional().describe('Date of the entry, YYYY-MM-DD. Defaults to today.'),
        moved: freeText(4000).min(1).describe('What actually moved — which lines, and how far.'),
        decisions: freeText(4000).optional().describe('Decisions banked during the block.'),
        blockersMoved: freeText(4000).optional().describe('Questions asked, chased, answered or closed.'),
        tomorrow: freeText(4000).optional().describe('What the next block is for.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      guard('log_day', async () => {
        const input: DayLogInput = { moved: args.moved };
        if (args.date !== undefined) input.date = args.date;
        if (args.decisions !== undefined) input.decisions = args.decisions;
        if (args.blockersMoved !== undefined) input.blockersMoved = args.blockersMoved;
        if (args.tomorrow !== undefined) input.tomorrow = args.tomorrow;

        return jsonResult({ logged: true, entry: await logDay(pool, input, ACTOR_MCP) });
      }),
  );
}

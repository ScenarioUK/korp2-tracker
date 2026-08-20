import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import { z } from 'zod';
import { ACTOR_MCP } from '../../domain/audit.js';
import { statusEnum } from '../../domain/vocab.js';
import { updateLine, type LineUpdate } from '../../repo/lines.js';
import { NO_PERSONAL_DATA, freeText, writeInput } from '../schema.js';
import { guard, jsonResult } from '../result.js';

export function registerUpdateLine(server: McpServer, pool: pg.Pool): void {
  server.registerTool(
    'update_line',
    {
      title: 'Update a KORP2 build line',
      description:
        'Use this to move a build line on: set its status, record the days it actually took, or leave a ' +
        'note. Takes the line id (L01–L46), not a ref — refs are not unique. ' +
        'Only status, actualDays and note can be changed: soloDays, aiFactor and aiDays are read-only ' +
        'because they mirror the estimates workbook, and any attempt to set them is rejected. ' +
        'Nothing is ever deleted — to remove scope, set status to DESCOPED, which requires a note ' +
        'explaining why and writes a descope audit row. ' +
        'When a line reaches DONE at a number of days different from its estimate, the response asks ' +
        'you to call log_variance; do that, it is how the AI co-working factors get validated. ' +
        'Every change is written to the audit trail. ' +
        NO_PERSONAL_DATA,
      inputSchema: writeInput({
        id: z.string().describe('Build line id, L01 through L46.'),
        status: statusEnum
          .optional()
          .describe(
            'New status. DONE means built AND unit tested — BUILT is untested. NOT_MINE means ' +
              'Integration or BI owns the build and does not count as progress. DESCOPED requires a note.',
          ),
        actualDays: z
          .number()
          .min(0)
          .max(999)
          .nullable()
          .optional()
          .describe('Days actually spent on this line. Pass null to clear a value recorded in error.'),
        note: freeText(4000)
          .nullable()
          .optional()
          .describe(
            'Free-text note on the line, replacing any previous note (the old value is kept in the ' +
              'audit trail). Required when setting DESCOPED. ' +
              NO_PERSONAL_DATA,
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      guard('update_line', async () => {
        const update: LineUpdate = {};
        if (args.status !== undefined) update.status = args.status;
        if (args.actualDays !== undefined) update.actualDays = args.actualDays;
        if (args.note !== undefined) update.note = args.note;

        const result = await updateLine(pool, args.id, update, ACTOR_MCP);

        return jsonResult({
          updated: result.changes.length > 0,
          changes: result.changes,
          descopeRecorded: result.descopeRecorded,
          varianceNeeded: result.varianceNeeded,
          warnings: result.line.warnings,
          line: result.line,
        });
      }),
  );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import { z } from 'zod';
import { statusEnum } from '../../domain/vocab.js';
import { listLines, type LineFilters } from '../../repo/lines.js';
import { guard, jsonResult } from '../result.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export function registerListLines(server: McpServer, pool: pg.Pool): void {
  server.registerTool(
    'list_lines',
    {
      title: 'List KORP2 build lines',
      description:
        'Use this to find build lines — "what is blocked?", "what is left to build?", "what is BI doing?". ' +
        'Returns a narrow projection (id, ref, shortName, buildType, status, aiDays, actualDays, blockers) ' +
        'so it stays inside the response ceiling; call get_line for the full record. ' +
        'Note that ref is NOT unique — 110358 and 110391 each cover two distinct requirements — so ' +
        'always identify a line by its id (L01–L46) and quote shortName alongside any ref.',
      inputSchema: {
        status: statusEnum.optional().describe('Exact status match, e.g. BLOCKED or NOT_STARTED.'),
        buildType: z
          .string()
          .optional()
          .describe('Exact build type, e.g. SCHEMA, JS, PLUGIN, FLOW, FORM, INTEGRATION, BI, NA.'),
        owner: z.string().optional().describe('Exact owner, e.g. ME, BI, NA.'),
        priority: z.string().optional().describe('Exact MoSCoW priority: Must, Should, Could or Want.'),
        hasBlockers: z.boolean().optional().describe('true for lines with at least one linked question.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .optional()
          .describe(`Page size, default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}.`),
        offset: z.number().int().min(0).optional().describe('Page offset; use nextOffset from the previous page.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      guard('list_lines', async () => {
        const filters: LineFilters = {};
        if (args.status !== undefined) filters.status = args.status;
        if (args.buildType !== undefined) filters.buildType = args.buildType;
        if (args.owner !== undefined) filters.owner = args.owner;
        if (args.priority !== undefined) filters.priority = args.priority;
        if (args.hasBlockers !== undefined) filters.hasBlockers = args.hasBlockers;

        const page = await listLines(pool, filters, args.limit ?? DEFAULT_PAGE_SIZE, args.offset ?? 0);
        return jsonResult(page);
      }),
  );
}

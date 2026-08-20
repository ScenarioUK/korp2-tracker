import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import { z } from 'zod';
import { ACTOR_MCP } from '../../domain/audit.js';
import { varianceCauseEnum } from '../../domain/vocab.js';
import { logVariance, type VarianceInput } from '../../repo/variances.js';
import { NO_PERSONAL_DATA, freeText, writeInput } from '../schema.js';
import { guard, jsonResult } from '../result.js';

export function registerLogVariance(server: McpServer, pool: pg.Pool): void {
  server.registerTool(
    'log_variance',
    {
      title: 'Log a KORP2 estimate variance',
      description:
        'Use this when a line took a different number of days than estimated, and say why. ' +
        'This is the record that tells us whether the AI co-working factors hold — TOOLING is the ' +
        'cause to use when the difference came from the AI co-working itself rather than the work. ' +
        'Logging a variance does NOT change the estimate: soloDays, aiFactor and aiDays mirror the ' +
        'estimates workbook and are read-only here. Divergence is a variance, not a re-cut. ' +
        'estAiDays defaults to the line\'s own aiDays, which is normally what you want. ' +
        NO_PERSONAL_DATA,
      inputSchema: writeInput({
        lineId: z.string().describe('Build line id, L01 through L46.'),
        estAiDays: z
          .number()
          .min(0)
          .max(999)
          .optional()
          .describe('The estimate being compared against. Defaults to the line\'s recorded aiDays.'),
        actualDays: z.number().min(0).max(999).describe('Days the line actually took.'),
        cause: varianceCauseEnum.describe(
          'SCOPE (the work grew), AMBIGUITY (requirement was unclear), DEPENDENCY_WAIT (blocked on ' +
            'someone else), ESTIMATE_ERROR (the estimate was simply wrong), ' +
            'TOOLING (the AI co-working helped or hindered more than the factor assumed).',
        ),
        declaredTo: freeText(200)
          .nullable()
          .optional()
          .describe('Who this variance has been declared to, e.g. "Simon Shewry". A name and role only.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      guard('log_variance', async () => {
        const input: VarianceInput = {
          lineId: args.lineId,
          actualDays: args.actualDays,
          cause: args.cause,
        };
        if (args.estAiDays !== undefined) input.estAiDays = args.estAiDays;
        if (args.declaredTo !== undefined) input.declaredTo = args.declaredTo;

        return jsonResult({ logged: true, variance: await logVariance(pool, input, ACTOR_MCP) });
      }),
  );
}

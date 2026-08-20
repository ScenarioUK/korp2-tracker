import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import { z } from 'zod';
import { ACTOR_MCP } from '../../domain/audit.js';
import { blockerStatusEnum } from '../../domain/vocab.js';
import { updateQuestion, type QuestionUpdate } from '../../repo/questions.js';
import { NO_PERSONAL_DATA, freeText, isoDate, writeInput } from '../schema.js';
import { guard, jsonResult } from '../result.js';

export function registerUpdateQuestion(server: McpServer, pool: pg.Pool): void {
  server.registerTool(
    'update_question',
    {
      title: 'Update a KORP2 open question',
      description:
        'Use this when a question moves: it has been chased, answered, closed or superseded. ' +
        'Set status, record the date it was last chased, and append a note saying what happened — ' +
        'notes accumulate rather than overwrite, so the chase history stays readable. ' +
        'Closing a question does NOT unblock the lines that depend on it; the response lists them so ' +
        'you can move each one deliberately with update_line. ' +
        'Every change is written to the audit trail. ' +
        NO_PERSONAL_DATA,
      inputSchema: writeInput({
        ref: z.string().describe('Question ref, e.g. G1, I3, R1, A2, AI4.'),
        status: blockerStatusEnum
          .optional()
          .describe(
            'OPEN (still waiting), CHASED (asked again), ANSWERED (reply received), ' +
              'CLOSED (settled), SUPERSEDED (overtaken by another decision).',
          ),
        lastChased: isoDate
          .nullable()
          .optional()
          .describe('Date the question was last chased, YYYY-MM-DD. Pass null to clear it.'),
        note: freeText(4000)
          .optional()
          .describe(
            'Appended to this question\'s note history — what was asked, what came back, who said it. ' +
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
      guard('update_question', async () => {
        const update: QuestionUpdate = {};
        if (args.status !== undefined) update.status = args.status;
        if (args.lastChased !== undefined) update.lastChased = args.lastChased;
        if (args.note !== undefined) update.note = args.note;

        const result = await updateQuestion(pool, args.ref, update, ACTOR_MCP);

        return jsonResult({
          updated: result.changes.length > 0,
          changes: result.changes,
          noteAppended: result.noteAppended,
          followUp: result.followUp,
          affectedLines: result.affectedLines,
          question: result.question,
        });
      }),
  );
}

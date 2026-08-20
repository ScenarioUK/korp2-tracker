import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import { z } from 'zod';
import { blockerStatusEnum } from '../../domain/vocab.js';
import { QUESTION_TRUNCATE_AT } from '../../repo/lines.js';
import { listQuestions, type QuestionFilters } from '../../repo/questions.js';
import { guard, jsonResult } from '../result.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './listLines.js';

export function registerListQuestions(server: McpServer, pool: pg.Pool): void {
  server.registerTool(
    'list_questions',
    {
      title: 'List KORP2 open questions and blockers',
      description:
        'Use this to answer "what am I waiting on?", "who owes me an answer?", or "what is holding up ' +
        'the build?". Questions are the things blocking build lines — G* governance, I* integration, ' +
        'R* recommendations, A* actions, AI* AI co-working. Filter hardBlocker: true for the ones that ' +
        'stop design starting. ' +
        `Question text is truncated to ${QUESTION_TRUNCATE_AT} characters in list results; pass a single ` +
        'ref to get that one question in full.',
      inputSchema: {
        status: blockerStatusEnum
          .optional()
          .describe('OPEN, CHASED, ANSWERED, CLOSED or SUPERSEDED. Most useful filter is OPEN.'),
        hardBlocker: z.boolean().optional().describe('true for questions that block design or build starting.'),
        owner: z
          .string()
          .optional()
          .describe('Partial, case-insensitive match on owner — owners are compound, e.g. "Simon Shewry / BDA".'),
        ref: z
          .string()
          .optional()
          .describe('A single question ref, e.g. G1 or R1. Returns that question with its full untruncated text.'),
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
      guard('list_questions', async () => {
        const filters: QuestionFilters = {};
        if (args.status !== undefined) filters.status = args.status;
        if (args.hardBlocker !== undefined) filters.hardBlocker = args.hardBlocker;
        if (args.owner !== undefined) filters.owner = args.owner;
        if (args.ref !== undefined) filters.ref = args.ref.trim().toUpperCase();

        const page = await listQuestions(pool, filters, args.limit ?? DEFAULT_PAGE_SIZE, args.offset ?? 0);
        return jsonResult(page);
      }),
  );
}

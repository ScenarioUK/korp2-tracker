import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pg from 'pg';
import type { Config } from '../config.js';
import { registerGetLine } from './tools/getLine.js';
import { registerGetPosition } from './tools/getPosition.js';
import { registerListLines } from './tools/listLines.js';
import { registerListQuestions } from './tools/listQuestions.js';
import { registerLogDay } from './tools/logDay.js';
import { registerLogVariance } from './tools/logVariance.js';
import { registerUpdateLine } from './tools/updateLine.js';
import { registerUpdateQuestion } from './tools/updateQuestion.js';

/**
 * The MCP tool surface — eight tools, which is the cap in the brief.
 *
 * Four reads, all annotated readOnlyHint, all paginated with a narrow default
 * projection because custom connectors have a response ceiling. Four writes,
 * all of which append to the audit trail and none of which can delete.
 */
export function createMcpServer(pool: pg.Pool, config: Config): McpServer {
  const server = new McpServer(
    { name: config.serviceName, version: config.serviceVersion },
    {
      capabilities: { tools: {} },
      instructions:
        'KORP2 Iteration 1 delivery tracker. Holds delivery metadata only — refs, estimates, statuses, ' +
        'blockers and owner names. It contains no resident data, no health & disability values and no ' +
        'protected characteristics; do not attempt to store any. Build lines are keyed by id (L01–L46). ' +
        'A requirement ref is NOT unique, so always quote shortName alongside a ref. Start with ' +
        'get_position for the overall picture. ' +
        'Nothing here can be deleted: removing scope means setting a line to DESCOPED with a note. ' +
        'Estimates (soloDays, aiFactor, aiDays) are read-only — they mirror an external workbook, and ' +
        'a difference between estimate and reality is logged as a variance, not edited away.',
    },
  );

  // Reads
  registerGetPosition(server, pool);
  registerListLines(server, pool);
  registerGetLine(server, pool);
  registerListQuestions(server, pool);

  // Writes
  registerUpdateLine(server, pool);
  registerUpdateQuestion(server, pool);
  registerLogVariance(server, pool);
  registerLogDay(server, pool);

  return server;
}

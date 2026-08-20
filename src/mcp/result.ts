import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NotFound, RuleViolation } from '../domain/errors.js';

/** Tool results are JSON in a text block — no output schema to keep in step with the payload. */
export function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Turn a failure into a tool error rather than a transport error, so the caller
 * sees something it can act on.
 *
 * A broken rule or a missing record is the caller's problem and its message is
 * written for them, so it goes back verbatim. Anything else is our problem: it
 * is logged in full server-side and only its message is returned — never a
 * stack, a query or a connection string.
 */
export async function guard(toolName: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RuleViolation || error instanceof NotFound) {
      return errorResult(error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mcp] ${toolName} failed:`, error);
    return errorResult(`${toolName} failed: ${message}`);
  }
}

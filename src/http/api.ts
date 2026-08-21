import express, { type NextFunction, type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import type { Config } from '../config.js';
import { ACTOR_UI } from '../domain/audit.js';
import { NotFound, RuleViolation } from '../domain/errors.js';
import { blockerStatusEnum, statusEnum, varianceCauseEnum } from '../domain/vocab.js';
import { getPosition } from '../repo/position.js';
import { getRail } from '../repo/rail.js';
import { listAllLines, updateLine, type LineUpdate, type UpdateLineOptions } from '../repo/lines.js';
import { listVariances } from '../repo/variances.js';
import { buildExport, exportFilename } from '../repo/export.js';
import { listAllQuestions, updateQuestion, type QuestionUpdate } from '../repo/questions.js';
import { listDayLog } from '../repo/dayLog.js';
import { closeBlock, getOpenBlock, openBlock, recentBlocks, updateOpenBlock, type BlockInput } from '../repo/blocks.js';
import { bearerAuth } from './bearerAuth.js';

/**
 * The browser face's data surface.
 *
 * Separate from /mcp deliberately: different credential (UI_TOKEN, not
 * MCP_TOKEN), different projections, and revoking one must not revoke the
 * other. Same bearer-header rule though — the token is never in a URL.
 *
 * A 401 from anything here is the SPA's signal to drop its stored token and go
 * back to the paste screen, so it must stay a 401 and never a redirect.
 */

/**
 * Mirrors update_line's schema. The estimate fields are absent by construction:
 * this object cannot carry soloDays, aiFactor or aiDays, `.strict()` rejects a
 * request that tries, and the trigger from 003_estimate_guard.sql is the
 * backstop if both are ever bypassed.
 */
const lineUpdateSchema = z
  .object({
    status: statusEnum.optional(),
    actualDays: z.number().min(0).max(999).nullable().optional(),
    note: z.string().max(4000).nullable().optional(),
    /**
     * The cause is drawn from the closed list and nothing else is accepted.
     * estAiDays is deliberately absent: the estimate comes from the line, so a
     * variance can never restate what it is being measured against.
     */
    variance: z
      .object({
        cause: varianceCauseEnum,
        note: z.string().max(4000).nullable().optional(),
        declaredTo: z.string().max(200).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
}

const questionUpdateSchema = z
  .object({
    status: blockerStatusEnum.optional(),
    /**
     * ISO date, or null to clear. Checked for shape and then for being a real
     * date — 2026-02-31 has the right shape and does not exist.
     */
    lastChased: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, YYYY-MM-DD')
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      }, 'is not a real date')
      .nullable()
      .optional(),
    note: z.string().max(4000).optional(),
  })
  .strict();

const listOfLines = z.array(z.string().max(400)).max(50);

const blockSchema = z
  .object({
    timeBox: z.string().max(120).nullable().optional(),
    targets: z.array(z.string().max(10)).max(20).optional(),
    doList: listOfLines.optional(),
    doNotList: listOfLines.optional(),
  })
  .strict();

const closeSchema = z
  .object({
    moved: z.string().min(1).max(4000),
    decisions: z.string().max(4000).nullable().optional(),
    blockersMoved: z.string().max(4000).nullable().optional(),
    tomorrow: z.string().max(4000).nullable().optional(),
  })
  .strict();

export function createApiRouter(pool: pg.Pool, config: Config): express.Router {
  const router = express.Router();

  router.use(bearerAuth(config.uiToken));
  router.use(express.json({ limit: '64kb' }));

  // No caching of delivery state — this is the thing that has to be live.
  router.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /**
   * Everything the persistent shell needs, in one round trip: the rollup for
   * the position line and the day sums for the rail.
   */
  router.get('/position', async (_req: Request, res: Response): Promise<void> => {
    const [position, rail] = await Promise.all([getPosition(pool), getRail(pool)]);
    res.json({ position, rail });
  });

  /** All 46, unpaginated. The browser filters and sorts them. */
  router.get('/lines', async (_req: Request, res: Response): Promise<void> => {
    res.json({ lines: await listAllLines(pool) });
  });

  /**
   * The one write. Delegates to the same updateLine the MCP tool calls, so the
   * rules hold identically whichever face made the change: closed status
   * vocabulary, no writes to estimate fields, a note required for DESCOPED,
   * a descope_audit row, and an audit entry in the same transaction.
   */
  router.patch('/lines/:id', async (req: Request, res: Response): Promise<void> => {
    const parsed = lineUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: 'invalid_update',
        message: issues(parsed.error),
      });
      return;
    }

    const update: LineUpdate = {};
    if (parsed.data.status !== undefined) update.status = parsed.data.status;
    if (parsed.data.actualDays !== undefined) update.actualDays = parsed.data.actualDays;
    if (parsed.data.note !== undefined) update.note = parsed.data.note;

    // The browser can hold the user on the form until there is a cause, so it
    // asks for the rule to be enforced. MCP cannot, and does not.
    const options: UpdateLineOptions = { requireVarianceOnDone: true };
    if (parsed.data.variance) options.variance = parsed.data.variance;

    // Express types a route param as string | string[]; this route has one.
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const result = await updateLine(pool, id ?? '', update, ACTOR_UI, options);
    res.json({
      line: result.line,
      changes: result.changes,
      descopeRecorded: result.descopeRecorded,
      varianceNeeded: result.varianceNeeded,
    });
  });

  /** All 35 questions, whole and unpaginated — the browser has no token ceiling. */
  router.get('/questions', async (_req: Request, res: Response): Promise<void> => {
    res.json({ questions: await listAllQuestions(pool) });
  });

  /**
   * Status and lastChased, through the same updateQuestion the MCP tool calls.
   * Settling a question never unblocks a line by itself; the follow-up says so.
   */
  router.patch('/questions/:ref', async (req: Request, res: Response): Promise<void> => {
    const parsed = questionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid_update', message: issues(parsed.error) });
      return;
    }

    const update: QuestionUpdate = {};
    if (parsed.data.status !== undefined) update.status = parsed.data.status;
    if (parsed.data.lastChased !== undefined) update.lastChased = parsed.data.lastChased;
    if (parsed.data.note !== undefined) update.note = parsed.data.note;

    const ref = Array.isArray(req.params.ref) ? req.params.ref[0] : req.params.ref;
    const result = await updateQuestion(pool, ref ?? '', update, ACTOR_UI);
    res.json({
      question: result.question,
      changes: result.changes,
      affectedLines: result.affectedLines,
      followUp: result.followUp,
    });
  });

  /** The open build block, if there is one, plus the last few closed. */
  router.get('/block', async (_req: Request, res: Response): Promise<void> => {
    const [open, recent] = await Promise.all([getOpenBlock(pool), recentBlocks(pool)]);
    res.json({ open, recent });
  });

  router.post('/block', async (req: Request, res: Response): Promise<void> => {
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid_block', message: issues(parsed.error) });
      return;
    }
    res.json({ block: await openBlock(pool, parsed.data as BlockInput, ACTOR_UI) });
  });

  router.patch('/block', async (req: Request, res: Response): Promise<void> => {
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid_block', message: issues(parsed.error) });
      return;
    }
    res.json({ block: await updateOpenBlock(pool, parsed.data as BlockInput, ACTOR_UI) });
  });

  /** Closing writes the day log entry in the same transaction. */
  router.post('/block/close', async (req: Request, res: Response): Promise<void> => {
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid_entry', message: issues(parsed.error) });
      return;
    }
    res.json(await closeBlock(pool, parsed.data, ACTOR_UI));
  });

  /** The day log, newest first. */
  router.get('/daylog', async (_req: Request, res: Response): Promise<void> => {
    res.json({ entries: await listDayLog(pool) });
  });

  /** Every logged variance, newest first. The rollup is computed in the browser. */
  router.get('/variances', async (_req: Request, res: Response): Promise<void> => {
    res.json({ variances: await listVariances(pool) });
  });

  /**
   * The whole dataset as one JSON document, behind the same UI_TOKEN as
   * everything else here. Includes the audit trail, because that is what
   * replaces git history and an export without it loses how the position got
   * where it is.
   *
   * Content-Disposition carries the filename so curl and the browser agree on
   * it. The token stays in the Authorization header — the SPA fetches this and
   * saves the response as a blob rather than navigating to a URL, because a
   * token in a query string would be in history, logs and referrers.
   */
  router.get('/export', async (_req: Request, res: Response): Promise<void> => {
    const exportedAt = new Date();
    const document = await buildExport(pool, { name: config.serviceName, version: config.serviceVersion }, exportedAt);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(exportedAt)}"`);
    // The SPA reads the filename back off the response, so it has to be visible
    // to cross-origin-safe header access even when this is served behind a proxy.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(JSON.stringify(document, null, 2));
  });

  router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  /**
   * A broken rule is the caller's fault and carries a message written to be
   * read, so it comes back as 422 with that message intact rather than a 500.
   */
  router.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof RuleViolation) {
      res.status(422).json({ error: 'rule_violation', message: error.message });
      return;
    }
    if (error instanceof NotFound) {
      res.status(404).json({ error: 'not_found', message: error.message });
      return;
    }
    console.error('[api] unhandled error:', error);
    res.status(500).json({ error: 'internal_error' });
  });

  return router;
}

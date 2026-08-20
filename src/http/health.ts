import type { Request, Response } from 'express';
import type pg from 'pg';
import type { Config } from '../config.js';
import { currentVersion } from '../db/migrate.js';

/**
 * Unauthenticated health check — App Platform needs to reach it, and it is the
 * fastest way to confirm a deploy actually landed the data. Delivery metadata
 * counts only; nothing here identifies a requirement or a person.
 */
export function healthHandler(pool: pg.Pool, config: Config) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const counts = await pool.query<{ build_lines: string; questions: string; blocker_links: string }>(
        `SELECT (SELECT count(*)::text FROM build_lines)   AS build_lines,
                (SELECT count(*)::text FROM questions)     AS questions,
                (SELECT count(*)::text FROM line_blockers) AS blocker_links`,
      );
      const row = counts.rows[0];

      res.status(200).json({
        status: 'ok',
        service: config.serviceName,
        version: config.serviceVersion,
        db: 'up',
        schemaVersion: await currentVersion(pool),
        buildLines: Number.parseInt(row?.build_lines ?? '0', 10),
        questions: Number.parseInt(row?.questions ?? '0', 10),
        blockerLinks: Number.parseInt(row?.blocker_links ?? '0', 10),
        uptimeSeconds: Math.round(process.uptime()),
      });
    } catch (error) {
      console.error('[health] database check failed:', error);
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  };
}

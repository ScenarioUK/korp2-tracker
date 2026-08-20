import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';

/**
 * Migration runner.
 *
 * Numbered .sql files applied in filename order, once each, recorded in
 * schema_migrations. Each file runs inside its own transaction, so a failure
 * leaves no partial DDL behind. The whole file is sent as one query — it is
 * never split on semicolons, because 003 contains a dollar-quoted function
 * body that splitting would break.
 *
 * Called from index.ts before the server binds the port. If it throws, the
 * process exits and no half-migrated schema ever serves traffic.
 */

/** Arbitrary but fixed. Two App Platform instances booting at once must not race. */
const ADVISORY_LOCK_KEY = 4_022_010_1;

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
  latest: string | null;
}

function migrationFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    throw new Error(
      `Cannot read migrations directory ${path.resolve(dir)}: ${(error as Error).message}. ` +
        'Set MIGRATIONS_DIR if the app is not started from the project root.',
    );
  }
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

export async function runMigrations(client: pg.PoolClient, dir: string): Promise<MigrationResult> {
  const files = migrationFiles(dir);
  if (files.length === 0) {
    throw new Error(`No .sql migrations found in ${path.resolve(dir)}.`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => r.version));

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const file of files) {
    if (done.has(file)) {
      alreadyApplied.push(file);
      continue;
    }
    const sql = readFileSync(path.join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
    applied.push(file);
  }

  return { applied, alreadyApplied, latest: files[files.length - 1] ?? null };
}

/**
 * Hold a session-level advisory lock for the duration of `fn`. Any other
 * instance booting at the same time blocks here, then finds nothing pending.
 */
export async function withBootLock<T>(client: pg.PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
  }
}

export async function currentVersion(db: pg.Pool | pg.PoolClient): Promise<string | null> {
  const { rows } = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
  );
  return rows[0]?.version ?? null;
}

import pg from 'pg';
import type { Config } from '../config.js';

const { Pool, types } = pg;

/**
 * pg returns NUMERIC as a string to protect precision it cannot guarantee in a
 * JS number. Every numeric in this schema is a day count with at most two
 * decimals, so parsing to a number is safe and saves every caller doing it.
 */
types.setTypeParser(1700, (value) => (value === null ? null : Number.parseFloat(value)));

/** DATE as the plain 'YYYY-MM-DD' string it is, not a Date shifted into local time. */
types.setTypeParser(1082, (value) => value);

export type Db = pg.Pool | pg.PoolClient;

export function createPool(config: Config): pg.Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Run `fn` inside a transaction on a dedicated client. */
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

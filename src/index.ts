import { ConfigError, loadConfig } from './config.js';
import { runMigrations, withBootLock } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { createApp } from './http/app.js';
import { seedIfEmpty } from './seed/load.js';

/**
 * Boot.
 *
 * Strictly sequential: config, pool, then migrations and seed under an
 * advisory lock, and only then bind the port. Nothing serves traffic against a
 * half-migrated schema — if a migration fails the process exits non-zero, the
 * health check fails, and App Platform keeps the previous deployment.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);

  const client = await pool.connect();
  try {
    await withBootLock(client, async () => {
      const migrations = await runMigrations(client, config.migrationsDir);
      if (migrations.applied.length > 0) {
        console.log(`[boot] applied ${migrations.applied.length} migration(s): ${migrations.applied.join(', ')}`);
      } else {
        console.log(`[boot] schema up to date at ${migrations.latest}`);
      }

      const seed = await seedIfEmpty(client, config.seedFile);
      if (seed.seeded) {
        console.log(
          `[boot] seeded ${seed.buildLines} build lines, ${seed.questions} questions, ` +
            `${seed.blockerLinks} blocker links, ${seed.descopeRows} descope rows`,
        );
      } else {
        console.log(`[boot] existing data found (${seed.buildLines} build lines) — seed not re-run`);
      }
    });
  } finally {
    client.release();
  }

  const app = createApp(pool, config);
  const server = app.listen(config.port, () => {
    console.log(`[boot] listening on ${config.port} — GET /health, POST /mcp`);
  });

  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal} received`);
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`[boot] configuration error: ${error.message}`);
  } else {
    console.error('[boot] failed to start:', error);
  }
  process.exit(1);
});

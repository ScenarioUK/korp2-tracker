import type { ConnectionOptions } from 'node:tls';

/**
 * Environment configuration, validated once at boot.
 *
 * Nothing here is defaulted to a secret. If MCP_TOKEN or DATABASE_URL is
 * missing the process exits with a clear message rather than starting in a
 * state where /mcp is open or the first query fails.
 */

export interface Config {
  port: number;
  databaseUrl: string;
  databaseSsl: boolean | ConnectionOptions;
  mcpToken: string;
  seedFile: string;
  migrationsDir: string;
  serviceName: string;
  serviceVersion: string;
}

class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new ConfigError(`${name} is not set. It must be provided as an environment variable.`);
  }
  return value.trim();
}

/**
 * DigitalOcean managed Postgres requires SSL — without this the first deploy
 * fails on connect. Local Postgres normally does not have it, so localhost is
 * exempted. Set DATABASE_CA_CERT to the DO-provided CA to pin the certificate;
 * without it we still encrypt but do not verify the chain, which is what the
 * DO connection string's default sslmode=require means.
 */
function sslFor(databaseUrl: string): boolean | ConnectionOptions {
  if (process.env.DATABASE_SSL === 'disable') return false;

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    throw new ConfigError('DATABASE_URL is not a valid connection URL.');
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;

  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export function loadConfig(): Config {
  const databaseUrl = required('DATABASE_URL');
  const mcpToken = required('MCP_TOKEN');

  if (mcpToken.length < 24) {
    throw new ConfigError('MCP_TOKEN is too short to be a credential. Use at least 24 characters.');
  }

  // DigitalOcean App Platform sets PORT. Never hardcode it; 3000 is only the
  // local fallback when the variable is absent.
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT is not a valid port number: ${process.env.PORT}`);
  }

  return {
    port,
    databaseUrl,
    databaseSsl: sslFor(databaseUrl),
    mcpToken,
    // Both of these are read from the repo at runtime rather than compiled in.
    // App Platform deploys the whole repo, so cwd is the project root.
    seedFile: process.env.SEED_FILE ?? 'docs/korp2-tracker-seed.json',
    migrationsDir: process.env.MIGRATIONS_DIR ?? 'src/db/migrations',
    serviceName: 'korp2-tracker',
    serviceVersion: '0.1.0',
  };
}

export { ConfigError };

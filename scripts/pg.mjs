// Local development Postgres control — start | stop | status.
//
// This drives the portable Postgres cluster under tools/ (gitignored, machine
// local). It is a convenience wrapper only: nothing in production uses it.
// DigitalOcean provides managed Postgres and injects DATABASE_URL.
//
//   npm run db:start    boot the cluster
//   npm run db:stop     shut it down cleanly
//   npm run db:status   is it running?
//
// If you would rather use Docker, `docker compose up -d` serves the same
// database on the same port with the same credentials — see docker-compose.yml.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, 'tools', 'pgdata');
// The log lives beside the data directory, not inside it: Postgres fsyncs the
// whole data directory at startup and trips a Windows sharing violation on a
// logfile it has open itself.
const logFile = path.join(root, 'tools', 'pg-server.log');

const exe = process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl';
const pgCtl = path.join(root, 'tools', 'pgsql', 'bin', exe);

const action = process.argv[2];
if (!['start', 'stop', 'status'].includes(action)) {
  console.error('usage: node scripts/pg.mjs <start|stop|status>');
  process.exit(2);
}

if (!existsSync(pgCtl)) {
  console.error(`No local Postgres found at ${pgCtl}`);
  console.error('Either install the portable server there, or use Docker: docker compose up -d');
  process.exit(1);
}
if (!existsSync(dataDir)) {
  console.error(`No cluster at ${dataDir}. Initialise one with initdb before starting.`);
  process.exit(1);
}

const args =
  action === 'start'
    ? ['-D', dataDir, '-l', logFile, '-w', '-t', '60', 'start']
    : action === 'stop'
      ? ['-D', dataDir, '-w', '-t', '60', '-m', 'fast', 'stop']
      : ['-D', dataDir, 'status'];

// stdio is ignored rather than inherited on purpose. pg_ctl hands its stdout to
// the server it spawns, so an inherited pipe stays open for the life of the
// database and npm appears to hang long after the command has finished.
const run = spawnSync(pgCtl, args, { stdio: 'ignore' });

if (run.error) {
  console.error(`could not run pg_ctl: ${run.error.message}`);
  process.exit(1);
}

// `status` exits 3 when the server is not running, which is an answer, not a
// failure. Report it and exit cleanly so it is usable as a plain check.
if (action === 'status') {
  console.log(run.status === 0 ? 'postgres: running' : 'postgres: not running');
  process.exit(0);
}

if (run.status !== 0) {
  console.error(`pg_ctl ${action} failed (exit ${run.status}). Last lines of ${logFile}:`);
  const tail = spawnSync(process.execPath, [
    '-e',
    `try{const l=require('fs').readFileSync(${JSON.stringify(logFile)},'utf8').trim().split('\\n');console.error(l.slice(-15).join('\\n'))}catch{console.error('(no log file)')}`,
  ]);
  if (tail.stderr) process.stderr.write(tail.stderr);
  process.exit(run.status ?? 1);
}

console.log(action === 'start' ? 'postgres: started on 127.0.0.1:5432' : 'postgres: stopped');

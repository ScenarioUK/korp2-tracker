# KORP2 Delivery Tracker

## What this is
A tracker for KORP2 Iteration 1 delivery state. Two faces: a browser UI and an
MCP endpoint that Claude connects to. Full spec in
docs/korp2-tracker-build-brief.md. Seed data in docs/korp2-tracker-seed.json.

## Stack
Node 20, TypeScript, Express, @modelcontextprotocol/sdk (Streamable HTTP
transport — NOT SSE, it is deprecated), pg (Postgres), React + Vite for the
UI. Deployed to DigitalOcean App Platform from GitHub.

## Deployment constraints
- Must listen on process.env.PORT. DigitalOcean sets it; do not hardcode 3000.
- Postgres connection comes from DATABASE_URL. DigitalOcean managed Postgres
  requires SSL — configure the pg client accordingly or the first deploy fails.
- package.json needs "engines": { "node": ">=20" } and working "build" and
  "start" scripts. App Platform uses them directly.
- The built UI must be served as static files by the same Express app.

## Rules — do not break these

### Data
- NEVER store resident data, health & disability values, protected
  characteristics, or any personal data. This holds delivery metadata only:
  refs, estimates, statuses, blockers, owner names. If a task seems to need
  personal data, stop and ask.
- `ref` is NOT unique. Refs 110358 and 110391 each cover two distinct
  requirements. `id` (L01–L46) is the key. Any output showing a ref must also
  show shortName.
- `soloDays`, `aiFactor` and `aiDays` are read-only. They mirror an external
  estimates workbook. Reject any write to them.
- `status` is a closed vocabulary. Reject anything not in the seed file's
  statusVocabulary.
- Nothing is ever deleted. Removing scope sets status to DESCOPED and requires
  a note.
- Every write appends to an audit trail: {ts, actor, entity, field, from, to}.

### Secrets
- Never commit secrets. UI_TOKEN, MCP_TOKEN and DATABASE_URL are environment
  variables only.
- .gitignore must cover .env before any .env file is created.
- Never put a token in a URL or query string.

### Working style
- Show me a plan before writing code for anything spanning more than one file.
- Run `npm run build` and fix type errors before telling me something is done.
- Prefer boring, obvious code. I maintain this alone.

## Commands
- `npm run dev` — local dev server
- `npm run build` — typecheck and build
- `npm start` — production start (what DigitalOcean runs)
- `npm test` — tests
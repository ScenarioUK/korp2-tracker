import { readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { z } from 'zod';
import {
  BLOCKER_STATUS_VOCABULARY,
  STATUS_VOCABULARY,
  VARIANCE_CAUSES,
  blockerStatusEnum,
  statusEnum,
} from '../domain/vocab.js';

/**
 * First-boot seed loader.
 *
 * "Load that file on first boot if the tables are empty; treat it as the seed,
 *  never re-run it over live data."
 *
 * Runs inside the boot advisory lock, in one transaction, and only when
 * build_lines is empty. Everything it inserts is delivery metadata.
 */

const nullableString = z.string().nullable();

const seedSchema = z.object({
  meta: z.object({
    iteration: z.string(),
    estimateBaseline: z.string(),
    baselineTotals: z.object({
      soloDays: z.number(),
      aiDays: z.number(),
      lineCount: z.number().int(),
    }),
    generatedFrom: z.string().nullish(),
    generatedOn: z.string().nullish(),
    warning: z.string().nullish(),
  }),
  statusVocabulary: z.array(z.string()),
  blockerStatusVocabulary: z.array(z.string()),
  varianceCauses: z.array(z.string()),
  buildLines: z.array(
    z.object({
      id: z.string(),
      ref: nullableString,
      shortName: z.string(),
      epic: nullableString.optional(),
      priority: nullableString.optional(),
      buildType: nullableString.optional(),
      owner: nullableString.optional(),
      soloDays: z.number().nullable(),
      aiFactor: z.number().nullable(),
      aiDays: z.number().nullable(),
      confidence: nullableString.optional(),
      blockers: z.array(z.string()),
      status: statusEnum,
      actualDays: z.number().nullable(),
      note: nullableString,
    }),
  ),
  openQuestions: z.array(
    z.object({
      ref: z.string(),
      question: z.string(),
      impact: nullableString.optional(),
      owner: nullableString.optional(),
      neededBy: nullableString.optional(),
      hardBlocker: z.boolean(),
      status: blockerStatusEnum,
      lastChased: nullableString,
    }),
  ),
  descopeAudit: z.array(
    z.object({
      date: z.string(),
      item: z.string(),
      soloDaysRemoved: z.number(),
      reason: z.string(),
      decisionRef: nullableString,
      reversible: z.boolean(),
    }),
  ),
});

export type SeedFile = z.infer<typeof seedSchema>;

export interface SeedResult {
  seeded: boolean;
  buildLines: number;
  questions: number;
  blockerLinks: number;
  descopeRows: number;
}

/**
 * The seed file carries its own copies of the three closed vocabularies. If
 * they drift from src/domain/vocab.ts — the arrays the CHECK constraints and
 * the tool schemas are built from — fail at boot rather than load data the
 * rest of the app will reject.
 */
function assertVocabulariesMatch(seed: SeedFile): void {
  const compare = (name: string, fromFile: string[], canonical: readonly string[]) => {
    const a = [...fromFile].sort().join(',');
    const b = [...canonical].sort().join(',');
    if (a !== b) {
      throw new Error(
        `Seed file ${name} does not match src/domain/vocab.ts.\n  seed file: ${fromFile.join(', ')}\n  app:       ${canonical.join(', ')}`,
      );
    }
  };
  compare('statusVocabulary', seed.statusVocabulary, STATUS_VOCABULARY);
  compare('blockerStatusVocabulary', seed.blockerStatusVocabulary, BLOCKER_STATUS_VOCABULARY);
  compare('varianceCauses', seed.varianceCauses, VARIANCE_CAUSES);
}

function assertReferentialIntegrity(seed: SeedFile): void {
  const known = new Set(seed.openQuestions.map((q) => q.ref));
  const missing = new Map<string, string[]>();
  for (const line of seed.buildLines) {
    for (const ref of line.blockers) {
      if (!known.has(ref)) {
        missing.set(ref, [...(missing.get(ref) ?? []), line.id]);
      }
    }
  }
  if (missing.size > 0) {
    const detail = [...missing.entries()].map(([ref, ids]) => `${ref} (on ${ids.join(', ')})`).join('; ');
    throw new Error(`Seed file references blocker questions that do not exist: ${detail}`);
  }

  const ids = new Set<string>();
  for (const line of seed.buildLines) {
    if (ids.has(line.id)) throw new Error(`Seed file has duplicate build line id ${line.id}.`);
    ids.add(line.id);
  }
  // ref is deliberately not checked for uniqueness — 110358 and 110391 each
  // cover two distinct requirements and must survive as separate rows.
}

export function readSeedFile(seedFilePath: string): SeedFile {
  const resolved = path.resolve(seedFilePath);
  let raw: string;
  try {
    raw = readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read seed file ${resolved}: ${(error as Error).message}. ` +
        'Set SEED_FILE if the app is not started from the project root.',
    );
  }

  const parsed = seedSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Seed file ${resolved} is not valid: ${JSON.stringify(parsed.error.issues.slice(0, 5), null, 2)}`);
  }

  assertVocabulariesMatch(parsed.data);
  assertReferentialIntegrity(parsed.data);
  return parsed.data;
}

/**
 * Load the seed if, and only if, build_lines is empty. Caller supplies a
 * client already inside a transaction and inside the boot advisory lock.
 */
export async function seedIfEmpty(client: pg.PoolClient, seedFilePath: string): Promise<SeedResult> {
  const { rows } = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM build_lines');
  const existing = Number.parseInt(rows[0]?.count ?? '0', 10);

  if (existing > 0) {
    const questionCount = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM questions');
    return {
      seeded: false,
      buildLines: existing,
      questions: Number.parseInt(questionCount.rows[0]?.count ?? '0', 10),
      blockerLinks: 0,
      descopeRows: 0,
    };
  }

  const seed = readSeedFile(seedFilePath);

  await client.query(
    `INSERT INTO baseline (id, iteration, estimate_baseline, solo_days, ai_days, line_count,
                           generated_from, generated_on, warning)
     VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      seed.meta.iteration,
      seed.meta.estimateBaseline,
      seed.meta.baselineTotals.soloDays,
      seed.meta.baselineTotals.aiDays,
      seed.meta.baselineTotals.lineCount,
      seed.meta.generatedFrom ?? null,
      seed.meta.generatedOn ?? null,
      seed.meta.warning ?? null,
    ],
  );

  for (const q of seed.openQuestions) {
    await client.query(
      `INSERT INTO questions (ref, question, impact, owner, needed_by, hard_blocker, status, last_chased)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        q.ref,
        q.question,
        q.impact ?? null,
        q.owner ?? null,
        q.neededBy ?? null,
        q.hardBlocker,
        q.status,
        q.lastChased,
      ],
    );
  }

  let blockerLinks = 0;
  for (const line of seed.buildLines) {
    await client.query(
      `INSERT INTO build_lines (id, ref, short_name, epic, priority, build_type, owner,
                                solo_days, ai_factor, ai_days, confidence, status, actual_days, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        line.id,
        line.ref,
        line.shortName,
        line.epic ?? null,
        line.priority ?? null,
        line.buildType ?? null,
        line.owner ?? null,
        line.soloDays,
        line.aiFactor,
        line.aiDays,
        line.confidence ?? null,
        line.status,
        line.actualDays,
        line.note,
      ],
    );
    for (const ref of line.blockers) {
      await client.query(
        'INSERT INTO line_blockers (line_id, question_ref) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [line.id, ref],
      );
      blockerLinks += 1;
    }
  }

  for (const d of seed.descopeAudit) {
    await client.query(
      `INSERT INTO descope_audit (descoped_on, item, line_id, solo_days_removed, reason,
                                  decision_ref, reversible, actor)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, 'seed')`,
      [d.date, d.item, d.soloDaysRemoved, d.reason, d.decisionRef, d.reversible],
    );
  }

  await client.query(
    `INSERT INTO audit_log (actor, entity, entity_id, field, from_value, to_value)
     VALUES ('seed', 'tracker', 'seed', 'loaded', NULL, $1)`,
    [
      `${seed.meta.estimateBaseline}: ${seed.buildLines.length} build lines, ` +
        `${seed.openQuestions.length} questions, from ${seed.meta.generatedFrom ?? 'unknown source'}`,
    ],
  );

  return {
    seeded: true,
    buildLines: seed.buildLines.length,
    questions: seed.openQuestions.length,
    blockerLinks,
    descopeRows: seed.descopeAudit.length,
  };
}

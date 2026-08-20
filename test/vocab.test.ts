import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';
import { BLOCKER_STATUS_VOCABULARY, STATUS_VOCABULARY, VARIANCE_CAUSES } from '../src/domain/vocab.js';
import { readSeedFile } from '../src/seed/load.js';

const SEED_PATH = 'docs/korp2-tracker-seed.json';

describe('closed vocabularies', () => {
  const raw = JSON.parse(readFileSync(SEED_PATH, 'utf8'));

  test('the app and the seed file agree on every vocabulary', () => {
    assert.deepEqual([...raw.statusVocabulary].sort(), [...STATUS_VOCABULARY].sort());
    assert.deepEqual([...raw.blockerStatusVocabulary].sort(), [...BLOCKER_STATUS_VOCABULARY].sort());
    assert.deepEqual([...raw.varianceCauses].sort(), [...VARIANCE_CAUSES].sort());
  });
});

describe('seed file', () => {
  const seed = readSeedFile(SEED_PATH);

  test('loads 46 build lines and 35 questions', () => {
    assert.equal(seed.buildLines.length, 46);
    assert.equal(seed.openQuestions.length, 35);
    assert.equal(seed.meta.baselineTotals.lineCount, 46);
  });

  test('duplicate refs survive as separate lines', () => {
    const byRef = (ref: string) => seed.buildLines.filter((l) => l.ref === ref).map((l) => l.id);
    assert.deepEqual(byRef('110358'), ['L06', 'L07']);
    assert.deepEqual(byRef('110391'), ['L30', 'L36']);
  });

  test('lines without a ref are allowed', () => {
    const noRef = seed.buildLines.filter((l) => l.ref === null).map((l) => l.id);
    assert.deepEqual(noRef, ['L08', 'L09']);
  });

  test('every id is unique and every blocker resolves to a question', () => {
    const ids = new Set(seed.buildLines.map((l) => l.id));
    assert.equal(ids.size, seed.buildLines.length);

    const questionRefs = new Set(seed.openQuestions.map((q) => q.ref));
    for (const line of seed.buildLines) {
      for (const blocker of line.blockers) {
        assert.ok(questionRefs.has(blocker), `${line.id} references unknown question ${blocker}`);
      }
    }
  });

  test('five questions are hard blockers', () => {
    const hard = seed.openQuestions.filter((q) => q.hardBlocker).map((q) => q.ref);
    assert.deepEqual(hard.sort(), ['G1', 'G15', 'G2', 'G3', 'R1']);
  });
});

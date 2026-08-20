import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { lineWarnings, summariseWarnings, type WarningInput } from '../src/domain/warnings.js';

function line(overrides: Partial<WarningInput>): WarningInput {
  return {
    id: 'L01',
    ref: '110328',
    shortName: 'CRM Section to Capture Health & Disability Information',
    status: 'NOT_STARTED',
    blockers: [],
    openHardBlockers: [],
    ...overrides,
  };
}

describe('consistency warnings', () => {
  test('a clean line raises nothing', () => {
    assert.deepEqual(lineWarnings(line({ status: 'IN_PROGRESS' })), []);
  });

  test('BLOCKED with no linked question is flagged', () => {
    const [warning, ...rest] = lineWarnings(line({ status: 'BLOCKED' }));
    assert.equal(warning?.code, 'BLOCKED_WITHOUT_BLOCKERS');
    assert.equal(rest.length, 0);
  });

  test('BLOCKED with a linked question is fine', () => {
    assert.deepEqual(lineWarnings(line({ status: 'BLOCKED', blockers: ['G6'] })), []);
  });

  test('a non-blocked status with an open hard blocker is flagged', () => {
    const warnings = lineWarnings(
      line({ status: 'IN_PROGRESS', blockers: ['G6', 'G15'], openHardBlockers: ['G15'] }),
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'UNBLOCKED_WITH_OPEN_HARD_BLOCKER');
    assert.match(warnings[0]?.detail ?? '', /G15/);
  });

  test('BLOCKED with an open hard blocker is the consistent case', () => {
    assert.deepEqual(
      lineWarnings(line({ status: 'BLOCKED', blockers: ['G15'], openHardBlockers: ['G15'] })),
      [],
    );
  });

  test('DESCOPED is exempt — an out-of-scope line cannot be blocked', () => {
    assert.deepEqual(
      lineWarnings(line({ status: 'DESCOPED', blockers: ['G15'], openHardBlockers: ['G15'] })),
      [],
    );
  });

  test('NOT_MINE is not exempt — BI still needs the answer', () => {
    const warnings = lineWarnings(line({ status: 'NOT_MINE', blockers: ['R1'], openHardBlockers: ['R1'] }));
    assert.equal(warnings.length, 1);
  });

  test('a warning carries shortName alongside ref', () => {
    const [warning] = lineWarnings(line({ status: 'BLOCKED' }));
    assert.equal(warning?.ref, '110328');
    assert.ok(warning?.shortName);
  });

  test('summarise groups by code', () => {
    const warnings = [
      ...lineWarnings(line({ id: 'L01', status: 'BLOCKED' })),
      ...lineWarnings(line({ id: 'L02', status: 'BLOCKED' })),
      ...lineWarnings(line({ id: 'L03', status: 'BUILT', openHardBlockers: ['R1'] })),
    ];
    assert.deepEqual(summariseWarnings(warnings), [
      { code: 'BLOCKED_WITHOUT_BLOCKERS', count: 2, lineIds: ['L01', 'L02'] },
      { code: 'UNBLOCKED_WITH_OPEN_HARD_BLOCKER', count: 1, lineIds: ['L03'] },
    ]);
  });
});

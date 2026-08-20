import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { auditValue, changeFor } from '../src/domain/audit.js';

describe('audit trail values', () => {
  test('null and undefined both record as null, distinct from "0"', () => {
    assert.equal(auditValue(null), null);
    assert.equal(auditValue(undefined), null);
    assert.equal(auditValue(0), '0');
    assert.equal(auditValue(''), '');
  });

  test('numbers keep their precision as text', () => {
    assert.equal(auditValue(1.25), '1.25');
    assert.equal(auditValue(0.5), '0.5');
  });
});

describe('change detection', () => {
  test('a real change produces a row', () => {
    assert.deepEqual(changeFor('status', 'NOT_STARTED', 'BUILT'), {
      field: 'status',
      from: 'NOT_STARTED',
      to: 'BUILT',
    });
  });

  test('setting a field to what it already holds produces nothing', () => {
    assert.equal(changeFor('status', 'BUILT', 'BUILT'), null);
    assert.equal(changeFor('actualDays', 2, 2), null);
  });

  test('clearing a value is a change', () => {
    assert.deepEqual(changeFor('actualDays', 2, null), { field: 'actualDays', from: '2', to: null });
  });

  test('setting a value that was empty is a change', () => {
    assert.deepEqual(changeFor('note', null, 'built'), { field: 'note', from: null, to: 'built' });
  });

  test('null to null is not a change', () => {
    assert.equal(changeFor('note', null, null), null);
  });

  test('zero is not treated as absent', () => {
    assert.deepEqual(changeFor('actualDays', null, 0), { field: 'actualDays', from: null, to: '0' });
  });
});

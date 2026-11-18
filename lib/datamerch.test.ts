import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normEin, showEin, parseMerchants, categories } from './datamerch.ts';

test('EIN: 9 digits in any common format, anything else rejected', () => {
  assert.equal(normEin('12-3456789'), '123456789');
  assert.equal(normEin(' 12 3456789 '), '123456789');
  assert.equal(normEin('12345678'), null);
  assert.equal(normEin('123-45-67890'), null);
  assert.equal(normEin(null), null);
  assert.equal(showEin('123456789'), '12-3456789');
});

test('empty responses mean nothing on file', () => {
  assert.deepEqual(parseMerchants([]), []);
  assert.deepEqual(parseMerchants({ data: [] }), []);
  assert.deepEqual(parseMerchants(null), []);
  assert.deepEqual(parseMerchants({ errors: null, data: null }), []);
});

test('wrapped merchants with notes', () => {
  const body = [{ merchant: {
    fein: '123456789', legal_name: 'Acme Services LLC', dba: 'Acme', city: 'Tampa', state: 'FL',
    notes: [
      { note: { category: 'Default', note: 'Stopped ACH after 3 months', created_at: '2026-03-02', added_by: 'XYZ Funding' } },
      { category: 'Stacking', note: 'Took 3 positions in 2 weeks', created_at: '2026-04-10', added_by: 'ABC Capital' },
    ],
  } }];
  const ms = parseMerchants(body);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].legal_name, 'Acme Services LLC');
  assert.equal(ms[0].notes[0].note, 'Stopped ACH after 3 months');
  assert.equal(ms[0].notes[1].added_by, 'ABC Capital');
  assert.deepEqual(categories(ms), ['Default', 'Stacking']);
});

test('{data: [...]} and a single object are both read', () => {
  assert.equal(parseMerchants({ data: [{ fein: '123456789', name: 'Acme', notes: [] }] })[0].legal_name, 'Acme');
  assert.equal(parseMerchants({ fein: '123456789', legal_name: 'Solo LLC' })[0].legal_name, 'Solo LLC');
});

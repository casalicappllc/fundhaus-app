import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLender, matchAll, paperGrade } from './matching.ts';
import type { Lender } from './types.ts';

const L = (o: Partial<Lender>): Lender => ({ id: '1', name: 'L', paper: 'B', min_revenue: 15000, min_tib_months: 12, min_fico: 580,
  max_positions: 2, min_amount: 10000, max_amount: 150000, factor_low: 1.28, factor_high: 1.42, commission_pct: 10, speed: null,
  excluded_industries: ['Cannabis'], notes: null, active: true, ...o });
const D = { monthly_revenue: 42000, tib_months: 50, fico: 612, positions: 1, amount_requested: 75000, industry: 'Automotive' };

test('a deal inside every limit passes at 100', () => {
  const m = matchLender(D, L({})); assert.equal(m.pass, true); assert.equal(m.score, 100);
});
test('limits are inclusive at the boundary', () => {
  const m = matchLender({ ...D, monthly_revenue: 15000, tib_months: 12, fico: 580, positions: 2, amount_requested: 150000 }, L({}));
  assert.equal(m.pass, true);
});
test('one point under a minimum fails that check only', () => {
  const m = matchLender({ ...D, fico: 579 }, L({}));
  assert.equal(m.pass, false); assert.equal(m.score, 80);
  assert.deepEqual(m.checks.filter(c => !c.ok).map(c => c.label), ['FICO']);
});
test('too many positions and amount over cap both fail', () => {
  const m = matchLender({ ...D, positions: 3, amount_requested: 150001 }, L({}));
  assert.deepEqual(m.checks.filter(c => !c.ok).map(c => c.label), ['Open positions', 'Amount']);
});
test('excluded industry fails, ignoring case and spaces', () => {
  assert.equal(matchLender({ ...D, industry: 'cannabis ' }, L({})).pass, false);
});
test('max amount of 0 means no cap', () => {
  assert.equal(matchLender({ ...D, amount_requested: 5000000 }, L({ max_amount: 0 })).pass, true);
});
test('matchAll skips inactive lenders and ranks best fit first', () => {
  const r = matchAll(D, [L({ id: 'a', min_fico: 700 }), L({ id: 'b' }), L({ id: 'c', active: false })]);
  assert.deepEqual(r.map(x => x.lender.id), ['b', 'a']);
});
test('paper grades', () => {
  assert.equal(paperGrade({ fico: 650, positions: 1 }), 'A');
  assert.equal(paperGrade({ fico: 649, positions: 1 }), 'B');
  assert.equal(paperGrade({ fico: 700, positions: 3 }), 'C');
});

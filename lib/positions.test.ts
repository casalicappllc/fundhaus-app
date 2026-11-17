import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekly, monthly, burden } from './positions.ts';

test('daily payments count 5 business days a week', () => {
  assert.equal(weekly({ payment: 500, frequency: 'daily' }), 2500);
  assert.equal(monthly({ payment: 500, frequency: 'daily' }), 10833.33);
});

test('weekly, every-2-weeks and monthly convert to weekly', () => {
  assert.equal(weekly({ payment: 8690.48, frequency: 'weekly' }), 8690.48);
  assert.equal(weekly({ payment: 1000, frequency: 'biweekly' }), 500);
  assert.equal(weekly({ payment: 5200, frequency: 'monthly' }), 1200);
  assert.equal(monthly({ payment: 9700, frequency: 'monthly' }), 9700);
});

test('burden totals only active positions and gives % of revenue', () => {
  const b = burden([
    { payment: 1000, frequency: 'weekly', status: 'active' },
    { payment: 200, frequency: 'daily', status: 'active' },
    { payment: 9999, frequency: 'weekly', status: 'paid_off' },
  ], 100000);
  assert.equal(b.count, 2);
  assert.equal(b.perWeek, 2000);
  assert.equal(b.perMonth, 8666.67);
  assert.equal(b.pct, 8.7);
});

test('no revenue means no percentage', () => {
  assert.equal(burden([{ payment: 100, frequency: 'weekly', status: 'active' }], 0).pct, null);
});

test('unknown frequency counts as zero rather than crashing', () => {
  assert.equal(weekly({ payment: 100, frequency: 'yearly' }), 0);
});

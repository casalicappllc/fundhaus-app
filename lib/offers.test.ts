import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerMath, parseNum, rateProblem, showRate, showTerm } from './offers.ts';

test('payback and spread from buy and sell rates', () => {
  const m = offerMath({ amount: 40000, buy_rate: 1.25, sell_rate: 1.35 });
  assert.equal(m.payback, 54000);
  assert.equal(m.points, 10);
  assert.equal(m.spread, 4000);
});
test('floating point does not leak into the numbers', () => {
  const m = offerMath({ amount: 75000, buy_rate: 1.29, sell_rate: 1.399 });
  assert.equal(m.points, 10.9);
  assert.equal(m.spread, 8175);
  assert.equal(m.payback, 104925);
});
test('only a buy rate: payback at buy, no spread', () => {
  assert.deepEqual(offerMath({ amount: 20000, buy_rate: 1.3, sell_rate: null }), { payback: 26000, points: null, spread: null, payment: null, estimated: false });
  assert.deepEqual(offerMath({ amount: 20000, buy_rate: null, sell_rate: null }), { payback: null, points: null, spread: null, payment: null, estimated: false });
});
test('typed numbers', () => {
  assert.equal(parseNum('$40,000'), 40000);
  assert.equal(parseNum('1.25'), 1.25);
  assert.equal(parseNum('1,25'), 1.25);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('abc'), null);
});
test('rates must look like factors', () => {
  assert.equal(rateProblem('Buy rate', 1.25), null);
  assert.equal(rateProblem('Buy rate', null), null);
  assert.match(rateProblem('Buy rate', 25)!, /factor like 1.25/);
  assert.match(rateProblem('Sell rate', 0.35)!, /factor/);
});
test('rates show without trailing zero noise', () => {
  assert.equal(showRate(1.25), '1.25');
  assert.equal(showRate(1.399), '1.399');
  assert.equal(showRate(null), '—');
});
test('daily or weekly term gives the payment', () => {
  assert.equal(offerMath({ amount: 40000, buy_rate: 1.25, sell_rate: 1.35, term_count: 120 }).payment, 450);   // $54,000 / 120 days
  assert.equal(offerMath({ amount: 40000, buy_rate: 1.25, sell_rate: 1.35, term_count: 26 }).payment, 2076.92); // weekly
  assert.equal(offerMath({ amount: 40000, buy_rate: 1.25, sell_rate: 1.35, term_count: null }).payment, null);
  assert.equal(showTerm({ term_freq: 'daily', term_count: 120 }), '120 daily');
  assert.equal(showTerm({ term_freq: 'weekly', term_count: 26 }), '26 weekly');
  assert.equal(showTerm({ term_freq: 'weekly', term_count: null }), 'Weekly');
  assert.equal(showTerm({ term_freq: null, term_count: null }), '—');
});
test('a typed payment wins over the worked-out one', () => {
  const quoted = offerMath({ amount: 40000, buy_rate: 1.25, sell_rate: 1.35, term_count: 120, payment: 462.5 });
  assert.equal(quoted.payment, 462.5);
  assert.equal(quoted.estimated, false);
  const worked = offerMath({ amount: 40000, buy_rate: 1.25, sell_rate: 1.35, term_count: 120, payment: null });
  assert.equal(worked.payment, 450);
  assert.equal(worked.estimated, true);
  assert.equal(offerMath({ amount: 40000, buy_rate: null, sell_rate: null, payment: 500 }).payment, 500); // payment alone is fine
});

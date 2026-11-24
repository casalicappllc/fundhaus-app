import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planUpdate, statementTotals, monthsSince, sameFunder, planBatches, mergeExtractions, statementName, planRenames, statementSortKey, PLACEHOLDER_NAME, type Extraction, type StatementMonth, type FoundPosition } from './autofill.ts';
import type { Deal } from './types.ts';

const today = new Date('2026-11-18T12:00:00Z');
const blank: Deal = {
  id: 'd1', business: PLACEHOLDER_NAME, owner_name: null, phone: null, email: null, city: null, industry: 'Other',
  monthly_revenue: 0, tib_months: 0, fico: 0, positions: 0, nsf_90d: 0, amount_requested: 0, use_of_funds: null,
  stage: 'new', funded_amount: null, commission: null, notes: null, created_at: '2026-11-18',
};
const mo = (month: string, rev: number, nsf = 0, full = true, total = rev): StatementMonth => ({
  month, account: 'Chase business checking', full_month: full, total_deposits: total, revenue_deposits: rev,
  deposit_count: 20, nsf_count: nsf, negative_days: 0, ending_balance: 5000, avg_daily_balance: 8000,
});
const ex = (over: Partial<Extraction> = {}): Extraction => ({
  application: {
    business_name: 'Sunrise Diner LLC', dba: null, ein: '82-1234567', owner_name: 'Maria Lopez', phone: '302-555-0100', email: 'Maria@Sunrise.com',
    city: 'Wilmington', state: 'DE', business_start_date: '2021-05', years_in_business: null, industry: 'Restaurant',
    amount_requested: 50000, use_of_funds: 'Equipment', credit_score: null,
  },
  statements: [mo('2026-08', 60000, 1), mo('2026-09', 66000), mo('2026-10', 72000, 2), mo('2026-11', 20000, 0, false)],
  positions: [], flags: [], statement_business_name: 'SUNRISE DINER LLC', ...over,
});

test('months in business from a start date', () => {
  assert.equal(monthsSince('2021-05', today), 66);
  assert.equal(monthsSince('2026-11-02', today), 0);
  assert.equal(monthsSince('2027-01', today), null);
  assert.equal(monthsSince('May 2021', today), null);
});

test('revenue averages full months only; NSFs from the latest three months', () => {
  const t = statementTotals(ex().statements);
  assert.equal(t.avg_revenue, 66000);  // (60k + 66k + 72k) / 3, partial November left out
  assert.equal(t.nsf_90d, 2);          // Sep 0 + Oct 2 + Nov 0
  assert.equal(t.months_used, 3);
});

test('two accounts in one month count as one month', () => {
  const s = [mo('2026-09', 40000), { ...mo('2026-09', 10000), account: 'BofA checking' }, mo('2026-10', 50000)];
  assert.equal(statementTotals(s).avg_revenue, 50000);
});

test('only partial months: average them anyway', () => {
  assert.equal(statementTotals([mo('2026-11', 30000, 0, false)]).avg_revenue, 30000);
});

test('a blank deal fills itself from the documents', () => {
  const { update, flags } = planUpdate(blank, ex(), [], today);
  assert.equal(update.business, 'Sunrise Diner LLC');
  assert.equal(update.owner_name, 'Maria Lopez');
  assert.equal(update.ein, '821234567');
  assert.equal(update.email, 'maria@sunrise.com');
  assert.equal(update.city, 'Wilmington, DE');
  assert.equal(update.industry, 'Restaurant');
  assert.equal(update.tib_months, 66);
  assert.equal(update.amount_requested, 50000);
  assert.equal(update.monthly_revenue, 66000);
  assert.equal(update.nsf_90d, 2);
  assert.equal(update.fico, undefined);       // never guessed
  assert.deepEqual(flags, []);                // same name on statements, 3 full months
});

test('nothing a broker typed is overwritten, but statement figures update', () => {
  const typed = { ...blank, business: 'Sunrise Diner', owner_name: 'Maria L.', monthly_revenue: 80000, fico: 640, auto_generated_at: '2026-11-17' };
  const { update, changed } = planUpdate(typed, ex(), [], today);
  assert.equal(update.business, undefined);
  assert.equal(update.owner_name, undefined);
  assert.equal(update.fico, undefined);
  assert.equal(update.monthly_revenue, 66000);
  assert.ok(changed.includes('Monthly revenue: $80,000 → $66,000 (statement average)'));
});

test('active positions are added once; paid-off and duplicate ones are not', () => {
  const positions: Extraction['positions'] = [
    { funder: 'Forward Financing', kind: 'mca', payment: 389.5, frequency: 'daily', first_seen: '2026-08-01', last_seen: '2026-11-14', still_active: true, funded_amount: 40000, funded_on: '2026-07-30' },
    { funder: 'Kapitus', kind: 'mca', payment: 1200, frequency: 'weekly', first_seen: '2026-08-04', last_seen: '2026-11-10', still_active: true, funded_amount: null, funded_on: null },
    { funder: 'OnDeck', kind: 'loan', payment: 900, frequency: 'weekly', first_seen: '2026-08-01', last_seen: '2026-09-15', still_active: false, funded_amount: null, funded_on: null },
  ];
  const { add, update } = planUpdate(blank, ex({ positions }), [{ funder: 'Kapitus LLC', status: 'active' }], today);
  assert.deepEqual(add.map(p => p.funder), ['Forward Financing']);
  assert.equal(add[0].payment, 389.5);
  assert.equal(add[0].funded_on, '2026-07-30');
  assert.equal(update.positions, 2);          // Kapitus already listed + Forward Financing
});

test('flags: short history and a different name on the statements', () => {
  const { flags } = planUpdate(blank, ex({ statements: [mo('2026-10', 50000)], statement_business_name: 'JOHN DOE' }), [], today);
  assert.ok(flags.some(f => f.startsWith('Only 1 full month')));
  assert.ok(flags.some(f => f.includes('JOHN DOE')));
});

test('DBA counts as a matching name', () => {
  const e = ex({ statement_business_name: 'Sunrise Eats' });
  e.application.dba = 'Sunrise Eats';
  const { flags, update } = planUpdate(blank, e, [], today);
  assert.equal(update.business, 'Sunrise Diner LLC DBA Sunrise Eats');
  assert.deepEqual(flags, []);
});

test('never leaves the placeholder name', () => {
  const e = ex({ statement_business_name: null });
  e.application.business_name = null;
  assert.equal(planUpdate(blank, e, [], today).update.business, 'Unnamed business — check application');
});

test('funder names match loosely', () => {
  assert.ok(sameFunder('FORWARD FINANCING LLC', 'Forward Financing'));
  assert.ok(!sameFunder('Kapitus', 'OnDeck'));
});

// ---- Several accounts: batches and merging ----

test('statements are split into batches by count and size, in order', () => {
  const f = (n: number, mb: number) => ({ id: String(n), size_bytes: mb * 1048576 });
  const twelve = Array.from({ length: 12 }, (_, i) => f(i, 1));
  assert.deepEqual(planBatches(twelve, 20 * 1048576, 6).map(b => b.length), [6, 6]);
  assert.deepEqual(planBatches([f(1, 8), f(2, 8), f(3, 8), f(4, 1)], 20 * 1048576, 6).map(b => b.map(x => x.id)), [['1', '2'], ['3', '4']]);
  assert.deepEqual(planBatches([f(1, 30)], 20 * 1048576, 6).length, 1); // an oversized file still gets its own batch
  assert.deepEqual(planBatches([], 20 * 1048576, 6), []);
});

const pos = (funder: string, over: Partial<FoundPosition> = {}): FoundPosition => ({
  funder, kind: 'mca', payment: 500, frequency: 'daily', first_seen: '2026-08-03', last_seen: '2026-11-14',
  still_active: true, funded_amount: null, funded_on: null, ...over,
});
const acct = (account: string, month: string, rev: number): StatementMonth => ({ ...mo(month, rev), account });

test('three accounts read in separate batches add up month by month', () => {
  const months = ['2026-08', '2026-09', '2026-10', '2026-11'];
  const a = ex({ statements: months.map(m => acct('Chase business checking', m, 40000)) });
  const blankApp = Object.fromEntries(Object.keys(a.application).map(k => [k, ''])) as unknown as Extraction['application'];
  const b = ex({ application: blankApp, statements: months.map(m => acct('Wells Fargo business checking', m, 15000)), statement_business_name: '' });
  const c = ex({ application: blankApp, statements: months.map(m => acct('Bluevine business checking', m, 5000)) });
  const merged = mergeExtractions([a, b, c]);
  assert.equal(merged.statements.length, 12);
  assert.equal(merged.application.business_name, 'Sunrise Diner LLC');
  assert.equal(statementTotals(merged.statements).avg_revenue, 60000); // 40k + 15k + 5k a month
  const { update } = planUpdate(blank, merged, [], today);
  assert.equal(update.monthly_revenue, 60000);
});

test('the same statement read twice is kept once', () => {
  const s = [acct('Chase business checking', '2026-10', 50000)];
  assert.equal(mergeExtractions([ex({ statements: s }), ex({ statements: s })]).statements.length, 1);
});

test('a funder seen on two accounts becomes one position with the newest payment', () => {
  const a = ex({ positions: [pos('Fox Funding LLC', { payment: 450, last_seen: '2026-10-20' })] });
  const b = ex({ positions: [pos('FOX FUNDING', { payment: 600, last_seen: '2026-11-14', first_seen: '2026-07-01' })] });
  const m = mergeExtractions([a, b]);
  assert.equal(m.positions.length, 1);
  assert.equal(m.positions[0].payment, 600);
  assert.equal(m.positions[0].first_seen, '2026-07-01');
  assert.equal(m.positions[0].last_seen, '2026-11-14');
});

test('a funder that stopped months before the latest statement is not active', () => {
  const a = ex({ statements: [acct('Chase business checking', '2026-07', 50000)], positions: [pos('Old Capital', { last_seen: '2026-07-28' })] });
  const b = ex({ statements: [acct('Chase business checking', '2026-10', 50000)], positions: [] });
  assert.equal(mergeExtractions([a, b]).positions[0].still_active, false);
});

test('one batch passes through untouched', () => {
  const one = ex();
  assert.equal(mergeExtractions([one]), one);
});

// ---- Renaming statements ----

test('statement names: month, year, last 4', () => {
  assert.equal(statementName({ first_month: '2026-11', last_month: '2026-11', last4: '1234' }), 'November 2026 xxxx1234');
  assert.equal(statementName({ first_month: '2026-09', last_month: '2026-11', last4: '1234' }), 'September–November 2026 xxxx1234');
  assert.equal(statementName({ first_month: '2025-12', last_month: '2026-01', last4: '0042' }), 'December 2025–January 2026 xxxx0042');
  assert.equal(statementName({ first_month: '2026-11', last_month: '', last4: '' }), 'November 2026');
  assert.equal(statementName({ first_month: '2026-11', last_month: '2026-11', last4: '123456789' }), 'November 2026'); // never more than 4 digits
  assert.equal(statementName({ first_month: '', last_month: '', last4: '1234' }), null);
  assert.equal(statementName({ first_month: '2026-13', last_month: '2026-13', last4: '1234' }), null);
});

test('renames keep the extension, never clash, and skip what is already right', () => {
  const docs = [
    { id: 'a', file_name: 'stmt (1).PDF' }, { id: 'b', file_name: 'scan0042.pdf' }, { id: 'c', file_name: 'November 2026 xxxx1234.pdf' },
    { id: 'd', file_name: 'mystery.pdf' }, { id: 'app', file_name: 'Application.pdf' },
  ];
  const f = (id: string, month: string, last4: string) => ({ id, ref: id, first_month: month, last_month: month, last4 });
  const out = planRenames(docs, [f('a', '2026-10', '1234'), f('b', '2026-11', '1234'), f('c', '2026-11', '1234'), f('d', '', '')]);
  assert.deepEqual(out, [
    { id: 'a', file_name: 'October 2026 xxxx1234.pdf' },
    { id: 'b', file_name: 'November 2026 xxxx1234.pdf' },
    { id: 'c', file_name: 'November 2026 xxxx1234 (2).pdf' },   // same month and account uploaded twice
  ]);
  // Reading again changes nothing once names are settled.
  const settled = [{ id: 'a', file_name: 'October 2026 xxxx1234.pdf' }, { id: 'b', file_name: 'November 2026 xxxx1234.pdf' }];
  assert.deepEqual(planRenames(settled, [f('a', '2026-10', '1234'), f('b', '2026-11', '1234')]), []);
});

test('renamed statements sort by account, then date', () => {
  const names = ['November 2026 xxxx9999.pdf', 'October 2026 xxxx1234.pdf', 'September 2026 xxxx9999.pdf', 'November 2026 xxxx1234.pdf'];
  assert.deepEqual([...names].sort((a, b) => statementSortKey(a).localeCompare(statementSortKey(b))),
    ['October 2026 xxxx1234.pdf', 'November 2026 xxxx1234.pdf', 'September 2026 xxxx9999.pdf', 'November 2026 xxxx9999.pdf']);
});

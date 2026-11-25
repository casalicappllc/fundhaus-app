import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmails, recipients, draftEmail, personalize, balancesLine, packAttachments, partEmail } from './submit.ts';
import type { Deal } from './types.ts';

const deal: Deal = {
  id: 'd', business: 'DUPAGE PAPER STOCK INC', owner_name: null, phone: null, email: null, city: 'East Dundee, IL', industry: 'Wholesale',
  monthly_revenue: 390262, tib_months: 571, fico: 0, positions: 5, nsf_90d: 6, amount_requested: 0, use_of_funds: null,
  stage: 'new', funded_amount: null, commission: null, notes: null, created_at: '',
};

test('emails: cleaned, lowercased, de-duplicated, junk dropped', () => {
  assert.deepEqual(parseEmails('Underwriting@VPS.com, amc@vps.com; amc@vps.com  bad@ x@y'), ['underwriting@vps.com', 'amc@vps.com']);
  assert.deepEqual(parseEmails(''), []);
});

test('first email is To, the rest CC', () => {
  assert.deepEqual(recipients({ submit_emails: ['a@x.com', 'b@x.com', 'c@x.com'] }), { to: 'a@x.com', cc: ['b@x.com', 'c@x.com', 'funding@assured-assets.com', 'admin@assured-assets.net'] });
  assert.deepEqual(recipients({ submit_emails: ['submissions@avanza.nyc'] }), { to: 'submissions@avanza.nyc', cc: ['funding@assured-assets.com', 'admin@assured-assets.net'] });
  // Never copied twice, even if a lender's list already has it.
  assert.deepEqual(recipients({ submit_emails: ['a@x.com', 'Funding@Assured-Assets.com'] }), { to: 'a@x.com', cc: ['funding@assured-assets.com', 'admin@assured-assets.net'] });
  assert.deepEqual(recipients({ submit_emails: [] }), { to: null, cc: [] });
});

test('draft leaves out what is unknown', () => {
  const { subject, text } = draftEmail(deal, 5);
  assert.equal(subject, 'New submission: DUPAGE PAPER STOCK INC');
  assert.ok(text.includes('Average monthly revenue: $390,262'));
  assert.ok(text.includes('Time in business: 47.6 years'));
  assert.ok(!text.includes('Amount requested'));
  assert.ok(text.includes('admin@assured-assets.net'));
});

test('each lender is greeted by name', () => {
  const { text } = draftEmail(deal, 5);
  assert.ok(text.startsWith('Hi {lender} team,'));
  assert.ok(personalize(text, 'Kapitus').startsWith('Hi Kapitus team,'));
});

test('subject shows the amount when there is one', () => {
  assert.equal(draftEmail({ ...deal, amount_requested: 150000 }, 5).subject, 'New submission: DUPAGE PAPER STOCK INC — $150,000 requested');
});

test('{lender} is filled in per lender', () => {
  assert.equal(personalize('Hi {lender} team', 'Kapitus'), 'Hi Kapitus team');
});

test('Balances lists each funder with its payment, right under Open positions', () => {
  const funders = [
    { funder: 'Kapitus', payment: 1250, frequency: 'daily' },
    { funder: 'Fox Funding', payment: 2400, frequency: 'weekly' },
    { funder: 'Pearl', payment: 899.5, frequency: 'daily' },
    { funder: 'New One', payment: 0, frequency: 'daily' },
  ];
  assert.equal(balancesLine(funders), 'Kapitus $1,250/day · Fox Funding $2,400/wk · Pearl $899.50/day · New One');
  const { text } = draftEmail(deal, 4, funders);
  assert.ok(text.includes('Open positions: 4\nBalances: Kapitus $1,250/day'));
  assert.ok(!draftEmail(deal, 0, []).text.includes('Balances'));
});

// ---- Splitting a big submission across emails ----
const MB = 1048576;
const doc = (file_name: string, kind: string, mb: number) => ({ file_name, kind, size_bytes: mb * MB });

test('a normal deal goes in one email, application first', () => {
  const { parts, tooBig } = packAttachments([doc('Chase Oct.pdf', 'bank_statement', 2), doc('ID.jpg', 'id', 1), doc('App.pdf', 'application', 1), doc('Chase Sep.pdf', 'bank_statement', 2)]);
  assert.equal(tooBig.length, 0);
  assert.deepEqual(parts.map(p => p.map(d => d.file_name)), [['App.pdf', 'Chase Oct.pdf', 'Chase Sep.pdf', 'ID.jpg']]);
});

test('twelve statements over 18 MB are split into parts, none over the limit', () => {
  const docs = [doc('App.pdf', 'application', 1), ...Array.from({ length: 12 }, (_, i) => doc(`Statement ${i + 1}.pdf`, 'bank_statement', 3))];
  const { parts, tooBig } = packAttachments(docs);
  assert.equal(tooBig.length, 0);
  assert.equal(parts.length, 3);
  assert.equal(parts[0][0].file_name, 'App.pdf');
  assert.equal(parts.flat().length, 13);                    // nothing dropped
  assert.deepEqual(parts[0].slice(1, 3).map(d => d.file_name), ['Statement 1.pdf', 'Statement 2.pdf']); // 1, 2 ... not 1, 10, 11
  for (const p of parts) assert.ok(p.reduce((n, d) => n + d.size_bytes, 0) <= 18 * MB);
});

test('a file too big for any email is reported, not sent', () => {
  const { parts, tooBig } = packAttachments([doc('App.pdf', 'application', 1), doc('Scan.pdf', 'bank_statement', 22)]);
  assert.deepEqual(tooBig.map(d => d.file_name), ['Scan.pdf']);
  assert.equal(parts.flat().length, 1);
});

test('follow-up emails say which part they are', () => {
  const e = partEmail('New submission: Sunrise Diner', 'Sunrise Diner', 2, 3, 5);
  assert.equal(e.subject, 'New submission: Sunrise Diner (part 2 of 3)');
  assert.match(e.text, /Part 2 of 3 for Sunrise Diner: 5 more files attached/);
});

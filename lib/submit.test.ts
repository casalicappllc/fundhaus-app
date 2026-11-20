import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmails, recipients, draftEmail, personalize } from './submit.ts';
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
  assert.deepEqual(recipients({ submit_emails: ['a@x.com', 'b@x.com', 'c@x.com'] }), { to: 'a@x.com', cc: ['b@x.com', 'c@x.com', 'funding@assured-assets.com'] });
  assert.deepEqual(recipients({ submit_emails: ['submissions@avanza.nyc'] }), { to: 'submissions@avanza.nyc', cc: ['funding@assured-assets.com'] });
  // Never copied twice, even if a lender's list already has it.
  assert.deepEqual(recipients({ submit_emails: ['a@x.com', 'Funding@Assured-Assets.com'] }), { to: 'a@x.com', cc: ['funding@assured-assets.com'] });
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

test('subject shows the amount when there is one', () => {
  assert.equal(draftEmail({ ...deal, amount_requested: 150000 }, 5).subject, 'New submission: DUPAGE PAPER STOCK INC — $150,000 requested');
});

test('{lender} is filled in per lender', () => {
  assert.equal(personalize('Hi {lender} team', 'Kapitus'), 'Hi Kapitus team');
});

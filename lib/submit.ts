// Building the email a deal goes out to lenders with. Pure functions, tested in submit.test.ts.
import type { Deal, Lender } from './types.ts';

const $ = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;

/** Cleans a typed list of emails ("a@x.com, b@y.com; c@z.com") into a lowercase, de-duplicated list. */
export function parseEmails(s: string | null | undefined): string[] {
  const out: string[] = [];
  for (const e of String(s ?? '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))
    if (EMAIL.test(e) && !out.includes(e)) out.push(e);
  return out;
}

/** Copied on every email to every lender, so the team has a record of each submission. */
export const ALWAYS_CC = ['funding@assured-assets.com'];

/** First address is To, the rest are CC, plus ALWAYS_CC on every email. */
export function recipients(l: Pick<Lender, 'submit_emails'>) {
  const list = (l.submit_emails ?? []).filter(e => EMAIL.test(e)).map(e => e.toLowerCase());
  const to = list[0] ?? null;
  if (!to) return { to, cc: [] as string[] };
  const cc = list.slice(1);
  for (const e of ALWAYS_CC) if (e !== to && !cc.includes(e)) cc.push(e);
  return { to, cc };
}

/** Default subject and message. Each lender gets its own email, so lenders never see each other. */
export function draftEmail(d: Deal, activePositions: number) {
  const name = d.business;
  const subject = `New submission: ${name}${d.amount_requested ? ' — ' + $(d.amount_requested) + ' requested' : ''}`;
  const line = (label: string, v: string | null | false | undefined) => (v ? `${label}: ${v}` : null);
  const facts = [
    line('Business', name),
    line('Location', d.city),
    line('Industry', d.industry && d.industry !== 'Other' ? d.industry : null),
    line('Time in business', d.tib_months ? `${(d.tib_months / 12).toFixed(1)} years` : null),
    line('Average monthly revenue', d.monthly_revenue ? $(d.monthly_revenue) : null),
    line('Open positions', String(activePositions)),
    line('NSFs, last 90 days', String(d.nsf_90d)),
    line('Amount requested', d.amount_requested ? $(d.amount_requested) : null),
    line('Use of funds', d.use_of_funds),
  ].filter(Boolean).join('\n');
  const text = `Hi {lender} team,\n\nPlease review the deal below. The application and bank statements are attached.\n\n${facts}\n\nLet us know if you need anything else to get us an offer.\n\nThank you,\nAssured Assets\nadmin@assured-assets.net`;
  return { subject, text };
}

/** Lender name and deal name dropped into a message the broker may have edited. */
export const personalize = (text: string, lenderName: string) => text.replace(/\{lender\}/g, lenderName);

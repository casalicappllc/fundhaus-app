// Building the email a deal goes out to lenders with. Pure functions, tested in submit.test.ts.
import type { Deal, Lender } from './types.ts';
import { FREQ_SHORT } from './positions.ts';

const $ = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
/** Exact dollars: whole amounts as $1,250, cents kept when there are any ($899.50). */
const money = (n: number) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

export type FunderLine = { funder: string; payment: number; frequency: string };

/** "Kapitus $1,250/day · Fox Funding $2,400/wk" — just the name when no payment is known yet. */
export function balancesLine(active: FunderLine[]): string | null {
  const parts = active
    .filter(p => String(p.funder ?? '').trim())
    .map(p => Number(p.payment) > 0 ? `${p.funder.trim()} ${money(p.payment)}${FREQ_SHORT[p.frequency] ?? ''}` : p.funder.trim());
  return parts.length ? parts.join(' · ') : null;
}

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
export function draftEmail(d: Deal, activePositions: number, active: FunderLine[] = []) {
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
    line('Balances', balancesLine(active)),
    line('NSFs, last 90 days', String(d.nsf_90d)),
    line('Amount requested', d.amount_requested ? $(d.amount_requested) : null),
    line('Use of funds', d.use_of_funds),
  ].filter(Boolean).join('\n');
  const text = `Hi {lender} team,\n\nPlease review the deal below. The application and bank statements are attached.\n\n${facts}\n\nLet us know if you need anything else to get us an offer.\n\nThank you,\nAssured Assets\nadmin@assured-assets.net`;
  return { subject, text };
}

/** Lender name and deal name dropped into a message the broker may have edited. */
export const personalize = (text: string, lenderName: string) => text.replace(/\{lender\}/g, lenderName);

// ---- Big submissions: several accounts' statements rarely fit in one email --------------------

/** Most mail servers cap a message at ~25 MB once encoded, so each email carries at most this much. */
export const MAX_EMAIL_BYTES = 18 * 1024 * 1024;
/** More parts than this and lenders stop reading; ask the broker to trim instead. */
export const MAX_EMAIL_PARTS = 4;

const KIND_ORDER: Record<string, number> = { application: 0, bank_statement: 1 };

/** Splits the attachments into emails of at most `max` bytes each: application first, then statements
 *  in name order (so each bank's months stay together), then everything else. Files that won't fit
 *  in any email on their own come back in `tooBig`. */
export function packAttachments<T extends { kind: string; file_name: string; size_bytes: number }>(docs: T[], max = MAX_EMAIL_BYTES) {
  const sorted = [...docs].sort((a, b) =>
    (KIND_ORDER[a.kind] ?? 2) - (KIND_ORDER[b.kind] ?? 2) || a.file_name.localeCompare(b.file_name, undefined, { numeric: true }));
  const tooBig = sorted.filter(d => Number(d.size_bytes) > max);
  const parts: T[][] = [];
  let cur: T[] = [], bytes = 0;
  for (const d of sorted) {
    const b = Number(d.size_bytes) || 0;
    if (b > max) continue;
    if (cur.length && bytes + b > max) { parts.push(cur); cur = []; bytes = 0; }
    cur.push(d); bytes += b;
  }
  if (cur.length) parts.push(cur);
  return { parts, tooBig };
}

/** Subject and message for part 2, 3 ... of a submission (part 1 is the broker's own email). */
export function partEmail(subject: string, business: string, part: number, of: number, files: number) {
  return {
    subject: `${subject} (part ${part} of ${of})`,
    text: `Hi {lender} team,\n\nPart ${part} of ${of} for ${business}: ${files} more file${files === 1 ? '' : 's'} attached (bank statements were too large for one email).\n\nThank you,\nAssured Assets\nadmin@assured-assets.net`,
  };
}

import type { Deal, Lender } from './types.ts';

export type Check = { label: string; ok: boolean; got: string; need: string };
export type Match = { lender: Lender; checks: Check[]; score: number; pass: boolean };

type DealFacts = Pick<Deal, 'monthly_revenue' | 'tib_months' | 'fico' | 'positions' | 'amount_requested' | 'industry'>;
const $ = (n: number) => '$' + n.toLocaleString('en-US');
const WEIGHTS = [22, 18, 20, 20, 12, 8]; // revenue, time in business, FICO, positions, amount, industry

export function matchLender(deal: DealFacts, l: Lender): Match {
  const excluded = l.excluded_industries.map(x => x.trim().toLowerCase()).filter(Boolean);
  const checks: Check[] = [
    { label: 'Monthly revenue', ok: deal.monthly_revenue >= l.min_revenue, got: $(deal.monthly_revenue), need: 'min ' + $(l.min_revenue) },
    { label: 'Time in business', ok: deal.tib_months >= l.min_tib_months, got: deal.tib_months + ' mo', need: 'min ' + l.min_tib_months + ' mo' },
    { label: 'FICO', ok: deal.fico >= l.min_fico, got: String(deal.fico), need: 'min ' + l.min_fico },
    { label: 'Open positions', ok: deal.positions <= l.max_positions, got: String(deal.positions), need: 'max ' + l.max_positions },
    { label: 'Amount', ok: deal.amount_requested >= l.min_amount && (l.max_amount === 0 || deal.amount_requested <= l.max_amount),
      got: $(deal.amount_requested), need: $(l.min_amount) + '–' + (l.max_amount ? $(l.max_amount) : 'no cap') },
    { label: 'Industry', ok: !excluded.includes(deal.industry.trim().toLowerCase()), got: deal.industry, need: excluded.length ? 'not ' + excluded.join(', ') : 'any' },
  ];
  const score = checks.reduce((s, c, i) => s + (c.ok ? WEIGHTS[i] : 0), 0);
  return { lender: l, checks, score, pass: checks.every(c => c.ok) };
}

export function matchAll(deal: DealFacts, lenders: Lender[]): Match[] {
  return lenders.filter(l => l.active).map(l => matchLender(deal, l))
    .sort((a, b) => b.score - a.score || (b.lender.commission_pct ?? 0) - (a.lender.commission_pct ?? 0));
}

export function paperGrade(d: Pick<Deal, 'fico' | 'positions'>): 'A' | 'B' | 'C' {
  if (d.fico >= 650 && d.positions <= 1) return 'A';
  if (d.fico >= 580 && d.positions <= 2) return 'B';
  return 'C';
}

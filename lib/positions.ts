// Payment math for a merchant's existing MCAs and loans.
// MCAs debit on business days: 5 a week, about 21.67 a month (260 / 12).

export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type PositionLike = { payment: number; frequency: string; status: string };

const PER_WEEK: Record<Frequency, number> = { daily: 5, weekly: 1, biweekly: 0.5, monthly: 12 / 52 };

export const FREQUENCIES: [Frequency, string][] = [['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']];
export const POSITION_KINDS: [string, string][] = [['mca', 'MCA'], ['loan', 'Loan'], ['loc', 'Line of credit'], ['other', 'Other']];
export const FREQ_SHORT: Record<string, string> = { daily: '/day', weekly: '/wk', biweekly: '/2 wk', monthly: '/mo' };

const r2 = (n: number) => Math.round(n * 100) / 100;

const perWeekRaw = (p: Pick<PositionLike, 'payment' | 'frequency'>) => Number(p.payment) * (PER_WEEK[p.frequency as Frequency] ?? 0);

// Round only at the end, so a $9,700 monthly payment stays $9,700 a month.
export function weekly(p: Pick<PositionLike, 'payment' | 'frequency'>): number {
  return r2(perWeekRaw(p));
}
export function monthly(p: Pick<PositionLike, 'payment' | 'frequency'>): number {
  return r2(perWeekRaw(p) * 52 / 12);
}

/** Totals across active positions, and the share of monthly revenue they take. */
export function burden(positions: PositionLike[], monthlyRevenue: number) {
  const active = positions.filter(p => p.status === 'active');
  const raw = active.reduce((s, p) => s + perWeekRaw(p), 0);
  const perWeek = r2(raw);
  const perMonth = r2(raw * 52 / 12);
  const pct = monthlyRevenue > 0 ? Math.round((raw * 52 / 12 / monthlyRevenue) * 1000) / 10 : null;
  return { count: active.length, perWeek, perMonth, pct };
}

/** Leverage = monthly payments on active positions ÷ monthly revenue.
 *  Under 25% light (green), 25–35% moderate (light yellow), 35–48% heavy (yellow), 48%+ very heavy (red). */
export type LeverageBand = 'light' | 'moderate' | 'heavy' | 'very heavy';
export function leverageBand(pct: number | null): LeverageBand | null {
  if (pct == null) return null;
  return pct >= 48 ? 'very heavy' : pct >= 35 ? 'heavy' : pct >= 25 ? 'moderate' : 'light';
}

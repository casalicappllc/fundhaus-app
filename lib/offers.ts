// Offers lenders come back with on a deal. Pure math, tested in offers.test.ts.

export type Offer = {
  id: string; deal_id: string; lender_id: string | null; lender_name: string;
  amount: number; buy_rate: number | null; sell_rate: number | null;
  term_freq: 'daily' | 'weekly' | null; term_count: number | null; // e.g. 120 daily payments, or 26 weekly
  payment?: number | null; // the daily or weekly payment the lender quoted; worked out from the term when blank
  notes: string | null; created_by: string | null; created_at: string;
};

/** "1.25", "1,25" or "$40,000" typed into a box -> a number, or null when blank or not a number. */
export function parseNum(v: unknown): number | null {
  const s = String(v ?? '').replace(/[$\s]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A factor rate as typed: 1.25 stays 1.25; "25" or "125" (points) are not guessed at. Returns an error message when it can't be right. */
export function rateProblem(label: string, r: number | null): string | null {
  if (r == null) return null;
  return r < 1 || r >= 3 ? `${label} should be a factor like 1.25 (you typed ${r}).` : null;
}

/** What an offer works out to.
 *  payback = amount x sell rate (what the merchant repays; buy rate if no sell rate yet)
 *  spread  = amount x (sell rate - buy rate), the broker's markup.
 *  payment = payback / number of payments. */
export function offerMath(o: Pick<Offer, 'amount' | 'buy_rate' | 'sell_rate'> & Partial<Pick<Offer, 'term_count' | 'payment'>>) {
  const amount = Number(o.amount) || 0;
  const buy = o.buy_rate == null ? null : Number(o.buy_rate), sell = o.sell_rate == null ? null : Number(o.sell_rate);
  const rate = sell ?? buy;
  const payback = rate ? Math.round(amount * rate) : null;
  const points = buy != null && sell != null ? Math.round((sell - buy) * 1000) / 10 : null; // 1.25 -> 1.35 = 10 points
  const spread = points != null ? Math.round(amount * (sell! - buy!)) : null;
  // The lender's quoted payment wins; otherwise payback spread evenly over the number of payments.
  const quoted = o.payment != null && Number(o.payment) > 0 ? Math.round(Number(o.payment) * 100) / 100 : null;
  const payment = quoted ?? (payback && o.term_count ? Math.round((payback / o.term_count) * 100) / 100 : null);
  return { payback, points, spread, payment, estimated: quoted == null && payment != null };
}

/** "120 daily", "26 weekly", just "Daily", or "—". */
export function showTerm(o: Pick<Offer, 'term_freq' | 'term_count'>) {
  if (!o.term_freq) return o.term_count ? `${o.term_count} payments` : '—';
  return o.term_count ? `${o.term_count} ${o.term_freq}` : o.term_freq === 'daily' ? 'Daily' : 'Weekly';
}

export const showRate = (r: number | null) => (r == null ? '—' : Number(r).toFixed(3).replace(/0$/, ''));

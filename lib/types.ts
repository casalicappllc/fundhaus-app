export type Lender = {
  id: string; name: string; paper: string;
  min_revenue: number; min_tib_months: number; min_fico: number; max_positions: number;
  min_amount: number; max_amount: number;
  factor_low: number | null; factor_high: number | null; commission_pct: number | null;
  speed: string | null; excluded_industries: string[]; notes: string | null; active: boolean;
};
export type Deal = {
  id: string; business: string; owner_name: string | null; phone: string | null; email: string | null;
  city: string | null; industry: string;
  monthly_revenue: number; tib_months: number; fico: number; positions: number; nsf_90d: number;
  amount_requested: number; use_of_funds: string | null; stage: string;
  funded_amount: number | null; commission: number | null; notes: string | null; created_at: string;
};
export type Submission = { id: string; deal_id: string; lender_id: string; status: string; created_at: string };

export const STAGES: [string, string][] = [
  ['new', 'New lead'], ['prequal', 'Pre-qualified'], ['submitted', 'Submitted'],
  ['offers', 'Offers in'], ['contracts', 'Contracts out'], ['funded', 'Funded'], ['declined', 'Declined'],
];
export const INDUSTRIES = ['Automotive','Construction','Dental','Fitness','Food & Beverage','Healthcare','Logistics',
  'Professional Services','Retail','Services','Trucking','Cannabis','Adult','Other'];
export const money = (n: number | null | undefined) => '$' + (n ?? 0).toLocaleString('en-US');

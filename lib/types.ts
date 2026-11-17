export type Lender = {
  id: string; name: string; paper: string | null;
  min_revenue: number; min_tib_months: number; min_fico: number; min_positions: number; max_positions: number | null;
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
export type DealDocument = {
  id: string; deal_id: string; kind: string; file_name: string; storage_path: string;
  size_bytes: number; uploaded_by: string | null; created_at: string;
};
export const DOC_KINDS: [string, string][] = [
  ['bank_statement', 'Bank statement'], ['application', 'Application'], ['id', "Driver's license / ID"],
  ['voided_check', 'Voided check'], ['tax_return', 'Tax return'], ['contract', 'Contract'], ['other', 'Other'],
];
export const DOCS_BUCKET = 'deal-docs';

export const STAGES: [string, string][] = [
  ['new', 'New lead'], ['prequal', 'Pre-qualified'], ['submitted', 'Submitted'],
  ['offers', 'Offers in'], ['contracts', 'Contracts out'], ['funded', 'Funded'], ['declined', 'Declined'],
];
export const INDUSTRIES = ['Adult','Auto Repair','Auto Sales','Bail Bonds','Cannabis / CBD','Cash Business','Collections','Construction','Consulting',
  'Crypto','Debt Relief / Credit Repair','Dental','E-Commerce','Firearms','Fitness','Gambling','Gas Station','Healthcare','Hospitality',
  'Investment / Brokerage','Law Firm','Logistics','Manufacturing','Money Services / Check Cashing','Non-Profit','Professional Services',
  'Real Estate','Restaurant','Retail','Services','Solar','Staffing','Travel Agency','Trucking','Vape Shop','Wholesale','Other'];
export const money = (n: number | null | undefined) => '$' + (n ?? 0).toLocaleString('en-US');

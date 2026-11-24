-- Offers received from lenders on a deal. Safe to run more than once.
create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  lender_id uuid references lenders(id) on delete set null,
  lender_name text not null,
  amount numeric(12,2) not null check (amount > 0),
  buy_rate numeric(5,3),
  sell_rate numeric(5,3),
  term_freq text check (term_freq in ('daily','weekly')),  -- how the merchant pays
  term_count integer check (term_count > 0),               -- number of daily or weekly payments
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists offers_deal_idx on offers (deal_id);
alter table offers enable row level security;
drop policy if exists offers_all on offers;
create policy offers_all on offers for all to authenticated using (is_team()) with check (is_team());

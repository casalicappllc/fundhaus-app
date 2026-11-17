-- Current positions (existing MCAs and loans) on each deal, with their payments. Safe to run more than once.

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  funder text not null,
  kind text not null default 'mca' check (kind in ('mca','loan','loc','other')),
  payment numeric(12,2) not null default 0,       -- amount of each debit
  frequency text not null default 'daily' check (frequency in ('daily','weekly','biweekly','monthly')),
  funded_amount numeric(12,2),
  funded_on date,
  status text not null default 'active' check (status in ('active','paid_off')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists positions_deal_id on positions(deal_id);

alter table positions enable row level security;
drop policy if exists positions_all on positions;
create policy positions_all on positions for all to authenticated using (is_team()) with check (is_team());

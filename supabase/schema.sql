-- FundHaus app: database setup (stage 1: broker console)
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

-- Who is allowed in. Only emails listed here can see or change anything.
create table if not exists team (
  email text primary key,
  added_at timestamptz not null default now()
);

create table if not exists lenders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  paper text not null default 'B',
  min_revenue integer not null default 0,        -- monthly, dollars
  min_tib_months integer not null default 0,
  min_fico integer not null default 0,
  max_positions integer not null default 0,
  min_amount integer not null default 0,
  max_amount integer not null default 0,
  factor_low numeric(4,2),
  factor_high numeric(4,2),
  commission_pct numeric(4,1),
  speed text,
  excluded_industries text[] not null default '{}',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  business text not null,
  owner_name text,
  phone text,
  email text,
  city text,
  industry text not null default 'Other',
  monthly_revenue integer not null default 0,
  tib_months integer not null default 0,
  fico integer not null default 0,
  positions integer not null default 0,
  nsf_90d integer not null default 0,
  amount_requested integer not null default 0,
  use_of_funds text,
  stage text not null default 'new'
    check (stage in ('new','prequal','submitted','offers','contracts','funded','declined')),
  funded_amount integer,
  commission integer,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  lender_id uuid not null references lenders(id) on delete cascade,
  status text not null default 'sent' check (status in ('sent','offer','declined')),
  created_at timestamptz not null default now(),
  unique (deal_id, lender_id)
);

-- Security: every table is locked, then opened only to signed-in team members.
alter table team enable row level security;
alter table lenders enable row level security;
alter table deals enable row level security;
alter table submissions enable row level security;

create or replace function is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

drop policy if exists team_read on team;
create policy team_read on team for select to authenticated using (is_team());

drop policy if exists lenders_all on lenders;
create policy lenders_all on lenders for all to authenticated using (is_team()) with check (is_team());

drop policy if exists deals_all on deals;
create policy deals_all on deals for all to authenticated using (is_team()) with check (is_team());

drop policy if exists submissions_all on submissions;
create policy submissions_all on submissions for all to authenticated using (is_team()) with check (is_team());

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
  paper text,                                    -- optional: A, B, C ...
  min_revenue integer not null default 0,        -- monthly, dollars
  min_tib_months integer not null default 0,
  min_fico integer not null default 0,
  min_positions integer not null default 0,      -- open positions the merchant must already have
  max_positions integer,                         -- open positions allowed; empty = no cap
  min_amount integer not null default 0,
  max_amount integer not null default 0,
  factor_low numeric(5,3),
  factor_high numeric(5,3),
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

-- Document upload (bank statements, applications, IDs ...). Safe to run more than once.
-- Files live in a PRIVATE storage bucket. Only signed-in team members can upload, list, open or delete them.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('bank_statement','application','id','voided_check','tax_return','contract','other')),
  file_name text not null,
  storage_path text not null unique,             -- <deal id>/<random>-<file name> inside the deal-docs bucket
  size_bytes bigint not null default 0,
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index if not exists documents_deal_id on documents(deal_id);

alter table documents enable row level security;
drop policy if exists documents_all on documents;
create policy documents_all on documents for all to authenticated using (is_team()) with check (is_team());

-- Private bucket: 25 MB per file, PDFs, photos and spreadsheets only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-docs', 'deal-docs', false, 26214400, array[
  'application/pdf','image/jpeg','image/png','image/heic','image/heif','image/webp',
  'text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists deal_docs_team_read on storage.objects;
create policy deal_docs_team_read on storage.objects for select to authenticated
  using (bucket_id = 'deal-docs' and public.is_team());
drop policy if exists deal_docs_team_insert on storage.objects;
create policy deal_docs_team_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'deal-docs' and public.is_team());
drop policy if exists deal_docs_team_delete on storage.objects;
create policy deal_docs_team_delete on storage.objects for delete to authenticated
  using (bucket_id = 'deal-docs' and public.is_team());

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

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
    check (stage in ('new','prequal','submitted','offers','contracts','signed','funded','declined')),
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

-- Deals that fill themselves from the application + bank statements. Safe to run more than once.
-- The reading itself happens in the app (app/api/deals/[id]/generate); this only adds places to keep the result.

alter table deals add column if not exists auto_status text
  check (auto_status in ('running','done','failed'));       -- empty = never read yet
alter table deals add column if not exists auto_started_at timestamptz;
alter table deals add column if not exists auto_generated_at timestamptz;
alter table deals add column if not exists auto_error text;
alter table deals add column if not exists auto_summary jsonb; -- month-by-month statement figures, flags, what changed

-- Positions the reader found as recurring debits on the statements (shown with a "From statements" tag).
alter table positions add column if not exists detected boolean not null default false;

-- DataMerch check on every deal (is the merchant on the funder-reported default/fraud database?). Safe to run more than once.

alter table deals add column if not exists ein text;              -- business federal tax ID, 9 digits, from the application
alter table deals add column if not exists datamerch_status text
  check (datamerch_status in ('clear','hit','error','no_ein')); -- empty = not checked yet
alter table deals add column if not exists datamerch_checked_at timestamptz;
alter table deals add column if not exists datamerch_result jsonb; -- matches with their notes, or the error

-- Emailing deals to lenders (application + bank statements attached). Safe to run more than once.

-- Where each lender takes submissions. First address is To, the rest are CC.
alter table lenders add column if not exists submit_emails text[] not null default '{}';

-- One-time fill from the emails already written in each lender's notes (e.g. "Submit: underwriting@x.com, cc amc@x.com").
update lenders l set submit_emails = sub.emails
from (
  select id, array_agg(lower(m.hit[1]) order by m.n) as emails   -- keeps the order written in the notes
  from lenders, regexp_matches(coalesce(notes, ''), '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') with ordinality as m(hit, n)
  group by id
) sub
where l.id = sub.id and l.submit_emails = '{}';

-- What was actually emailed, to whom, and when.
alter table submissions add column if not exists sent_at timestamptz;
alter table submissions add column if not exists sent_to text[];
alter table submissions add column if not exists sent_by text;
alter table submissions add column if not exists files_sent integer;

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

-- Bank statements are renamed by month and account ("November 2026 xxxx1234") when they're read.
-- The name each file was uploaded with is kept here. Safe to run more than once.
alter table documents add column if not exists original_name text;

-- The payment a lender quoted on an offer (daily or weekly, per term_freq). Safe to run more than once.
alter table offers add column if not exists payment numeric(12,2) check (payment > 0);

-- More document types: A/R, Profit & Loss, Balance sheet, EIN letter. Safe to run more than once.
alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('bank_statement','application','id','voided_check','tax_return','contract','other',
                  'ar','profit_loss','balance_sheet','ein_letter'));

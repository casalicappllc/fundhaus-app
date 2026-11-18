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

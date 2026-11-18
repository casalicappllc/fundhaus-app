-- DataMerch check on every deal (is the merchant on the funder-reported default/fraud database?). Safe to run more than once.

alter table deals add column if not exists ein text;              -- business federal tax ID, 9 digits, from the application
alter table deals add column if not exists datamerch_status text
  check (datamerch_status in ('clear','hit','error','no_ein')); -- empty = not checked yet
alter table deals add column if not exists datamerch_checked_at timestamptz;
alter table deals add column if not exists datamerch_result jsonb; -- matches with their notes, or the error

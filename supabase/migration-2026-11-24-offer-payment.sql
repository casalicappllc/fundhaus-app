-- The payment a lender quoted on an offer (daily or weekly, per term_freq). Safe to run more than once.
alter table offers add column if not exists payment numeric(12,2) check (payment > 0);

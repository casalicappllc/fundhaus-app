-- Bank statements are renamed by month and account ("November 2026 xxxx1234") when they're read.
-- The name each file was uploaded with is kept here. Safe to run more than once.
alter table documents add column if not exists original_name text;

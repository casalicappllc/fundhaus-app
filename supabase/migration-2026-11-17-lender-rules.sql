-- Run once on a database created before 2026-11-17.
-- Adds "no first position" lenders, optional position cap, optional paper grade, 3-decimal factor rates.
alter table lenders add column if not exists min_positions integer not null default 0;
alter table lenders alter column max_positions drop not null;
alter table lenders alter column max_positions drop default;
alter table lenders alter column paper drop not null;
alter table lenders alter column paper drop default;
alter table lenders alter column factor_low type numeric(5,3);
alter table lenders alter column factor_high type numeric(5,3);

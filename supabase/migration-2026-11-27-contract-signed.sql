-- Adds a "Contract signed" stage between Contracts out and Funded.
alter table public.deals drop constraint deals_stage_check;
alter table public.deals add constraint deals_stage_check
  check (stage in ('new','prequal','submitted','offers','contracts','signed','funded','declined'));

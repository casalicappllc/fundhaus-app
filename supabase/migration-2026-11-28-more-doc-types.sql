-- More document types: A/R, Profit & Loss, Balance sheet, EIN letter. Safe to run more than once.
alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('bank_statement','application','id','voided_check','tax_return','contract','other',
                  'ar','profit_loss','balance_sheet','ein_letter'));

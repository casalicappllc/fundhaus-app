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

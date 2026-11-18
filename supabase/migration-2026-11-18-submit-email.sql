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

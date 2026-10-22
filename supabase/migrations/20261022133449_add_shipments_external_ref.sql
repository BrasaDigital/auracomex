alter table public.shipments
  add column if not exists external_ref text;

create unique index if not exists shipments_company_external_ref_uidx
  on public.shipments (company_id, external_ref)
  where external_ref is not null;

-- Chave de idempotência do conector MCP para cotações criadas sem processo.
alter table public.quotes add column if not exists external_ref text;
create unique index if not exists quotes_company_external_ref_uidx on public.quotes (company_id, external_ref) where external_ref is not null;

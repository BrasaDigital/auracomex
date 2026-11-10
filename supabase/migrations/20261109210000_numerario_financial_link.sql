-- Numerário aprovado gera movimentações financeiras automáticas:
--  * uma Despesa por Processo (accounts_payable) por item da Prestação de Contas;
--  * uma Receita por Processo (accounts_receivable) com o valor total do Numerário,
--    que ao ser marcada como recebida compõe o saldo da aba Financeiro do processo.
alter type public.accounts_payable_source add value if not exists 'numerario';
alter type public.accounts_receivable_source add value if not exists 'numerario';

alter table public.accounts_payable
  add column if not exists accountability_item_id uuid references public.accountability_items(id) on delete set null;
alter table public.accounts_receivable
  add column if not exists accountability_id uuid references public.accountability(id) on delete set null;

create index if not exists idx_ap_accountability_item on public.accounts_payable(accountability_item_id) where accountability_item_id is not null;
create index if not exists idx_ar_accountability on public.accounts_receivable(accountability_id) where accountability_id is not null;

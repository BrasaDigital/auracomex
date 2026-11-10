-- Conferir taxa de VENDA (aba Taxas, processos sem estimativa de custo): a taxa conferida
-- vira uma receita a receber (accounts_receivable.quote_charge_id) em Receita por Processo,
-- e a ND é gerada de lá. sell_confirmed_amount guarda o total da linha na moeda da taxa.
ALTER TABLE public.quote_charges
  ADD COLUMN IF NOT EXISTS sell_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sell_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS sell_confirmed_amount numeric;

ALTER TABLE public.accounts_receivable
  ADD COLUMN IF NOT EXISTS quote_charge_id uuid REFERENCES public.quote_charges(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_accounts_receivable_quote_charge_id
  ON public.accounts_receivable(quote_charge_id) WHERE quote_charge_id IS NOT NULL;

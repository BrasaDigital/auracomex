-- Peso e cubagem totais digitados direto no Resumo da Carga (quando não há lista de volumes detalhada)
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS cargo_weight_total_kg numeric,
  ADD COLUMN IF NOT EXISTS cargo_cbm_total numeric;

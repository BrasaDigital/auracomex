-- Valor mínimo por taxa (compra/venda) para unidades de peso/medida
ALTER TABLE public.quote_charges
  ADD COLUMN IF NOT EXISTS buy_min_amount numeric,
  ADD COLUMN IF NOT EXISTS sell_min_amount numeric;

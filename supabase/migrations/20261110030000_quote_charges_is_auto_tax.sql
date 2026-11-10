-- Taxas geradas automaticamente pela Estimativa (II, IPI, PIS, COFINS, ICMS, Siscomex, AFRMM).
-- Só lado da compra (sell_amount = 0); ficam fora do Lucro Estimado e do espelhamento Taxas → Estimativa.
ALTER TABLE public.quote_charges ADD COLUMN IF NOT EXISTS is_auto_tax boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_charges_auto_tax_unique
  ON public.quote_charges (quote_id, description) WHERE is_auto_tax;

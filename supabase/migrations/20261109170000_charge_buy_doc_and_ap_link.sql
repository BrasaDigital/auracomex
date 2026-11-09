-- Conferência de taxa de compra com documento + validade; vínculo da despesa por processo com a taxa.
ALTER TABLE public.quote_charges ADD COLUMN IF NOT EXISTS buy_doc_path text, ADD COLUMN IF NOT EXISTS buy_doc_valid_until date;
ALTER TABLE public.accounts_payable ADD COLUMN IF NOT EXISTS quote_charge_id uuid REFERENCES public.quote_charges(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_accounts_payable_quote_charge_id ON public.accounts_payable(quote_charge_id);

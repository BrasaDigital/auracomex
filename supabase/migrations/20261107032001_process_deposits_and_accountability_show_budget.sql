-- Caixa do processo: depósitos do cliente (vários por processo/cotação).
CREATE TABLE public.process_deposits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  deposit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_brl NUMERIC(14,2) NOT NULL CHECK (amount_brl > 0),
  note TEXT,
  comprovante_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  comprovante_url TEXT,
  comprovante_name TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.process_deposits TO authenticated;
GRANT ALL ON public.process_deposits TO service_role;

ALTER TABLE public.process_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_all" ON public.process_deposits
  FOR ALL USING (company_id = (SELECT my_company_id())) WITH CHECK (company_id = (SELECT my_company_id()));

CREATE TRIGGER update_process_deposits_updated_at
  BEFORE UPDATE ON public.process_deposits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_process_deposits_company ON public.process_deposits(company_id);
CREATE INDEX idx_process_deposits_quote ON public.process_deposits(quote_id);
CREATE INDEX idx_process_deposits_comprovante_document ON public.process_deposits(comprovante_document_id);

-- Por empresa: mostrar ao cliente, na prestação de contas (PDF), o valor orçado
-- (previsto no pedido do Numerário). Padrão true = comportamento atual.
ALTER TABLE public.companies
  ADD COLUMN accountability_show_budget BOOLEAN NOT NULL DEFAULT true;

-- Cobrança das assinaturas do Aura por boleto/Pix pela conta C6 da Kenaro (API "Boleto com Liquidação via Barra ou Pix").
-- Toda escrita vem da função serverless api/c6.ts (service role); usuários só leem. Nada aqui guarda credencial do C6.

CREATE TABLE IF NOT EXISTS public.company_boletos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  -- Identificador da cobrança definido por nós (26 caracteres A-Z0-9): a API do C6 não aceita reuso, então também
  -- serve de trava contra emissão em duplicidade.
  external_reference_id text NOT NULL UNIQUE CHECK (external_reference_id ~ '^[A-Z0-9]{26}$'),
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 100),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 5000000),
  due_date date NOT NULL,
  -- Foto de quem paga no momento da emissão: name, tax_id, email, address{address, neighborhood, city, state, zip_code}.
  payer jsonb NOT NULL,
  instructions text[] NOT NULL DEFAULT '{}',
  notify_email boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issuing', 'created', 'waiting_confirmation', 'paid', 'canceled', 'failed')),
  c6_id text,
  digitable_line text,
  bar_code text,
  our_number text,
  pix_qr_code text,
  paid_at timestamptz,
  paid_amount numeric(12,2),
  payment_type text,
  issued_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_boletos_company_idx ON public.company_boletos (company_id, due_date DESC);
CREATE INDEX IF NOT EXISTS company_boletos_status_idx ON public.company_boletos (status);

ALTER TABLE public.company_boletos ENABLE ROW LEVEL SECURITY;

-- Sem policy de INSERT/UPDATE/DELETE de propósito: só a função serverless (service role) grava.
CREATE POLICY "company_boletos_select_own_company" ON public.company_boletos
  FOR SELECT TO authenticated USING (company_id = public.my_company_id());
CREATE POLICY "company_boletos_select_superadmin" ON public.company_boletos
  FOR SELECT TO authenticated USING (public.is_superadmin());

-- Registro durável de TODA notificação recebida do C6 (as notificações não têm assinatura: servem só de gatilho,
-- o estado real é sempre reconsultado na API).
CREATE TABLE IF NOT EXISTS public.c6_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  service text,
  status text,
  external_id text,
  matched boolean NOT NULL DEFAULT false,
  boleto_id uuid REFERENCES public.company_boletos(id) ON DELETE SET NULL,
  raw_body jsonb
);

ALTER TABLE public.c6_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c6_webhook_events_select_superadmin" ON public.c6_webhook_events
  FOR SELECT TO authenticated USING (public.is_superadmin());

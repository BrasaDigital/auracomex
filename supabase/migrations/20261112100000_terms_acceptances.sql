-- Registro do aceite dos Termos de Uso / Política de Privacidade no cadastro público.
-- Guarda data/hora, versão dos termos, IP e navegador como prova do aceite (a confirmar com o advogado).
--
-- company_id e user_id NÃO têm chave estrangeira de propósito: a prova do aceite deve sobreviver
-- à eliminação dos dados da empresa cancelada (ver 20261112110000_data_retention_purge.sql).

CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  user_id       uuid,
  email         text,
  terms_version text NOT NULL,            -- versão dos Termos de Uso aceita (definida pelo servidor)
  privacy_version text NOT NULL,          -- versão da Política de Privacidade aceita (definida pelo servidor)
  client_reported_version text,           -- versão que o navegador diz ter exibido (só conferência)
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  ip            text,
  user_agent    text,
  source        text NOT NULL DEFAULT 'public_signup'
);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_company ON public.terms_acceptances (company_id);

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Só a Edge Function (service_role) grava; só superadmin lê. Nenhum acesso para usuários comuns.
GRANT ALL ON public.terms_acceptances TO service_role;
REVOKE ALL ON public.terms_acceptances FROM anon, authenticated;
GRANT SELECT ON public.terms_acceptances TO authenticated;

DROP POLICY IF EXISTS "terms_acceptances_superadmin_read" ON public.terms_acceptances;
CREATE POLICY "terms_acceptances_superadmin_read" ON public.terms_acceptances
  FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Órgãos arrecadadores (Receita Federal, SEFAZ por UF) e tributos de importação
-- como cadastros GLOBAIS (company_id NULL), visíveis para todas as empresas do Aura
-- e somente leitura para elas (a policy tenant_all só cobre company_id = my_company_id()).

ALTER TABLE public.clients ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.charge_catalog ALTER COLUMN company_id DROP NOT NULL;

-- Fornecedor padrão da taxa (usado pela inserção automática a partir da Estimativa).
ALTER TABLE public.charge_catalog
  ADD COLUMN IF NOT EXISTS default_partner_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS clients_global_read ON public.clients;
CREATE POLICY clients_global_read ON public.clients
  FOR SELECT TO authenticated USING (company_id IS NULL);

DROP POLICY IF EXISTS charge_catalog_global_read ON public.charge_catalog;
CREATE POLICY charge_catalog_global_read ON public.charge_catalog
  FOR SELECT TO authenticated USING (company_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_global_name
  ON public.clients (lower(name)) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_catalog_global_name
  ON public.charge_catalog (name) WHERE company_id IS NULL;

-- Receita Federal (II, IPI, PIS, COFINS, Taxa Siscomex, AFRMM)
INSERT INTO public.clients (company_id, name, type, partner_category, tax_id, tax_id_type, is_foreign)
SELECT NULL, 'RECEITA FEDERAL DO BRASIL', 'supplier', 'orgao_publico', '00394460005887', 'CNPJ', false
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE company_id IS NULL AND lower(name) = 'receita federal do brasil');

-- SEFAZ por UF (ICMS) — sem CNPJ: o ICMS é recolhido por GNRE/DARE da UF, não por CNPJ.
INSERT INTO public.clients (company_id, name, type, partner_category, is_foreign)
SELECT NULL, 'SEFAZ-' || u.uf || ' - SECRETARIA DA FAZENDA ' || u.nome, 'supplier', 'orgao_publico', false
FROM (VALUES
  ('AC','DO ACRE'),('AL','DE ALAGOAS'),('AP','DO AMAPÁ'),('AM','DO AMAZONAS'),('BA','DA BAHIA'),
  ('CE','DO CEARÁ'),('DF','DO DISTRITO FEDERAL'),('ES','DO ESPÍRITO SANTO'),('GO','DE GOIÁS'),
  ('MA','DO MARANHÃO'),('MT','DE MATO GROSSO'),('MS','DE MATO GROSSO DO SUL'),('MG','DE MINAS GERAIS'),
  ('PA','DO PARÁ'),('PB','DA PARAÍBA'),('PR','DO PARANÁ'),('PE','DE PERNAMBUCO'),('PI','DO PIAUÍ'),
  ('RJ','DO RIO DE JANEIRO'),('RN','DO RIO GRANDE DO NORTE'),('RS','DO RIO GRANDE DO SUL'),
  ('RO','DE RONDÔNIA'),('RR','DE RORAIMA'),('SC','DE SANTA CATARINA'),('SP','DE SÃO PAULO'),
  ('SE','DE SERGIPE'),('TO','DO TOCANTINS')
) AS u(uf, nome)
WHERE NOT EXISTS (
  SELECT 1 FROM public.clients c
  WHERE c.company_id IS NULL AND lower(c.name) = lower('SEFAZ-' || u.uf || ' - SECRETARIA DA FAZENDA ' || u.nome)
);

-- Catálogo global de tributos. charge_type 'freight' segue o padrão das demais linhas do catálogo.
INSERT INTO public.charge_catalog (company_id, name, charge_type, legs, default_partner_id)
SELECT NULL, t.name, 'freight', ARRAY['destination'],
       CASE WHEN t.name = 'ICMS' THEN NULL
            ELSE (SELECT id FROM public.clients WHERE company_id IS NULL AND lower(name) = 'receita federal do brasil') END
FROM (VALUES ('II'),('IPI'),('PIS'),('COFINS'),('ICMS'),('TAXA SISCOMEX'),('AFRMM')) AS t(name)
WHERE NOT EXISTS (SELECT 1 FROM public.charge_catalog WHERE company_id IS NULL AND name = t.name);

-- Empresas (clients): inativação sem apagar, trilha de auditoria e mesclagem de duplicadas.
-- Usado pelas ferramentas editar_empresa / inativar_empresa / mesclar_empresas do conector MCP.

-- 1) Inativação (nunca apagar: documents, quote_partners e shipment_partners têm ON DELETE CASCADE para clients).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS inactivated_by uuid;

CREATE INDEX IF NOT EXISTS idx_clients_company_active ON public.clients (company_id, is_active);

-- 2) Auditoria de alterações de empresa: quem, quando, valor anterior.
--    Sem FK para clients de propósito (o histórico sobrevive a qualquer limpeza futura).
CREATE TABLE IF NOT EXISTS public.client_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL CHECK (action IN ('edit', 'inactivate', 'merge', 'merged_into')),
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_audit_log_client ON public.client_audit_log (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_audit_log_company ON public.client_audit_log (company_id, created_at DESC);

ALTER TABLE public.client_audit_log ENABLE ROW LEVEL SECURITY;

-- Só leitura e inserção: o log não pode ser alterado nem apagado pelo usuário.
DROP POLICY IF EXISTS client_audit_log_select ON public.client_audit_log;
CREATE POLICY client_audit_log_select ON public.client_audit_log
  FOR SELECT TO authenticated
  USING (company_id = public.my_company_id());

-- Só quem pode editar/mesclar empresas grava, só como si mesmo e só sobre empresa da própria conta.
DROP POLICY IF EXISTS client_audit_log_insert ON public.client_audit_log;
CREATE POLICY client_audit_log_insert ON public.client_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.my_company_id()
    AND user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.company_id = client_audit_log.company_id)
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
                AND ur.role::text IN ('admin', 'diretor', 'gerente', 'superadmin', 'assistente_virtual'))
  );

-- TRUNCATE não passa pelo RLS: tira dos perfis de API.
REVOKE ALL ON public.client_audit_log FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.client_audit_log FROM authenticated;

-- 3) Mesclagem: move TUDO da duplicada para a mantida e inativa a duplicada (não apaga).
--    p_apply = false -> só valida e devolve a prévia (contagens); true -> grava, tudo numa transação.
--    SECURITY INVOKER: o RLS do usuário continua valendo.
CREATE OR REPLACE FUNCTION public.merge_clients(p_keep uuid, p_drop uuid, p_apply boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_keep public.clients%ROWTYPE;
  v_drop public.clients%ROWTYPE;
  v_fin text;
  v_t text;
  v_c text;
  v_n int;
  v_ids jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_moved jsonb := '{}'::jsonb;
  v_filled jsonb := '{}'::jsonb;
  v_removed jsonb := '{}'::jsonb;
  v_qp_conf int;
  v_sp_conf int;
  v_fill_tax boolean := false;
  v_keep_before jsonb;
  v_drop_before jsonb;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role::text IN ('admin', 'diretor', 'gerente', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Somente admin, diretor, gerente ou superadmin podem mesclar empresas.' USING ERRCODE = '42501';
  END IF;

  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN
    RAISE EXCEPTION 'Informe duas empresas diferentes (a que fica e a duplicada).';
  END IF;

  -- Trava as duas linhas sempre na mesma ordem (por id) para dois merges cruzados não darem deadlock.
  PERFORM 1 FROM public.clients WHERE id IN (p_keep, p_drop) ORDER BY id FOR UPDATE;
  SELECT * INTO v_keep FROM public.clients WHERE id = p_keep;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa a manter não encontrada.'; END IF;
  SELECT * INTO v_drop FROM public.clients WHERE id = p_drop;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa duplicada não encontrada.'; END IF;

  IF v_keep.company_id IS DISTINCT FROM v_drop.company_id OR v_keep.company_id IS NULL THEN
    RAISE EXCEPTION 'As duas empresas precisam ser da mesma conta.';
  END IF;
  IF NOT v_keep.is_active THEN RAISE EXCEPTION 'A empresa a manter está inativa.'; END IF;
  IF NOT v_drop.is_active THEN RAISE EXCEPTION 'A empresa duplicada já está inativa.'; END IF;
  IF v_keep.type <> v_drop.type THEN
    RAISE EXCEPTION 'Tipos diferentes (% e %): não são a mesma empresa.', v_keep.type, v_drop.type;
  END IF;
  IF v_keep.partner_category IS NOT NULL AND v_drop.partner_category IS NOT NULL
     AND v_keep.partner_category <> v_drop.partner_category THEN
    RAISE EXCEPTION 'Categorias de fornecedor diferentes (% e %): não são a mesma empresa.', v_keep.partner_category, v_drop.partner_category;
  END IF;
  IF COALESCE(v_keep.tax_id, '') <> '' AND COALESCE(v_drop.tax_id, '') <> '' AND v_keep.tax_id <> v_drop.tax_id THEN
    RAISE EXCEPTION 'Documentos diferentes (% e %): não são a mesma empresa.', v_keep.tax_id, v_drop.tax_id;
  END IF;

  -- Processo finalizado fica travado: não contorno a trava, peço para reabrir antes.
  SELECT string_agg(reference_number, ', ') INTO v_fin FROM (
    SELECT reference_number FROM public.shipments
    WHERE is_finalized AND (client_id = p_drop OR shipper_id = p_drop OR consignee_id = p_drop OR notify_id = p_drop)
    ORDER BY reference_number LIMIT 10
  ) f;
  IF v_fin IS NOT NULL THEN
    RAISE EXCEPTION 'A duplicada aparece em processo(s) finalizado(s) (%): reabra-os no AuraComex antes de mesclar.', v_fin;
  END IF;

  -- Vínculos que já existem na mantida (UNIQUE processo+empresa): o da duplicada é redundante.
  SELECT count(*) INTO v_qp_conf FROM public.quote_partners d
    WHERE d.client_id = p_drop AND EXISTS (SELECT 1 FROM public.quote_partners k WHERE k.quote_id = d.quote_id AND k.client_id = p_keep);
  SELECT count(*) INTO v_sp_conf FROM public.shipment_partners d
    WHERE d.client_id = p_drop AND EXISTS (SELECT 1 FROM public.shipment_partners k WHERE k.shipment_id = d.shipment_id AND k.client_id = p_keep);

  -- Campos vazios da mantida que a duplicada preenche.
  IF COALESCE(v_keep.email, '') = '' AND COALESCE(v_drop.email, '') <> '' THEN v_filled := v_filled || jsonb_build_object('email', v_drop.email); END IF;
  IF COALESCE(v_keep.phone, '') = '' AND COALESCE(v_drop.phone, '') <> '' THEN v_filled := v_filled || jsonb_build_object('telefone', v_drop.phone); END IF;
  IF COALESCE(v_keep.contact_person, '') = '' AND COALESCE(v_drop.contact_person, '') <> '' THEN v_filled := v_filled || jsonb_build_object('contato', v_drop.contact_person); END IF;
  IF COALESCE(v_keep.address, '') = '' AND COALESCE(v_drop.address, '') <> '' THEN v_filled := v_filled || jsonb_build_object('endereco', v_drop.address); END IF;
  IF v_keep.salesperson_id IS NULL AND v_drop.salesperson_id IS NOT NULL THEN v_filled := v_filled || jsonb_build_object('vendedor', v_drop.salesperson_id); END IF;
  IF COALESCE(v_keep.tax_id, '') = '' AND COALESCE(v_drop.tax_id, '') <> '' THEN
    v_fill_tax := true;
    v_filled := v_filled || jsonb_build_object('documento', v_drop.tax_id);
  END IF;

  -- Contagem do que será movido (tabela.coluna -> quantidade).
  FOR v_t, v_c IN SELECT * FROM (VALUES
    ('quotes', 'client_id'), ('shipments', 'client_id'), ('shipments', 'shipper_id'), ('shipments', 'consignee_id'),
    ('shipments', 'notify_id'), ('quote_partners', 'client_id'), ('shipment_partners', 'client_id'),
    ('documents', 'client_id'), ('debit_notes', 'client_id'), ('debit_notes', 'partner_id'),
    ('quote_charges', 'partner_id'), ('charge_lines', 'partner_id'), ('accounts_payable', 'partner_id'),
    ('accounts_receivable', 'client_id'), ('charge_catalog', 'default_partner_id'),
    ('overhead_expenses', 'supplier_id'), ('coleta_carretas', 'client_id'), ('coleta_cavalos', 'client_id'),
    ('coleta_motoristas', 'client_id')
  ) AS x(t, c) LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', v_t, v_c) INTO v_n USING p_drop;
    IF v_t = 'quote_partners' THEN v_n := v_n - v_qp_conf; END IF;
    IF v_t = 'shipment_partners' THEN v_n := v_n - v_sp_conf; END IF;
    IF v_n > 0 THEN v_counts := v_counts || jsonb_build_object(v_t || '.' || v_c, v_n); END IF;
  END LOOP;

  IF NOT p_apply THEN
    RETURN jsonb_build_object(
      'aplicado', false,
      'mantida', jsonb_build_object('id', v_keep.id, 'nome', v_keep.name, 'documento', v_keep.tax_id),
      'duplicada', jsonb_build_object('id', v_drop.id, 'nome', v_drop.name, 'documento', v_drop.tax_id),
      'a_mover', v_counts,
      'vinculos_repetidos_descartados', jsonb_build_object('quote_partners', v_qp_conf, 'shipment_partners', v_sp_conf),
      'campos_que_a_mantida_recebe', v_filled
    );
  END IF;

  -- ---------- gravação ----------
  v_keep_before := to_jsonb(v_keep);
  v_drop_before := to_jsonb(v_drop);

  -- Vínculos redundantes: guarda a linha inteira no log antes de descartar.
  WITH del AS (
    DELETE FROM public.quote_partners d
    WHERE d.client_id = p_drop AND EXISTS (SELECT 1 FROM public.quote_partners k WHERE k.quote_id = d.quote_id AND k.client_id = p_keep)
    RETURNING to_jsonb(d.*) AS r
  ) SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_ids FROM del;
  v_removed := v_removed || jsonb_build_object('quote_partners', v_ids);
  WITH del AS (
    DELETE FROM public.shipment_partners d
    WHERE d.client_id = p_drop AND EXISTS (SELECT 1 FROM public.shipment_partners k WHERE k.shipment_id = d.shipment_id AND k.client_id = p_keep)
    RETURNING to_jsonb(d.*) AS r
  ) SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_ids FROM del;
  v_removed := v_removed || jsonb_build_object('shipment_partners', v_ids);

  FOR v_t, v_c IN SELECT * FROM (VALUES
    ('quotes', 'client_id'), ('shipments', 'client_id'), ('shipments', 'shipper_id'), ('shipments', 'consignee_id'),
    ('shipments', 'notify_id'), ('quote_partners', 'client_id'), ('shipment_partners', 'client_id'),
    ('documents', 'client_id'), ('debit_notes', 'client_id'), ('debit_notes', 'partner_id'),
    ('quote_charges', 'partner_id'), ('charge_lines', 'partner_id'), ('accounts_payable', 'partner_id'),
    ('accounts_receivable', 'client_id'), ('charge_catalog', 'default_partner_id'),
    ('overhead_expenses', 'supplier_id'), ('coleta_carretas', 'client_id'), ('coleta_cavalos', 'client_id'),
    ('coleta_motoristas', 'client_id')
  ) AS x(t, c) LOOP
    EXECUTE format(
      'WITH m AS (UPDATE public.%I SET %I = $1 WHERE %I = $2 RETURNING id) SELECT COALESCE(jsonb_agg(id), ''[]''::jsonb) FROM m',
      v_t, v_c, v_c) INTO v_ids USING p_keep, p_drop;
    IF jsonb_array_length(v_ids) > 0 THEN
      v_moved := v_moved || jsonb_build_object(v_t || '.' || v_c, v_ids);
    END IF;
  END LOOP;

  -- O documento só pode existir em uma empresa (índice único): sai da duplicada antes de entrar na mantida.
  IF v_fill_tax THEN
    UPDATE public.clients SET tax_id = NULL, updated_at = now() WHERE id = p_drop;
  END IF;

  UPDATE public.clients SET
    email = COALESCE(NULLIF(email, ''), NULLIF(v_drop.email, '')),
    phone = COALESCE(NULLIF(phone, ''), NULLIF(v_drop.phone, '')),
    contact_person = COALESCE(NULLIF(contact_person, ''), NULLIF(v_drop.contact_person, '')),
    address = COALESCE(NULLIF(address, ''), NULLIF(v_drop.address, '')),
    salesperson_id = COALESCE(salesperson_id, v_drop.salesperson_id),
    tax_id = CASE WHEN v_fill_tax THEN v_drop.tax_id ELSE tax_id END,
    tax_id_type = CASE WHEN v_fill_tax THEN v_drop.tax_id_type ELSE tax_id_type END,
    is_foreign = CASE WHEN v_fill_tax THEN v_drop.is_foreign ELSE is_foreign END,
    updated_at = now()
  WHERE id = p_keep;

  UPDATE public.clients SET is_active = false, inactivated_at = now(), inactivated_by = v_uid, updated_at = now()
  WHERE id = p_drop;

  INSERT INTO public.client_audit_log (company_id, client_id, user_id, action, old_values, new_values) VALUES
    (v_keep.company_id, p_keep, v_uid, 'merge', v_keep_before,
      jsonb_build_object('mesclada_com', p_drop, 'nome_da_duplicada', v_drop.name, 'movidos', v_moved,
                         'vinculos_descartados', v_removed, 'campos_preenchidos', v_filled)),
    (v_keep.company_id, p_drop, v_uid, 'merged_into', v_drop_before,
      jsonb_build_object('mantida', p_keep, 'nome_da_mantida', v_keep.name, 'inativada', true));

  RETURN jsonb_build_object(
    'aplicado', true,
    'mantida', jsonb_build_object('id', v_keep.id, 'nome', v_keep.name),
    'duplicada_inativada', jsonb_build_object('id', v_drop.id, 'nome', v_drop.name),
    'movidos', v_counts,
    'vinculos_repetidos_descartados', jsonb_build_object('quote_partners', v_qp_conf, 'shipment_partners', v_sp_conf),
    'campos_preenchidos', v_filled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_clients(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_clients(uuid, uuid, boolean) TO authenticated;

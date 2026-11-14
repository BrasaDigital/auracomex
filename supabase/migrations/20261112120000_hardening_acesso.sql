-- Endurecimento de acesso (achados da verificação de segurança de 12/11/2026).
-- NÃO aplicada em produção: aplicar só com o "sim" do Marcos, de preferência primeiro numa cópia/branch.
-- Detalhes e roteiro de teste: D:\Projetos\kenaro\KENARO\docs\auracomex-seguranca-retencao.md
--
-- Corrige:
--  1) user_roles: qualquer usuário logado podia gravar o PRÓPRIO papel (inclusive 'superadmin');
--  2) profiles: qualquer usuário logado podia trocar o PRÓPRIO company_id (e assim "entrar" em outra empresa);
--  3) storage 'shipment-documents': policy de leitura sem filtro de empresa (e aberta ao papel anon);
--  4) funções SECURITY DEFINER executáveis por anon (e rotinas internas executáveis por qualquer logado).

-- ---------------------------------------------------------------------------------------------
-- 1) user_roles: leitura como hoje (superadmin ou a própria linha); escrita SÓ superadmin.
--    As Edge Functions (create-user, invite-user, manage-user, public-signup) usam service_role e
--    ignoram RLS, então não são afetadas.
--    ATENÇÃO: UserRolesSection.tsx (Configurações > Usuários) faz upsert direto em user_roles para trocar o
--    papel de OUTRO usuário. Com a regra atual (user_id = auth.uid()) isso já não funcionava para
--    não-superadmin; depois desta migração continua sem funcionar. A troca de papel por admin de empresa
--    deve passar a usar a Edge Function manage-user (ação a criar) — ver relatório.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_all" ON public.user_roles;

CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((SELECT public.is_superadmin()) OR user_id = (SELECT auth.uid()));

CREATE POLICY "user_roles_insert_superadmin" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_superadmin()));

CREATE POLICY "user_roles_update_superadmin" ON public.user_roles
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_superadmin()))
  WITH CHECK ((SELECT public.is_superadmin()));

CREATE POLICY "user_roles_delete_superadmin" ON public.user_roles
  FOR DELETE TO authenticated
  USING ((SELECT public.is_superadmin()));

-- ---------------------------------------------------------------------------------------------
-- 2) profiles: usuário comum não pode mudar company_id nem user_id. Superadmin (troca de empresa em
--    AuthContext.switchCompany) e chamadas sem JWT de usuário (service_role, triggers de auth) continuam livres.
--    Mantém o resto da edição do próprio perfil (nome, telefone, idioma, onboarding, must_change_password...).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_protect_tenant_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_superadmin() THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Não é permitido alterar a empresa do perfil.' USING ERRCODE = '42501';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Não é permitido alterar o usuário do perfil.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_tenant_columns ON public.profiles;
CREATE TRIGGER trg_profiles_protect_tenant_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_tenant_columns();

-- ---------------------------------------------------------------------------------------------
-- 3) storage: 'shipment-documents' só para a própria empresa (primeira pasta = company_id) ou superadmin.
--    Conferido em 12/11/2026: os 311 arquivos do bucket já estão em pastas de empresas existentes.
--    O acesso por URL assinada (createSignedUrl) passa a exigir a mesma regra no momento de gerar a URL.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "storage_read_private" ON storage.objects;

CREATE POLICY "storage_read_shipment_documents_own_company" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'shipment-documents'
    AND ((SELECT public.is_superadmin()) OR (storage.foldername(name))[1] = (SELECT public.my_company_id())::text)
  );

-- ---------------------------------------------------------------------------------------------
-- 4) Funções SECURITY DEFINER: sem acesso para anon; rotinas internas só para o cron/postgres.
-- ---------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.reset_demo_data() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_overhead_entries_for_month(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_dn_number(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_oc_number(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_shipment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_dn_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_oc_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_shipment(uuid) TO authenticated, service_role;
-- NÃO revogar anon de is_superadmin()/my_company_id(): policies "TO public" (ex.: certificados) as chamam como anon.
-- Pendente (ver relatório): auditar as demais funções SECURITY DEFINER executáveis por anon/authenticated.
-- Os jobs pg_cron (reset-demo-data-hourly, generate-overhead-entries-monthly) rodam como postgres e não dependem disto.

-- Pendente, fora desta migração: next_dn_number/next_oc_number recebem p_company_id de qualquer empresa
-- (só devolvem um número sequencial; baixo risco) e a numeração por count(*)+1 pode repetir em concorrência.

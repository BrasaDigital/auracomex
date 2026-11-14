-- Fecha o INSERT em profiles: só superadmin (ou chave de servidor, que ignora RLS) cria perfil.
-- APLICADA em produção em 14/11/2026 (registrada como "profiles_insert_somente_superadmin").
--
-- Antes: a regra aceitava user_id = auth.uid() com QUALQUER company_id; um usuário logado sem perfil podia criar o seu
-- apontando para a empresa que quisesse (a migration 20261112120000 só travava o UPDATE).
-- Nenhuma tela nem Edge Function cria perfil com o token do usuário (create-user, invite-user e public-signup usam
-- service_role), então nada legítimo é afetado.
--
-- Rollback:
--   DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
--   CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT TO authenticated
--     WITH CHECK (((SELECT public.is_superadmin()) OR (user_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_superadmin()));

-- Impede que o navegador (usuários logados) LEIA as credenciais do Portal Único.
-- APLICADA em produção em 14/11/2026 (registrada como "ocultar_segredos_portalunico"). A parte do Siscomex está em
-- 20261112135000_ocultar_segredos_siscomex.sql e fica PENDENTE até o novo SiscomexConfigWizard ir ao ar.
--
-- Situação antes: certificate_password, client_secret, webhook_secret e webhook_auth_key ficavam em texto puro e a policy
-- de SELECT deixava QUALQUER usuário da empresa lê-las pela API. O front nunca precisa desses valores de volta (só grava,
-- via função portalunico-gateway com service_role); quem os usa são as Edge Functions / api/portalunico com service_role.
--
-- Solução: tirar o SELECT de tabela inteira de anon/authenticated e conceder SELECT só nas colunas não sensíveis.
-- INSERT/UPDATE continuam. Colunas NOVAS criadas no futuro não ficam legíveis pelo navegador até receberem GRANT
-- explícito (comportamento desejado para segredos).
--
-- Rollback: GRANT SELECT ON public.company_portalunico_configs TO anon, authenticated;

REVOKE SELECT ON public.company_portalunico_configs FROM anon, authenticated;
GRANT SELECT (id, company_id, client_id, role_type, is_active, last_tested_at, last_test_success, created_by,
              created_at, updated_at, certificate_path, certificate_pem_path, webhook_subscription_ids,
              webhook_active, webhook_last_event_at)
  ON public.company_portalunico_configs TO authenticated;

-- Fora desta migração (recomendação): criptografar esses segredos em repouso no próprio banco (Supabase Vault
-- ou pgcrypto) e/ou mover os certificados .pfx para fora do bucket de empresa. Exige alterar as Edge Functions.

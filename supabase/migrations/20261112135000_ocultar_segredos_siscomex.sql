-- Impede que o navegador LEIA as credenciais do Siscomex (serpro_consumer_secret, certificate_password).
-- NÃO APLICADA em produção (pendente de propósito). Aplicar SOMENTE DEPOIS de publicar o novo
-- src/components/settings/SiscomexConfigWizard.tsx (que grava com select+update/insert em vez de upsert).
--
-- Por quê: no ensaio local (Postgres 17), depois do REVOKE o upsert antigo do assistente falhava com 42501 (permission denied)
-- quando a empresa já tinha configuração, porque INSERT ... ON CONFLICT DO UPDATE exige leitura das colunas de segredo.
-- Com o front novo (select id + update/insert) o salvamento funciona (testado). A leitura de is_active (aba Estimativa)
-- e o select de colunas liberadas continuam funcionando. As Edge Functions (siscomex-gateway) usam service_role e não são
-- afetadas.
--
-- Rollback: GRANT SELECT ON public.company_siscomex_configs TO anon, authenticated;

REVOKE SELECT ON public.company_siscomex_configs FROM anon, authenticated;
GRANT SELECT (id, company_id, serpro_consumer_key, certificate_path, is_active, created_at, updated_at)
  ON public.company_siscomex_configs TO authenticated;

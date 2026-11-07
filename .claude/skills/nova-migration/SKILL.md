---
name: nova-migration
description: Cria migration Supabase do AuraComex com RLS multi-tenant e valida com get_advisors.
disable-model-invocation: true
---

Argumento: o que a migration deve fazer.

1. Inspecione as tabelas existentes (Supabase MCP `list_tables`) antes de escrever.
2. Aplique com `apply_migration` (nunca `execute_sql` para DDL), nome em snake_case, e salve o mesmo SQL em `supabase/migrations/`.
3. Toda tabela de dado: coluna `company_id`, `ENABLE ROW LEVEL SECURITY` e policies com `my_company_id()` / `is_superadmin()` envolvidos em `(select ...)`. Tabela interna da plataforma: só superadmin.
4. Funções novas: `SET search_path = public, pg_temp`; `REVOKE EXECUTE ... FROM anon` quando não forem públicas.
5. Rode `get_advisors` (security) e reporte só o que a migration introduziu.
6. Se mudou schema usado pelo front, lembre de regenerar `src/integrations/supabase/types.ts`.

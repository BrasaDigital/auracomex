-- Novos processos/cotações nascem SEM o seguro automático marcado (o usuário liga quando precisar).
-- Não altera as cotações existentes.
ALTER TABLE public.quotes ALTER COLUMN seguro_auto SET DEFAULT false;

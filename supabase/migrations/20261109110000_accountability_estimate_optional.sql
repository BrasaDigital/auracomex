-- Exportação não passa pela Estimativa/Numerário: a Prestação de Contas pode
-- ser iniciada direto (sem cost_estimates), com itens lançados manualmente.
ALTER TABLE public.accountability
  ALTER COLUMN estimate_id DROP NOT NULL;

-- Financeiro > Prestação de Contas: coluna "Venda Final" por item (ao lado de Estimado, Compra e Saldo).
-- Nasce igual ao Estimado (valor_orcado_brl) e o usuário ajusta se a compra real exigir. Só informa; não altera
-- Receita/Despesa por Processo.
ALTER TABLE public.accountability_items
  ADD COLUMN IF NOT EXISTS valor_venda_final_brl numeric(14,2);

-- Itens já existentes: venda final = estimado (a tela também usa o estimado quando a coluna está vazia).
UPDATE public.accountability_items
SET valor_venda_final_brl = valor_orcado_brl
WHERE valor_venda_final_brl IS NULL;

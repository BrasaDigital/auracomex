import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EstimateRow, EstimateExpenseRow } from '@/hooks/useCostEstimate';
import { EstimateBreakdown } from '@/lib/costEstimate';

export interface AccountabilityRow {
  id: string;
  company_id: string;
  quote_id: string;
  estimate_id: string;
  status: string; // 'open' | 'closed'
  usd_brl: number | null;
  total_orcado_brl: number | null;
  total_pago_brl: number | null;
  diferenca_brl: number | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type AccountabilityCategoria = 'origin' | 'freight' | 'destination' | 'local' | 'tax' | 'afrmm' | 'siscomex' | 'other';

export interface AccountabilityItemRow {
  id: string;
  accountability_id: string;
  company_id: string;
  ordem: number;
  categoria: AccountabilityCategoria;
  descricao: string;
  valor_orcado_brl: number;
  valor_pago_brl: number | null;
  /** Venda final do item: nasce igual ao Estimado (valor_orcado_brl) e pode ser ajustada. Null = usa o Estimado. */
  valor_venda_final_brl: number | null;
  confirmado: boolean;
  observacao: string | null;
  source_expense_id: string | null;
  comprovante_document_id: string | null;
  comprovante_url: string | null;
  comprovante_name: string | null;
}

export function useAccountability(quoteId: string, companyId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['accountability', quoteId],
    queryFn: async () => {
      const { data: acc } = await (supabase as any)
        .from('accountability')
        .select('*')
        .eq('quote_id', quoteId)
        .maybeSingle();
      if (!acc) return { accountability: null, items: [] as AccountabilityItemRow[] };

      const { data: items } = await (supabase as any)
        .from('accountability_items')
        .select('*')
        .eq('accountability_id', acc.id)
        .order('ordem');

      return {
        accountability: acc as AccountabilityRow,
        items: (items || []) as AccountabilityItemRow[],
      };
    },
    enabled: !!quoteId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['accountability', quoteId] });

  /**
   * Monta as linhas do Numerário (todas as taxas + despesas nacionais orçadas,
   * na mesma lógica exibida em EstimatePdfDialog no modo 'numerario') e cria a
   * Prestação de Contas, travando a Estimativa correspondente.
   */
  const createFromEstimate = async (params: {
    estimate: EstimateRow;
    expenses: EstimateExpenseRow[];
    breakdown: EstimateBreakdown;
    rate: number;
    armazenagemBrl: number;
    userId?: string | null;
  }) => {
    if (!companyId) throw new Error('Empresa não identificada');
    const { estimate, expenses, breakdown, rate, armazenagemBrl, userId } = params;

    const taxaSiscomexBrl = Number((estimate as any).taxa_siscomex_brl || 0);
    const afrmmBrl = Number((estimate as any).afrmm_brl || 0);

    type Line = { categoria: AccountabilityCategoria; descricao: string; valor_orcado_brl: number; source_expense_id?: string | null };
    const lines: Line[] = [];

    // Despesas Prepaid (já pagas na origem, fora do Numerário depositado pelo
    // cliente — mesmo critério usado em CostEstimateTab.tsx/EstimatePdfDialog.tsx
    // pro total do Numerário) não entram na Prestação de Contas.
    expenses.filter(e => e.category === 'origin' && !(e as any).is_prepaid).forEach(e => {
      lines.push({ categoria: 'origin', descricao: e.descricao, valor_orcado_brl: Number(e.valor_brl || 0), source_expense_id: e.id });
    });
    expenses.filter(e => e.category === 'freight' && !(e as any).is_prepaid).forEach(e => {
      lines.push({ categoria: 'freight', descricao: e.descricao, valor_orcado_brl: Number(e.valor_brl || 0), source_expense_id: e.id });
    });

    lines.push({ categoria: 'tax', descricao: 'I.I.', valor_orcado_brl: Number((breakdown.ii_usd * rate).toFixed(2)) });
    lines.push({ categoria: 'tax', descricao: 'I.P.I.', valor_orcado_brl: Number((breakdown.ipi_usd * rate).toFixed(2)) });
    lines.push({ categoria: 'tax', descricao: 'P.I.S.', valor_orcado_brl: Number((breakdown.pis_usd * rate).toFixed(2)) });
    lines.push({ categoria: 'tax', descricao: 'COFINS', valor_orcado_brl: Number((breakdown.cofins_usd * rate).toFixed(2)) });
    lines.push({ categoria: 'tax', descricao: 'I.C.M.S.', valor_orcado_brl: Number((breakdown.icms_usd * rate).toFixed(2)) });
    if (taxaSiscomexBrl > 0) lines.push({ categoria: 'siscomex', descricao: 'Taxa Siscomex', valor_orcado_brl: taxaSiscomexBrl });
    if (afrmmBrl > 0) lines.push({ categoria: 'afrmm', descricao: 'AFRMM', valor_orcado_brl: afrmmBrl });
    if (armazenagemBrl > 0) lines.push({ categoria: 'destination', descricao: 'Armazenagem no destino', valor_orcado_brl: armazenagemBrl });

    expenses.filter(e => (e.category === 'destination' || e.category === 'local' || !e.category) && !(e as any).is_prepaid).forEach(e => {
      lines.push({ categoria: (e.category as AccountabilityCategoria) || 'other', descricao: e.descricao, valor_orcado_brl: Number(e.valor_brl || 0), source_expense_id: e.id });
    });

    const totalOrcado = lines.reduce((s, l) => s + l.valor_orcado_brl, 0);

    const { data: acc, error } = await (supabase as any)
      .from('accountability')
      .insert({
        company_id: companyId,
        quote_id: quoteId,
        estimate_id: estimate.id,
        usd_brl: rate,
        total_orcado_brl: totalOrcado,
        total_pago_brl: 0,
        diferenca_brl: -totalOrcado,
        created_by: userId || null,
      })
      .select()
      .single();
    if (error) throw error;

    if (lines.length > 0) {
      const payload = lines.map((l, idx) => ({
        accountability_id: acc.id,
        company_id: companyId,
        ordem: idx,
        categoria: l.categoria,
        descricao: l.descricao,
        valor_orcado_brl: l.valor_orcado_brl,
        valor_venda_final_brl: l.valor_orcado_brl,
        source_expense_id: l.source_expense_id || null,
      }));
      let { data: insertedItems, error: itemsErr } = await (supabase as any).from('accountability_items').insert(payload).select('id, ordem');
      // Se uma despesa referenciada em source_expense_id foi editada/excluída entre o
      // cálculo em tela e este insert (FK stale), tenta de novo sem o vínculo de
      // rastreabilidade em vez de deixar o cabeçalho órfão sem nenhum item.
      if (itemsErr && itemsErr.code === '23503') {
        const payloadNoRef = payload.map(p => ({ ...p, source_expense_id: null }));
        const retry = await (supabase as any).from('accountability_items').insert(payloadNoRef).select('id, ordem');
        itemsErr = retry.error;
        insertedItems = retry.data;
      }
      if (itemsErr) {
        // Não deixa o cabeçalho órfão (sem nenhum item) — desfaz e propaga o erro.
        await (supabase as any).from('accountability').delete().eq('id', acc.id);
        throw itemsErr;
      }

      // Numerário aprovado → movimentações financeiras automáticas (Despesa por
      // Processo por item + Receita por Processo com o total). Falha aqui não
      // desfaz a Prestação de Contas; o erro sobe pra equipe saber que faltou.
      try {
        await generateFinancialEntries(acc as AccountabilityRow, lines, (insertedItems || []) as { id: string; ordem: number }[], userId);
      } catch (e: any) {
        invalidate();
        throw new Error(`Prestação de Contas criada, mas as movimentações financeiras não foram geradas: ${e.message || e}`);
      }
    }

    invalidate();
    return acc as AccountabilityRow;
  };

  /**
   * Despesa por Processo (accounts_payable, source 'numerario') para cada item e
   * UMA Receita por Processo (accounts_receivable, source 'numerario') com o total
   * do Numerário. Quando a receita é marcada como recebida, ela entra no saldo da
   * aba Financeiro do processo (ver FinanceiroTab).
   */
  const generateFinancialEntries = async (
    acc: AccountabilityRow,
    lines: { descricao: string; valor_orcado_brl: number; source_expense_id?: string | null }[],
    inserted: { id: string; ordem: number }[],
    userId?: string | null,
  ) => {
    const { data: q, error: qErr } = await (supabase as any)
      .from('quotes').select('quote_number, base_reference, client_id, shipment_id').eq('id', quoteId).maybeSingle();
    if (qErr) throw qErr;
    const today = new Date().toISOString().slice(0, 10);
    const idByOrdem = new Map(inserted.map(i => [i.ordem, i.id]));

    // Taxa que já tem despesa criada pela aba Taxas (quote_charge_id) não gera outra aqui.
    const expenseIds = lines.map(l => l.source_expense_id).filter(Boolean) as string[];
    const skipExpenseIds = new Set<string>();
    if (expenseIds.length > 0) {
      const { data: exps } = await (supabase as any)
        .from('cost_estimate_expenses').select('id, source_charge_id').in('id', expenseIds);
      const chargeByExpense = new Map<string, string>((exps || []).filter((e: any) => e.source_charge_id).map((e: any) => [e.id, e.source_charge_id]));
      const chargeIds = Array.from(new Set(chargeByExpense.values()));
      if (chargeIds.length > 0) {
        const { data: existing } = await (supabase as any)
          .from('accounts_payable').select('quote_charge_id').eq('quote_id', quoteId).in('quote_charge_id', chargeIds).neq('status', 'cancelado');
        const done = new Set((existing || []).map((r: any) => r.quote_charge_id));
        chargeByExpense.forEach((chargeId, expId) => { if (done.has(chargeId)) skipExpenseIds.add(expId); });
      }
      // A despesa pode ter sido agregada de várias taxas de mesmo nome (ex.: duas
      // linhas FRETE INTERNACIONAL, uma só de venda) e apontar pra uma que não é a
      // que virou conta a pagar. Então também compara pela descrição da taxa já lançada.
      const { data: launched } = await (supabase as any)
        .from('accounts_payable').select('quote_charge_id').eq('quote_id', quoteId).not('quote_charge_id', 'is', null).neq('status', 'cancelado');
      const launchedIds = Array.from(new Set((launched || []).map((r: any) => r.quote_charge_id)));
      if (launchedIds.length > 0) {
        const { data: lch } = await (supabase as any).from('quote_charges').select('description').in('id', launchedIds);
        const launchedNames = new Set((lch || []).map((c: any) => String(c.description || '').trim().toUpperCase()));
        lines.forEach(l => {
          if (l.source_expense_id && launchedNames.has(String(l.descricao || '').trim().toUpperCase())) skipExpenseIds.add(l.source_expense_id);
        });
      }
    }

    // Fornecedor (partner_id) de cada linha: impostos automáticos vêm da taxa
    // is_auto_tax da cotação (Receita Federal, SEFAZ-UF...); despesas vindas de
    // uma taxa herdam o partner dela.
    const TAX_DESC_TO_CHARGE: Record<string, string> = {
      'I.I.': 'II', 'I.P.I.': 'IPI', 'P.I.S.': 'PIS', 'COFINS': 'COFINS',
      'I.C.M.S.': 'ICMS', 'Taxa Siscomex': 'TAXA SISCOMEX', 'AFRMM': 'AFRMM',
    };
    const partnerByChargeName = new Map<string, string>();
    const partnerByExpense = new Map<string, string>();
    {
      const { data: autoCharges } = await (supabase as any)
        .from('quote_charges').select('description, partner_id').eq('quote_id', quoteId).eq('is_auto_tax', true);
      (autoCharges || []).forEach((c: any) => { if (c.partner_id) partnerByChargeName.set(c.description, c.partner_id); });
      if (expenseIds.length > 0) {
        const { data: exps2 } = await (supabase as any)
          .from('cost_estimate_expenses').select('id, source_charge_id').in('id', expenseIds);
        const cIds = Array.from(new Set((exps2 || []).map((e: any) => e.source_charge_id).filter(Boolean)));
        if (cIds.length > 0) {
          const { data: chs } = await (supabase as any).from('quote_charges').select('id, partner_id, buy_amount').in('id', cIds);
          const pByCharge = new Map<string, string>((chs || []).filter((c: any) => c.partner_id).map((c: any) => [c.id, c.partner_id]));
          // Taxa só de venda (compra = 0): é serviço cobrado do cliente, não há
          // o que pagar a fornecedor — não vira conta a pagar.
          const zeroBuy = new Set<string>((chs || []).filter((c: any) => !(Number(c.buy_amount) > 0)).map((c: any) => c.id));
          (exps2 || []).forEach((e: any) => { if (e.source_charge_id && zeroBuy.has(e.source_charge_id)) skipExpenseIds.add(e.id); });
          (exps2 || []).forEach((e: any) => { const pid = e.source_charge_id && pByCharge.get(e.source_charge_id); if (pid) partnerByExpense.set(e.id, pid); });
        }
      }
    }

    const payables = lines
      .map((l, idx) => ({ l, idx }))
      .filter(({ l }) => l.valor_orcado_brl > 0 && !(l.source_expense_id && skipExpenseIds.has(l.source_expense_id)))
      .map(({ l, idx }) => ({
        company_id: companyId,
        source: 'numerario',
        quote_id: quoteId,
        shipment_id: q?.shipment_id || null,
        partner_id: (l.source_expense_id && partnerByExpense.get(l.source_expense_id)) || partnerByChargeName.get(TAX_DESC_TO_CHARGE[l.descricao] || '') || null,
        description: l.descricao,
        currency: 'BRL',
        amount: l.valor_orcado_brl,
        due_date: today,
        accountability_item_id: idByOrdem.get(idx) || null,
        created_by: userId || null,
      }));
    if (payables.length > 0) {
      const { error } = await (supabase as any).from('accounts_payable').insert(payables);
      if (error) throw error;
    }

    const total = lines.reduce((s, l) => s + l.valor_orcado_brl, 0);
    if (total > 0) {
      const { error } = await (supabase as any).from('accounts_receivable').insert({
        company_id: companyId,
        source: 'numerario',
        quote_id: quoteId,
        shipment_id: q?.shipment_id || null,
        client_id: q?.client_id || null,
        description: 'Venda de Numerário',
        currency: 'BRL',
        amount: total,
        due_date: today,
        accountability_id: acc.id,
        created_by: userId || null,
      });
      if (error) throw error;
    }
    qc.invalidateQueries({ queryKey: ['accounts_payable'] });
    qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
  };

  /**
   * Exportação: não há Estimativa/Numerário. Cria a Prestação de Contas vazia
   * (estimate_id nulo) e os itens são lançados manualmente em addItem.
   */
  const createManual = async (userId?: string | null) => {
    if (!companyId) throw new Error('Empresa não identificada');
    const { data: acc, error } = await (supabase as any)
      .from('accountability')
      .insert({
        company_id: companyId,
        quote_id: quoteId,
        estimate_id: null,
        total_orcado_brl: 0,
        total_pago_brl: 0,
        diferenca_brl: 0,
        created_by: userId || null,
      })
      .select()
      .single();
    if (error) throw error;
    invalidate();
    return acc as AccountabilityRow;
  };

  const addItem = async (accountabilityId: string, item: { categoria: AccountabilityCategoria; descricao: string; valor_orcado_brl: number; ordem: number }) => {
    if (!companyId) throw new Error('Empresa não identificada');
    const { error } = await (supabase as any).from('accountability_items').insert({
      accountability_id: accountabilityId,
      company_id: companyId,
      ordem: item.ordem,
      categoria: item.categoria,
      descricao: item.descricao,
      valor_orcado_brl: item.valor_orcado_brl,
      valor_venda_final_brl: item.valor_orcado_brl,
    });
    if (error) throw error;
    invalidate();
  };

  const removeItem = async (itemId: string) => {
    const { error } = await (supabase as any).from('accountability_items').delete().eq('id', itemId);
    if (error) throw error;
    invalidate();
  };

  const updateItem = async (itemId: string, patch: { valor_pago_brl?: number | null; valor_venda_final_brl?: number | null; confirmado?: boolean; observacao?: string | null }) => {
    const { data: row, error } = await (supabase as any)
      .from('accountability_items').update(patch).eq('id', itemId)
      .select('accountability_id, valor_orcado_brl, valor_pago_brl').single();
    if (error) throw error;
    // Venda Final = valor a receber: a Receita por Processo do Numerário (ainda em aberto) acompanha a soma da Venda Final
    // dos itens. Receita já recebida não muda (a diferença vira "adicional a cobrar/a devolver" na Prestação de Contas).
    if ('valor_venda_final_brl' in patch && row?.accountability_id) {
      const { data: todos, error: e3 } = await (supabase as any)
        .from('accountability_items').select('valor_orcado_brl, valor_venda_final_brl').eq('accountability_id', row.accountability_id);
      if (e3) throw e3;
      const total = (todos || []).reduce((s: number, i: any) => s + Number(i.valor_venda_final_brl ?? i.valor_orcado_brl ?? 0), 0);
      if (total > 0) {
        const { error: e4 } = await (supabase as any)
          .from('accounts_receivable').update({ amount: Number(total.toFixed(2)) })
          .eq('accountability_id', row.accountability_id).eq('source', 'numerario').eq('status', 'aberto');
        if (e4) throw e4;
        qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      }
    }
    // Valor real digitado na conferência substitui o estimado lançado em Custos por Processo
    // (Movimentações). Só contas geradas pelo Numerário (vínculo accountability_item_id);
    // itens manuais não têm conta. Pago apagado (null) volta ao orçado. Vale também p/ contas já pagas.
    if ('valor_pago_brl' in patch) {
      const novo = Number(row?.valor_pago_brl ?? row?.valor_orcado_brl ?? 0);
      const { error: e2 } = await (supabase as any)
        .from('accounts_payable').update({ amount: novo })
        .eq('accountability_item_id', itemId).eq('source', 'numerario').neq('status', 'cancelado');
      if (e2) throw e2;
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
    }
    invalidate();
  };

  /**
   * Marca/desmarca "Confirmado" SEM sobrescrever um valor pago já digitado:
   * só preenche valor_pago_brl com o orçado se ele ainda estiver NULL no banco
   * (condição avaliada no servidor, não pelo estado em tela, que pode estar defasado).
   */
  const setConfirmado = async (item: AccountabilityItemRow, confirmado: boolean) => {
    const { error } = await (supabase as any).from('accountability_items').update({ confirmado }).eq('id', item.id);
    if (error) throw error;
    if (confirmado) {
      const { error: e2 } = await (supabase as any)
        .from('accountability_items')
        .update({ valor_pago_brl: item.valor_orcado_brl })
        .eq('id', item.id)
        .is('valor_pago_brl', null);
      if (e2) throw e2;
    }
    invalidate();
  };

  /**
   * Sobe o comprovante de pagamento de um item pro Storage, registra em
   * `documents` (pra aparecer também na aba Documentos do processo) e
   * vincula o item da prestação a esse documento.
   */
  const attachComprovante = async (item: AccountabilityItemRow, file: File, quote: { id: string; company_id: string; shipment_id?: string | null }) => {
    if (!companyId) throw new Error('Empresa não identificada');
    const path = `${quote.company_id}/${quote.id}/comprovantes/${Date.now()}_${file.name}`;
    const up = await supabase.storage.from('shipment-documents').upload(path, file, { contentType: file.type || undefined });
    if (up.error) throw up.error;

    const { data: doc, error: docErr } = await (supabase as any)
      .from('documents')
      .insert({
        quote_id: quote.id,
        shipment_id: quote.shipment_id || null,
        company_id: quote.company_id,
        name: file.name,
        file_url: path,
        file_size: file.size,
        document_type: 'other',
        custom_category: `Comprovante Numerário — ${item.descricao}`,
      })
      .select()
      .single();
    if (docErr) throw docErr;

    const { error } = await (supabase as any)
      .from('accountability_items')
      .update({ comprovante_document_id: doc.id, comprovante_url: path, comprovante_name: file.name })
      .eq('id', item.id);
    if (error) throw error;
    invalidate();
  };

  /** Remove só o vínculo do comprovante no item (mantém o documento na aba Documentos). */
  const removeComprovante = async (itemId: string) => {
    const { error } = await (supabase as any)
      .from('accountability_items')
      .update({ comprovante_document_id: null, comprovante_url: null, comprovante_name: null })
      .eq('id', itemId);
    if (error) throw error;
    invalidate();
  };

  /** Recalcula total_pago_brl / diferenca_brl no cabeçalho a partir dos itens (chamar após updateItem). */
  const recomputeTotals = async (accountabilityId: string) => {
    const { data: items } = await (supabase as any)
      .from('accountability_items')
      .select('valor_orcado_brl,valor_pago_brl')
      .eq('accountability_id', accountabilityId);
    const list = (items || []) as { valor_orcado_brl: number; valor_pago_brl: number | null }[];
    const totalOrcado = list.reduce((s, i) => s + Number(i.valor_orcado_brl || 0), 0);
    const totalPago = list.reduce((s, i) => s + Number(i.valor_pago_brl ?? i.valor_orcado_brl ?? 0), 0);
    const { error } = await (supabase as any)
      .from('accountability')
      .update({ total_orcado_brl: totalOrcado, total_pago_brl: totalPago, diferenca_brl: totalPago - totalOrcado })
      .eq('id', accountabilityId);
    if (error) throw error;
    invalidate();
  };

  const closeAccountability = async (accountabilityId: string) => {
    const { error } = await (supabase as any).from('accountability').update({ status: 'closed' }).eq('id', accountabilityId);
    if (error) throw error;
    invalidate();
  };

  /** Exclui a prestação de contas — destrava a Estimativa correspondente. */
  const removeAccountability = async (accountabilityId: string) => {
    // Remove só as movimentações geradas ainda em aberto; as já pagas/recebidas ficam (FK vira null).
    const { data: itemRows } = await (supabase as any).from('accountability_items').select('id').eq('accountability_id', accountabilityId);
    const itemIds = (itemRows || []).map((i: any) => i.id);
    if (itemIds.length > 0) {
      await (supabase as any).from('accounts_payable').delete().in('accountability_item_id', itemIds).eq('status', 'aberto');
    }
    await (supabase as any).from('accounts_receivable').delete().eq('accountability_id', accountabilityId).eq('status', 'aberto');
    await (supabase as any).from('accountability_items').delete().eq('accountability_id', accountabilityId);
    const { error } = await (supabase as any).from('accountability').delete().eq('id', accountabilityId);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['accounts_payable'] });
    qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
    invalidate();
  };

  return { ...query, createFromEstimate, createManual, addItem, removeItem, updateItem, setConfirmado, attachComprovante, removeComprovante, recomputeTotals, closeAccountability, removeAccountability, invalidate };
}

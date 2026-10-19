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
        source_expense_id: l.source_expense_id || null,
      }));
      let { error: itemsErr } = await (supabase as any).from('accountability_items').insert(payload);
      // Se uma despesa referenciada em source_expense_id foi editada/excluída entre o
      // cálculo em tela e este insert (FK stale), tenta de novo sem o vínculo de
      // rastreabilidade em vez de deixar o cabeçalho órfão sem nenhum item.
      if (itemsErr && itemsErr.code === '23503') {
        const payloadNoRef = payload.map(p => ({ ...p, source_expense_id: null }));
        const retry = await (supabase as any).from('accountability_items').insert(payloadNoRef);
        itemsErr = retry.error;
      }
      if (itemsErr) {
        // Não deixa o cabeçalho órfão (sem nenhum item) — desfaz e propaga o erro.
        await (supabase as any).from('accountability').delete().eq('id', acc.id);
        throw itemsErr;
      }
    }

    invalidate();
    return acc as AccountabilityRow;
  };

  const updateItem = async (itemId: string, patch: { valor_pago_brl?: number | null; confirmado?: boolean; observacao?: string | null }) => {
    const { error } = await (supabase as any).from('accountability_items').update(patch).eq('id', itemId);
    if (error) throw error;
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
    await (supabase as any).from('accountability_items').delete().eq('accountability_id', accountabilityId);
    const { error } = await (supabase as any).from('accountability').delete().eq('id', accountabilityId);
    if (error) throw error;
    invalidate();
  };

  return { ...query, createFromEstimate, updateItem, setConfirmado, attachComprovante, removeComprovante, recomputeTotals, closeAccountability, removeAccountability, invalidate };
}

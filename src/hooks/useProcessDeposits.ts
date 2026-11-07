import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// "Caixa do processo": depósitos feitos pelo cliente (vários por processo).
// O saldo (depositado − pago confirmado) é calculado em FinanceiroTab.

export interface ProcessDepositRow {
  id: string;
  company_id: string;
  quote_id: string;
  deposit_date: string; // yyyy-MM-dd
  amount_brl: number;
  note: string | null;
  comprovante_document_id: string | null;
  comprovante_url: string | null;
  comprovante_name: string | null;
  created_at: string;
}

export function useProcessDeposits(quoteId: string, companyId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['process-deposits', quoteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('process_deposits')
        .select('*')
        .eq('quote_id', quoteId)
        .order('deposit_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as ProcessDepositRow[];
    },
    enabled: !!quoteId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['process-deposits', quoteId] });

  const addDeposit = async (params: { deposit_date: string; amount_brl: number; note?: string | null; userId?: string | null }) => {
    if (!companyId) throw new Error('Empresa não identificada');
    const { error } = await (supabase as any).from('process_deposits').insert({
      company_id: companyId,
      quote_id: quoteId,
      deposit_date: params.deposit_date,
      amount_brl: params.amount_brl,
      note: params.note?.trim() || null,
      created_by: params.userId || null,
    });
    if (error) throw error;
    invalidate();
  };

  const removeDeposit = async (id: string) => {
    const { error } = await (supabase as any).from('process_deposits').delete().eq('id', id);
    if (error) throw error;
    invalidate();
  };

  /**
   * Sobe o comprovante do depósito pro Storage, registra em `documents` (aparece
   * também na aba Documentos do processo) e vincula ao depósito — mesmo padrão
   * do comprovante de pagamento da Prestação de Contas.
   */
  const attachComprovante = async (deposit: ProcessDepositRow, file: File, quote: { id: string; company_id: string; shipment_id?: string | null }) => {
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
        custom_category: 'Comprovante de Depósito do Cliente',
      })
      .select()
      .single();
    if (docErr) throw docErr;

    const { error } = await (supabase as any)
      .from('process_deposits')
      .update({ comprovante_document_id: doc.id, comprovante_url: path, comprovante_name: file.name })
      .eq('id', deposit.id);
    if (error) throw error;
    invalidate();
  };

  /** Remove só o vínculo do comprovante (mantém o documento na aba Documentos). */
  const removeComprovante = async (id: string) => {
    const { error } = await (supabase as any)
      .from('process_deposits')
      .update({ comprovante_document_id: null, comprovante_url: null, comprovante_name: null })
      .eq('id', id);
    if (error) throw error;
    invalidate();
  };

  return { ...query, addDeposit, removeDeposit, attachComprovante, removeComprovante, invalidate };
}

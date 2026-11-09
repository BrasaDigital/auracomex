import { supabase } from '@/integrations/supabase/client';
import { logAuditEvent } from './auditLog';

/**
 * Exclui uma DN de fornecedor (e a conta a pagar vinculada) e libera de volta
 * pra edição todas as taxas que estavam presas nela — usado tanto pelo botão
 * "Excluir" da lista de DNs no Financeiro quanto pelo fluxo de "Reabrir" uma
 * taxa já enviada, na aba Taxas do processo (mesma lógica, dois pontos de
 * entrada). Pode excluir mesmo já paga — nesse caso o registro do pagamento
 * (conta a pagar) também é removido, então o chamador deve avisar o usuário
 * antes de chamar isto com uma DN paga.
 */
export async function deleteSupplierDn({
  dnId,
  companyId,
  quoteId,
  userId,
  partnerName,
}: {
  dnId: string;
  companyId: string;
  quoteId?: string | null;
  userId?: string | null;
  /** Nome do fornecedor, se já disponível no chamador — evita um select extra. */
  partnerName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: dn, error: dnErr } = await supabase
    .from('debit_notes' as any)
    .select('id, dn_number, status, quote_id')
    .eq('id', dnId)
    .maybeSingle();
  if (dnErr) return { ok: false, error: dnErr.message };
  if (!dn) return { ok: false, error: 'Debit Note não encontrada.' };

  await supabase.from('accounts_payable' as any).delete().eq('debit_note_id', dnId);
  const { error: delErr } = await supabase.from('debit_notes' as any).delete().eq('id', dnId);
  if (delErr) return { ok: false, error: delErr.message };

  // Libera as taxas que estavam presas nesta DN: tiram o vínculo e voltam a
  // pedir conferência (o valor "cobrado" já digitado fica, só a confirmação
  // que é desfeita — evita reenviar sem revisar de novo). Também limpa
  // buy_paid_at, pra caso a DN já estivesse paga a taxa não fique travada
  // por um pagamento cujo registro acabou de ser excluído.
  await supabase
    .from('quote_charges' as any)
    .update({ sent_in_debit_note_id: null, buy_actual_confirmed_at: null, buy_actual_confirmed_by: null, buy_paid_at: null })
    .eq('sent_in_debit_note_id', dnId);

  const effectiveQuoteId = quoteId || (dn as any).quote_id || null;
  await logAuditEvent({
    quoteId: effectiveQuoteId,
    companyId,
    userId,
    field_name: 'debit_note',
    old_value: `${partnerName ? partnerName + ' — ' : ''}DN ${(dn as any).dn_number}`,
    new_value: null,
  });

  return { ok: true };
}

/**
 * Equivalente a `deleteSupplierDn`, só que pro lado Venda: exclui uma ND
 * (Nota de Débito) já emitida ao cliente, junto com a conta a receber
 * vinculada, e libera de volta pra edição as taxas de venda que estavam
 * presas nela. Único jeito de reabrir uma taxa de venda já enviada numa ND
 * — o valor cobrado do cliente não tem uma etapa de "conferência" separada
 * como o lado compra, então gerar a ND já trava o valor direto.
 */
export async function deleteClientDn({
  dnId,
  companyId,
  quoteId,
  userId,
  clientName,
}: {
  dnId: string;
  companyId: string;
  quoteId?: string | null;
  userId?: string | null;
  /** Nome do cliente/empresa, se já disponível no chamador — evita um select extra. */
  clientName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: dn, error: dnErr } = await supabase
    .from('debit_notes' as any)
    .select('id, dn_number, status, quote_id')
    .eq('id', dnId)
    .maybeSingle();
  if (dnErr) return { ok: false, error: dnErr.message };
  if (!dn) return { ok: false, error: 'Debit Note não encontrada.' };
  if ((dn as any).status === 'paga') {
    return { ok: false, error: 'Esta ND já foi paga e não pode ser excluída.' };
  }

  await supabase.from('accounts_receivable' as any).delete().eq('debit_note_id', dnId);
  const { error: delErr } = await supabase.from('debit_notes' as any).delete().eq('id', dnId);
  if (delErr) return { ok: false, error: delErr.message };

  // Libera as taxas de venda presas nesta ND — não existe "confirmação"
  // separada do lado venda, então só o vínculo precisa ser limpo.
  await supabase
    .from('quote_charges' as any)
    .update({ sent_in_debit_note_id: null })
    .eq('sent_in_debit_note_id', dnId);

  const effectiveQuoteId = quoteId || (dn as any).quote_id || null;
  await logAuditEvent({
    quoteId: effectiveQuoteId,
    companyId,
    userId,
    field_name: 'debit_note',
    old_value: `${clientName ? clientName + ' — ' : ''}ND ${(dn as any).dn_number}`,
    new_value: null,
  });

  return { ok: true };
}

/**
 * Cancela uma ND ao cliente já emitida: a ND fica no histórico com status
 * "cancelada", a conta a receber vinculada passa a "cancelado" e as taxas de
 * venda presas nela voltam a ficar livres (editáveis e prontas pra entrar numa
 * ND nova). Diferente de `deleteClientDn`, o registro NÃO é apagado.
 * ND já paga não pode ser cancelada (o recebimento precisa ser tratado antes).
 */
export async function cancelClientDn({
  dnId,
  companyId,
  quoteId,
  userId,
  clientName,
}: {
  dnId: string;
  companyId: string;
  quoteId?: string | null;
  userId?: string | null;
  clientName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: dn, error: dnErr } = await supabase
    .from('debit_notes' as any)
    .select('id, dn_number, status, quote_id')
    .eq('id', dnId)
    .maybeSingle();
  if (dnErr) return { ok: false, error: dnErr.message };
  if (!dn) return { ok: false, error: 'Nota de Débito não encontrada.' };
  if ((dn as any).status === 'paga') {
    return { ok: false, error: 'Esta ND já foi paga e não pode ser cancelada.' };
  }
  if ((dn as any).status === 'cancelada') {
    return { ok: false, error: 'Esta ND já está cancelada.' };
  }

  const { error: upErr } = await supabase.from('debit_notes' as any).update({ status: 'cancelada' }).eq('id', dnId);
  if (upErr) return { ok: false, error: upErr.message };

  await supabase.from('accounts_receivable' as any).update({ status: 'cancelado' }).eq('debit_note_id', dnId);
  await supabase.from('quote_charges' as any).update({ sent_in_debit_note_id: null }).eq('sent_in_debit_note_id', dnId);

  await logAuditEvent({
    quoteId: quoteId || (dn as any).quote_id || null,
    companyId,
    userId,
    field_name: 'debit_note',
    old_value: `${clientName ? clientName + ' — ' : ''}ND ${(dn as any).dn_number}`,
    new_value: 'cancelada',
  });

  return { ok: true };
}

/**
 * Texto padrão das observações da ND ao cliente (editável na hora de emitir).
 * Evita que o cliente pague uma ND vencida: pede a atualização antes.
 */
export const DEFAULT_CLIENT_ND_NOTES =
  'Esta Nota de Débito é válida até a data de vencimento. Caso o vencimento seja ultrapassado, não efetue o pagamento: entre em contato conosco para solicitar a atualização do documento.';

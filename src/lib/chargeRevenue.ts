import { supabase } from '@/integrations/supabase/client';

// Receita por processo gerada ao "Conferir" uma taxa de VENDA (aba Taxas, processos sem
// estimativa de custo): uma conta a receber por taxa (accounts_receivable.quote_charge_id),
// ainda sem ND. A ND é gerada depois, em Receita por Processo; quando isso acontece as contas
// avulsas das taxas (ainda não recebidas) são removidas e a conta da ND passa a representar o valor.

export async function registerChargeRevenue(p: {
  chargeId: string;
  description: string;
  amount: number;
  currency: string;
  clientId?: string | null;
  quoteId: string;
  shipmentId?: string | null;
  companyId: string;
  userId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Idempotente: apaga a conta anterior ainda não recebida e insere de novo.
  await supabase.from('accounts_receivable' as any).delete().eq('quote_charge_id', p.chargeId).neq('status', 'recebido');
  const { error } = await supabase.from('accounts_receivable' as any).insert({
    company_id: p.companyId,
    source: 'manual',
    quote_charge_id: p.chargeId,
    quote_id: p.quoteId,
    shipment_id: p.shipmentId ?? null,
    client_id: p.clientId ?? null,
    description: `Taxa: ${p.description}`,
    currency: p.currency,
    amount: p.amount,
    due_date: new Date().toISOString().slice(0, 10),
    status: 'aberto',
    created_by: p.userId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removeChargeRevenue(chargeIds: string[]) {
  if (chargeIds.length === 0) return;
  await supabase.from('accounts_receivable' as any).delete().in('quote_charge_id', chargeIds).neq('status', 'recebido');
}

/** Devolve a receita avulsa das taxas que continuam conferidas (ex.: ND cancelada). */
export async function restoreChargeRevenue(chargeIds: string[], companyId: string, userId?: string | null) {
  if (chargeIds.length === 0) return;
  const { data } = await supabase
    .from('quote_charges' as any)
    .select('id, description, currency, partner_id, quote_id, sell_confirmed_at, sell_confirmed_amount')
    .in('id', chargeIds)
    .not('sell_confirmed_at', 'is', null);
  for (const c of (data ?? []) as any[]) {
    await registerChargeRevenue({
      chargeId: c.id,
      description: c.description || 'Taxa',
      amount: Number(c.sell_confirmed_amount) || 0,
      currency: c.currency || 'USD',
      clientId: c.partner_id,
      quoteId: c.quote_id,
      companyId,
      userId,
    });
  }
}

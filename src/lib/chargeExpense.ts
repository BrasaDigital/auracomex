import { supabase } from '@/integrations/supabase/client';
import { DOCS_BUCKET } from '@/lib/storage';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';

// Despesa por processo gerada ao "Conferir" uma taxa de compra: uma conta a
// pagar por taxa (accounts_payable.quote_charge_id). Quando a taxa entra numa
// DN ("Enviar DN"), a conta da DN passa a representar o valor e as contas
// avulsas das taxas (ainda não pagas) são removidas — evita duplicar.

export async function registerChargeExpense(p: {
  chargeId: string;
  description: string;
  amount: number;
  currency: string;
  partnerId?: string | null;
  quoteId: string;
  shipmentId?: string | null;
  companyId: string;
  userId?: string | null;
  file?: File | null;
  validUntil?: string | null; // yyyy-MM-dd
}): Promise<{ ok: true; docPath: string | null } | { ok: false; error: string }> {
  let docPath: string | null = null;
  if (p.file) {
    docPath = `${p.companyId}/${p.quoteId}/${Date.now()}_${sanitizeStorageFileName(p.file.name)}`;
    const { error: upErr } = await supabase.storage.from(DOCS_BUCKET).upload(docPath, p.file);
    if (upErr) return { ok: false, error: upErr.message };
    const { error: docErr } = await supabase.from('documents').insert({
      quote_id: p.quoteId,
      shipment_id: p.shipmentId ?? null,
      company_id: p.companyId,
      name: p.file.name,
      file_url: docPath,
      file_size: p.file.size,
      uploaded_by: p.userId ?? null,
      document_type: 'other' as any,
      custom_category: 'Taxa conferida',
    } as any);
    if (docErr) return { ok: false, error: docErr.message };
  }

  // Recria a conta da taxa (idempotente): apaga a anterior não paga e insere de novo.
  await supabase.from('accounts_payable' as any).delete().eq('quote_charge_id', p.chargeId).neq('status', 'pago');
  const { error: apErr } = await supabase.from('accounts_payable' as any).insert({
    company_id: p.companyId,
    source: 'manual',
    quote_charge_id: p.chargeId,
    quote_id: p.quoteId,
    shipment_id: p.shipmentId ?? null,
    partner_id: p.partnerId ?? null,
    description: `Taxa: ${p.description}`,
    currency: p.currency,
    amount: p.amount,
    due_date: p.validUntil || new Date().toISOString().slice(0, 10),
    status: 'aberto',
    created_by: p.userId ?? null,
  });
  if (apErr) return { ok: false, error: apErr.message };
  return { ok: true, docPath };
}

export async function removeChargeExpense(chargeIds: string[]) {
  if (chargeIds.length === 0) return;
  await supabase.from('accounts_payable' as any).delete().in('quote_charge_id', chargeIds).neq('status', 'pago');
}

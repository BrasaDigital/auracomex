/**
 * Estimativa → Taxas: cria/atualiza as taxas de tributos de importação (II, IPI, PIS, COFINS,
 * ICMS, Taxa Siscomex, AFRMM) na aba Taxas do processo, ligadas ao catálogo global e ao órgão
 * arrecadador (fornecedor padrão do catálogo; o ICMS fica sem fornecedor até escolher a UF).
 *
 * Só lado da compra (sell_amount = 0): venda é o Numerário/Estimativa. As linhas levam
 * is_auto_tax = true — ficam fora do Lucro Estimado e do espelhamento Taxas → Estimativa.
 */
export interface TaxTarget { name: string; amountBrl: number }

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildTaxTargets(p: {
  ii_usd: number; ipi_usd: number; pis_usd: number; cofins_usd: number; icms_usd: number;
  usd_brl: number; taxa_siscomex_brl: number; afrmm_brl: number;
}): TaxTarget[] {
  const brl = (usd: number) => round2((Number(usd) || 0) * (Number(p.usd_brl) || 0));
  return [
    { name: 'II', amountBrl: brl(p.ii_usd) },
    { name: 'IPI', amountBrl: brl(p.ipi_usd) },
    { name: 'PIS', amountBrl: brl(p.pis_usd) },
    { name: 'COFINS', amountBrl: brl(p.cofins_usd) },
    { name: 'ICMS', amountBrl: brl(p.icms_usd) },
    { name: 'TAXA SISCOMEX', amountBrl: round2(Number(p.taxa_siscomex_brl) || 0) },
    { name: 'AFRMM', amountBrl: round2(Number(p.afrmm_brl) || 0) },
  ];
}

/** Retorna true se gravou algo (insert/update) — quem chama invalida o cache das Taxas. */
export async function syncTaxCharges(quoteId: string, companyId: string, targets: TaxTarget[]): Promise<boolean> {
  // import dinâmico: deixa buildTaxTargets testável no Vitest sem o client do Supabase (precisa de env).
  const { supabase } = await import('@/integrations/supabase/client');
  const sb = supabase as any;
  const [{ data: catalog }, { data: existing }] = await Promise.all([
    sb.from('charge_catalog').select('id, name, default_partner_id').is('company_id', null),
    sb.from('quote_charges')
      .select('id, description, buy_amount, buy_paid_at, sent_in_debit_note_id')
      .eq('quote_id', quoteId).eq('is_auto_tax', true),
  ]);
  const catByName = new Map<string, any>((catalog || []).map((c: any) => [c.name, c]));
  const exByName = new Map<string, any>((existing || []).map((c: any) => [c.description, c]));
  let changed = false;

  for (const t of targets) {
    const ex = exByName.get(t.name);
    if (ex) {
      // Já paga/enviada em ND: congelada. Fora isso, acompanha o valor da Estimativa.
      if (ex.buy_paid_at || ex.sent_in_debit_note_id) continue;
      if (Math.abs((Number(ex.buy_amount) || 0) - t.amountBrl) < 0.005) continue;
      const { error } = await sb.from('quote_charges').update({ buy_amount: t.amountBrl }).eq('id', ex.id);
      if (error) throw error;
      changed = true;
    } else if (t.amountBrl > 0) {
      const cat = catByName.get(t.name);
      const { error } = await sb.from('quote_charges').insert({
        quote_id: quoteId,
        company_id: companyId,
        description: t.name,
        charge_type: 'destination',
        leg: 'destination',
        currency: 'BRL',
        billing_unit: 'fixed',
        buy_amount: t.amountBrl,
        sell_amount: 0,
        charge_catalog_id: cat?.id ?? null,
        partner_id: cat?.default_partner_id ?? null,
        is_auto_tax: true,
      });
      // 23505 = outra execução criou a mesma linha ao mesmo tempo (índice único) — ok.
      if (error && error.code !== '23505') throw error;
      if (!error) changed = true;
    }
  }
  return changed;
}

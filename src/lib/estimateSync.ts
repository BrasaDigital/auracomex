/**
 * Mapeamento Taxas (quote_charges) → Estimativa de Custo.
 * Tudo em USD internamente; despesas locais convertidas para BRL.
 */

export interface ChargeLike {
  id: string;
  description: string | null;
  leg: string | null;
  charge_type: string | null;
  billing_unit: string | null;
  currency: string | null;
  sell_amount: number | null;
  buy_amount: number | null;
  aduaneira?: boolean | null;
  /** 'prepaid' = já pago na origem (não entra no Numerário). 'collect'/null = cobrado do cliente (entra no Numerário). */
  payment_term?: string | null;
  /** Câmbio próprio desta taxa (ex: câmbio que o fornecedor/parceiro desta linha realmente cobrou),
   *  usado SÓ pra converter o valor em BRL exibido na despesa da Estimativa/Numerário. Quando vazio,
   *  cai pra taxa fiscal (fx.usd_brl / fx.eur_brl) — mesmo padrão de usd_brl_agencia. NÃO afeta a base
   *  de cálculo em USD dos impostos (frete_intl_usd, seguro_intl_usd, acrescimos_usd, deducoes_usd),
   *  que precisa ficar sempre na taxa fiscal única, independente de quem cobrou cada taxa. */
  exchange_rate?: number | null;
}

export interface FxRates {
  usd_brl: number;
  eur_brl: number;
}

export interface MappedExpense {
  descricao: string;
  valor_brl: number;
  valor_original: number;
  moeda_original: string;
  aduaneira: boolean;
  source_charge_id: string;
  category: 'origin' | 'freight' | 'destination' | 'local';
  /** true = prepaid (já pago na origem) — aparece na Estimativa/Numerário mas não entra no total a depositar. */
  is_prepaid: boolean;
}

export interface MappedEstimate {
  frete_intl_usd: number;
  seguro_intl_usd: number;
  acrescimos_usd: number;
  deducoes_usd: number;
  expenses: MappedExpense[];
  ignored: Array<{ description: string; currency: string; amount: number }>;
}

const ADUANEIRA_KEYWORDS = ['ARMAZENAGEM', 'DESEMBARAÇO', 'DESEMBARACO', 'CAPATAZIA', 'ISPS', 'THC'];
// "Taxas de Destino" (destination charges do agente) NUNCA é aduaneira — não entra na base do ICMS,
// nem por palavra-chave, mesmo que a descrição contenha termos como THC.
const NAO_ADUANEIRA_KEYWORDS = ['TAXAS DE DESTINO', 'TAXA DE DESTINO'];
const FRETE_KEYWORDS = ['FRETE', 'FREIGHT', 'OCEAN FREIGHT', 'AIR FREIGHT'];
const SEGURO_KEYWORDS = ['SEGURO', 'INSURANCE'];

function hasKeyword(text: string, list: string[]): boolean {
  const up = (text || '').toUpperCase();
  return list.some(k => up.includes(k));
}

/** Retorna true se houver pelo menos uma taxa de seguro entre as charges (independente de valor). */
export function chargesHaveInsurance(charges: ChargeLike[] | null | undefined): boolean {
  if (!charges || charges.length === 0) return false;
  return charges.some(c => hasKeyword(c.description || '', SEGURO_KEYWORDS));
}

/** Converte qualquer moeda para USD usando o câmbio fornecido. Retorna null se não suportada. */
function toUSD(amount: number, currency: string, fx: FxRates): number | null {
  const cur = (currency || 'USD').toUpperCase();
  if (cur === 'USD') return amount;
  if (cur === 'BRL') return fx.usd_brl > 0 ? amount / fx.usd_brl : null;
  if (cur === 'EUR') return fx.usd_brl > 0 && fx.eur_brl > 0 ? (amount * fx.eur_brl) / fx.usd_brl : null;
  return null;
}

function toBRL(amount: number, currency: string, fx: FxRates): number | null {
  const cur = (currency || 'USD').toUpperCase();
  if (cur === 'BRL') return amount;
  if (cur === 'USD') return amount * fx.usd_brl;
  if (cur === 'EUR') return amount * fx.eur_brl;
  return null;
}

export function mapChargesToEstimate(
  charges: ChargeLike[],
  fx: FxRates,
  getMultiplier: (unit: string) => number
): MappedEstimate {
  const out: MappedEstimate = {
    frete_intl_usd: 0,
    seguro_intl_usd: 0,
    acrescimos_usd: 0,
    deducoes_usd: 0,
    expenses: [],
    ignored: [],
  };

  for (const c of charges) {
    const desc = (c.description || '').trim();
    const cur = (c.currency || 'USD').toUpperCase();
    const mult = getMultiplier(c.billing_unit || 'fixed');
    const rawAmount = (Number(c.sell_amount) || 0) * mult;
    if (rawAmount === 0) continue;

    const isDiscount = desc.toUpperCase().includes('DESCONTO');
    // Seguro precisa ser checado ANTES do frete: toda taxa com leg='freight' tem
    // charge_type='freight' (não é uma classificação granular por natureza da taxa),
    // então "c.charge_type === 'freight'" no fallback do isFrete capturava também o
    // Seguro Internacional — ele nunca chegava a ser tratado como isSeguro, e
    // seguro_intl_usd ficava sempre zerado (tudo ia parar em frete_intl_usd).
    const isSeguro = c.leg === 'freight' && hasKeyword(desc, SEGURO_KEYWORDS);
    // Frete internacional: SOMENTE quando leg === 'freight' (inclui rodoviário internacional/Mercosul).
    // Frete com leg 'origin'/'destination' é doméstico e NÃO entra no VMLD nem no ICMS.
    const isFrete = !isSeguro && c.leg === 'freight' && (hasKeyword(desc, FRETE_KEYWORDS) || c.charge_type === 'freight');
    const isFreteDomestico = hasKeyword(desc, FRETE_KEYWORDS) && c.leg !== 'freight';
    const isAduaneira = !hasKeyword(desc, NAO_ADUANEIRA_KEYWORDS) && hasKeyword(desc, ADUANEIRA_KEYWORDS);
    const isPrepaid = c.payment_term === 'prepaid';

    // Calculamos o valor em BRL para exibição e armazenamento. Se esta taxa tem
    // câmbio próprio informado (o que o fornecedor/parceiro desta linha realmente
    // cobrou), usamos ele em vez da taxa fiscal única — mesmo padrão já usado pra
    // usd_brl_agencia. Sem câmbio próprio, cai pra conversão pela taxa fiscal (fx).
    const ownRate = Number(c.exchange_rate) || 0;
    const brl = (ownRate > 0 && cur !== 'BRL') ? rawAmount * ownRate : toBRL(rawAmount, cur, fx);

    if (isDiscount) {
      const usd = toUSD(Math.abs(rawAmount), cur, fx);
      if (usd == null) { out.ignored.push({ description: desc, currency: cur, amount: rawAmount }); continue; }
      out.deducoes_usd += usd;
      continue;
    }

    if (isFrete) {
      const usd = toUSD(rawAmount, cur, fx);
      if (usd == null) { out.ignored.push({ description: desc, currency: cur, amount: rawAmount }); continue; }
      // Frete Prepaid = já pago na origem pelo exportador e embutido no valor
      // da mercadoria (VMCV) cobrado do importador (preço já é CFR/CIF na
      // prática). Somar de novo em frete_intl_usd duplicaria o frete na base
      // do VMLD/II. Só frete Collect (cobrado à parte, no destino) entra na
      // base de cálculo dos impostos. O valor ainda aparece na lista de
      // despesas (Numerário/PDF), só não compõe frete_intl_usd.
      if (!isPrepaid) {
        out.frete_intl_usd += usd;
      }

      if (brl != null) {
        out.expenses.push({
          descricao: desc.toUpperCase(),
          valor_brl: brl,
          valor_original: rawAmount,
          moeda_original: cur,
          aduaneira: typeof c.aduaneira === 'boolean' ? c.aduaneira : false,
          source_charge_id: c.id,
          category: 'freight',
          is_prepaid: isPrepaid,
        });
      }
      continue;
    }

    if (isSeguro) {
      const usd = toUSD(rawAmount, cur, fx);
      if (usd == null) { out.ignored.push({ description: desc, currency: cur, amount: rawAmount }); continue; }
      // Mesma regra do frete: Seguro Prepaid já foi pago na origem e está
      // embutido no valor da mercadoria (VMCV) cobrado do importador — somar
      // de novo em seguro_intl_usd duplicaria o seguro na base do VMLD/II.
      // Só Seguro Collect entra na base de cálculo dos impostos. O valor
      // ainda aparece na lista de despesas (Numerário/PDF).
      if (!isPrepaid) {
        out.seguro_intl_usd += usd;
      }

      if (brl != null) {
        out.expenses.push({
          descricao: desc.toUpperCase(),
          valor_brl: brl,
          valor_original: rawAmount,
          moeda_original: cur,
          aduaneira: typeof c.aduaneira === 'boolean' ? c.aduaneira : false,
          source_charge_id: c.id,
          category: 'freight', // Seguro entra no card de Frete
          is_prepaid: isPrepaid,
        });
      }
      continue;
    }

    if (c.leg === 'origin') {
      const usd = toUSD(rawAmount, cur, fx);
      if (usd != null) out.acrescimos_usd += usd;

      if (brl != null) {
        out.expenses.push({ 
          descricao: desc.toUpperCase(), 
          valor_brl: brl,
          valor_original: rawAmount,
          moeda_original: cur,
          aduaneira: typeof c.aduaneira === 'boolean' ? c.aduaneira : false,
          source_charge_id: c.id,
          category: 'origin',
          is_prepaid: isPrepaid,
        });
      } else {
        out.ignored.push({ description: desc, currency: cur, amount: rawAmount });
      }
      continue;
    }

    if (c.leg === 'destination') {
      if (brl == null) { out.ignored.push({ description: desc, currency: cur, amount: rawAmount }); continue; }
      out.expenses.push({ 
        descricao: desc.toUpperCase(), 
        valor_brl: brl,
        valor_original: rawAmount,
        moeda_original: cur,
        aduaneira: isFreteDomestico
          ? false
          : (typeof c.aduaneira === 'boolean' ? c.aduaneira : isAduaneira),
        source_charge_id: c.id,
        category: 'destination',
        is_prepaid: isPrepaid,
      });
      continue;
    }

    // Fallback (leg desconhecido): trata como despesa local
    if (brl == null) { out.ignored.push({ description: desc, currency: cur, amount: rawAmount }); continue; }
    out.expenses.push({ 
      descricao: desc.toUpperCase(), 
      valor_brl: brl,
      valor_original: rawAmount,
      moeda_original: cur,
      aduaneira: isFreteDomestico
        ? false
        : (typeof c.aduaneira === 'boolean' ? c.aduaneira : isAduaneira),
      source_charge_id: c.id,
      category: 'local',
      is_prepaid: isPrepaid,
    });
  }

  // round 2 casas
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  out.frete_intl_usd = r2(out.frete_intl_usd);
  out.seguro_intl_usd = r2(out.seguro_intl_usd);
  out.acrescimos_usd = r2(out.acrescimos_usd);
  out.deducoes_usd = r2(out.deducoes_usd);
  out.expenses = out.expenses.map(e => ({ 
    ...e, 
    valor_brl: r2(e.valor_brl),
    valor_original: r2(e.valor_original)
  }));

  return out;
}

// ... manter o restante do arquivo (mergeItemsWithQuoteItems)
export interface ExistingItem {
  id: string;
  quote_item_id: string | null;
  nome: string;
  ncm: string | null;
  peso: number;
  quantidade: number;
  vmcv_unit_usd: number;
  aliq_ii: number;
  aliq_ipi: number;
  aliq_pis: number;
  aliq_cofins: number;
  aliq_icms: number;
}

export interface QuoteItemLike {
  id: string;
  commodity: string | null;
  ncm_code: string | null;
  weight_kg: number | null;
  packages: number | null;
  container_qty: number | null;
}

export interface MergedItem {
  action: 'update' | 'insert';
  estimate_item_id?: string;
  data: {
    quote_item_id: string;
    nome: string;
    ncm: string | null;
    peso: number;
    quantidade: number;
    vmcv_unit_usd: number;
    aliq_ii: number;
    aliq_ipi: number;
    aliq_pis: number;
    aliq_cofins: number;
    aliq_icms: number;
  };
}

export function mergeItemsWithQuoteItems(existing: ExistingItem[], qItems: QuoteItemLike[]): MergedItem[] {
  const byQuoteItemId = new Map(existing.filter(e => e.quote_item_id).map(e => [e.quote_item_id!, e]));
  const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
  const usedFallbackIds = new Set<string>();
  const byNameNcm = new Map<string, ExistingItem>();
  // Itens da Estimativa sem vínculo OU "órfãos" (o quote_item deles foi apagado/recriado na Carga) podem ser
  // reaproveitados por nome+NCM — assim os dados fiscais (VMCV, alíquotas) não ficam para trás nem duplicam.
  const currentIds = new Set(qItems.map(q => q.id));
  for (const e of existing) {
    if (e.quote_item_id && currentIds.has(e.quote_item_id)) continue;
    const k = `${norm(e.nome)}|${norm(e.ncm)}`;
    const cur = byNameNcm.get(k);
    if (!cur || (Number(e.vmcv_unit_usd) || 0) > (Number(cur.vmcv_unit_usd) || 0)) byNameNcm.set(k, e);
  }
  const merged: MergedItem[] = [];
  for (const qi of qItems) {
    let prev = byQuoteItemId.get(qi.id);
    if (!prev) {
      const key = `${norm(qi.commodity)}|${norm(qi.ncm_code)}`;
      const fb = byNameNcm.get(key);
      if (fb && !usedFallbackIds.has(fb.id)) {
        prev = fb;
        usedFallbackIds.add(fb.id);
      }
    }
    // Mercadoria/NCM/Peso/Quantidade vêm do Resumo de Carga (quote_items) só
    // na primeira vez (quando o item da Estimativa ainda não existe ou está
    // zerado/vazio). Depois que o usuário edita esses campos na Estimativa,
    // eles passam a ser a fonte de verdade e não voltam a ser sobrescritos
    // por mudanças posteriores na Carga — mesmo padrão já aplicado ao
    // cabeçalho (Incoterm/Trânsito/Carrier/Rota).
    const nome = prev?.nome || qi.commodity || 'Item';
    const ncm = prev?.ncm || qi.ncm_code || null;
    const peso = (prev && Number(prev.peso) > 0) ? Number(prev.peso) : (Number(qi.weight_kg) || 0);
    const quantidade = (prev && Number(prev.quantidade) > 0) ? Number(prev.quantidade) : (Number(qi.packages) || Number(qi.container_qty) || 1);
    if (prev) {
      merged.push({
        action: 'update',
        estimate_item_id: prev.id,
        data: {
          quote_item_id: qi.id,
          nome, ncm, peso, quantidade,
          vmcv_unit_usd: prev.vmcv_unit_usd,
          aliq_ii: prev.aliq_ii, aliq_ipi: prev.aliq_ipi,
          aliq_pis: prev.aliq_pis, aliq_cofins: prev.aliq_cofins,
          aliq_icms: prev.aliq_icms,
        },
      });
    } else {
      merged.push({
        action: 'insert',
        data: {
          quote_item_id: qi.id,
          nome, ncm, peso, quantidade,
          vmcv_unit_usd: 0,
          aliq_ii: 0, aliq_ipi: 0,
          aliq_pis: 2.1, aliq_cofins: 9.65, aliq_icms: 18,
        },
      });
    }
  }
  return merged;
}

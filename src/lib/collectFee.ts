/**
 * Taxas percentuais (billing_unit='percent').
 * Uma charge com billing_unit='percent' tem `buy_amount` e `sell_amount` guardando
 * os PERCENTUAIS (ex.: 2.5 = 2,5%). Os valores calculados são gravados em
 * `computed_buy_amount` / `computed_sell_amount` (em USD), somando as charges
 * cujos ids estão em `percent_base_charge_ids`.
 */
import { chargeSideTotal } from './chargeMin';

export interface PercentChargeLike {
  id: string;
  description: string | null;
  currency: string | null;
  billing_unit: string | null;
  buy_amount: number | null;
  sell_amount: number | null;
  percent_base_charge_ids?: string[] | null;
  computed_buy_amount?: number | null;
  computed_sell_amount?: number | null;
  buy_min_amount?: number | null;
  sell_min_amount?: number | null;
}

export interface CollectFxRates {
  USD: number | null;
  BRL: number | null;
  EUR: number | null;
  [k: string]: number | null;
}

/** Converte um valor em `currency` para USD usando taxas em BRL. */
function toUSD(amount: number, currency: string, fx: CollectFxRates): number | null {
  const cur = (currency || 'USD').toUpperCase();
  if (cur === 'USD') return amount;
  const rateToBrl = fx[cur];
  const usdBrl = fx.USD;
  if (rateToBrl == null || usdBrl == null || usdBrl <= 0) return null;
  const brl = cur === 'BRL' ? amount : amount * rateToBrl;
  return brl / usdBrl;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function isPercentCharge(c: { billing_unit?: string | null } | null | undefined): boolean {
  return !!c && c.billing_unit === 'percent';
}

export interface PercentComputeResult {
  computed_buy_amount: number;
  computed_sell_amount: number;
  base_buy_usd: number;
  base_sell_usd: number;
  baseNames: string[];
  missingRate: boolean;
}

/**
 * Calcula buy_amount/sell_amount de uma charge percentual a partir das charges base.
 * Ignora recursivamente qualquer charge base que também seja percentual (evita ciclo).
 */
export function computePercentCharge(
  charge: PercentChargeLike,
  allCharges: PercentChargeLike[],
  fx: CollectFxRates,
  getMultiplier: (unit: string) => number,
): PercentComputeResult {
  const baseIds = new Set((charge.percent_base_charge_ids || []).filter(Boolean));
  let baseBuy = 0;
  let baseSell = 0;
  const baseNames: string[] = [];
  let missingRate = false;

  for (const c of allCharges) {
    if (!baseIds.has(c.id)) continue;
    if (c.id === charge.id) continue;
    if (isPercentCharge(c)) continue; // evita ciclo
    const mult = getMultiplier(c.billing_unit || 'fixed');
    const cur = (c.currency || 'USD').toUpperCase();
    const bUsd = toUSD(chargeSideTotal(c, 'buy', mult), cur, fx);
    const sUsd = toUSD(chargeSideTotal(c, 'sell', mult), cur, fx);
    if (bUsd == null || sUsd == null) { missingRate = true; continue; }
    baseBuy += bUsd;
    baseSell += sUsd;
    baseNames.push((c.description || '').trim());
  }

  const pBuy = Number(charge.buy_amount) || 0;
  const pSell = Number(charge.sell_amount) || 0;

  return {
    computed_buy_amount: r2(baseBuy * pBuy / 100),
    computed_sell_amount: r2(baseSell * pSell / 100),
    base_buy_usd: r2(baseBuy),
    base_sell_usd: r2(baseSell),
    baseNames,
    missingRate,
  };
}

/**
 * Devolve a lista de updates {id, buy_amount, sell_amount} para todas as charges
 * percentuais que mudaram de valor. Chama supabase.update por conta do caller.
 */
export function collectPercentUpdates(
  allCharges: PercentChargeLike[],
  fx: CollectFxRates,
  getMultiplier: (unit: string) => number,
): Array<{ id: string; computed_buy_amount: number; computed_sell_amount: number }> {
  const updates: Array<{ id: string; computed_buy_amount: number; computed_sell_amount: number }> = [];
  for (const c of allCharges) {
    if (!isPercentCharge(c)) continue;
    const res = computePercentCharge(c, allCharges, fx, getMultiplier);
    const prevBuy = Number(c.computed_buy_amount) || 0;
    const prevSell = Number(c.computed_sell_amount) || 0;
    if (Math.abs(prevBuy - res.computed_buy_amount) > 0.001 || Math.abs(prevSell - res.computed_sell_amount) > 0.001) {
      updates.push({ id: c.id, computed_buy_amount: res.computed_buy_amount, computed_sell_amount: res.computed_sell_amount });
    }
  }
  return updates;
}

export function isCollectFeeName(desc: string | null | undefined): boolean {
  return !!desc && desc.toUpperCase().includes('COLLECT FEE');
}
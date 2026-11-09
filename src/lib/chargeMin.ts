/**
 * Valor mínimo por taxa. Vale só para unidades de peso/medida (kg taxável, ton, m³, W/M):
 * total = max(valor unitário × quantidade, mínimo). Compra e venda têm mínimos separados.
 */
export const MIN_BILLING_UNITS = ['per_cw', 'per_ton', 'per_cbm', 'per_wm'];

export const supportsChargeMin = (unit?: string | null) => MIN_BILLING_UNITS.includes(unit || '');

export function chargeMinKey(amountKey: 'buy_amount' | 'sell_amount' | string): 'buy_min_amount' | 'sell_min_amount' {
  return amountKey === 'buy_amount' ? 'buy_min_amount' : 'sell_min_amount';
}

/** Total da linha: taxa × quantidade, respeitando o mínimo quando a unidade é peso/medida. */
export function chargeLineTotal(rate: number, mult: number, unit: string | null | undefined, min?: number | string | null): number {
  const total = (Number(rate) || 0) * (Number(mult) || 0);
  const m = Number(min) || 0;
  if (m > 0 && supportsChargeMin(unit) && (Number(rate) || 0) > 0) return Math.max(total, m);
  return total;
}

/** Atalho para uma linha de quote_charges ('buy' | 'sell'). */
export function chargeSideTotal(c: any, side: 'buy' | 'sell', mult: number): number {
  const rate = Number(c?.[`${side}_amount`]) || 0;
  return chargeLineTotal(rate, mult, c?.billing_unit, c?.[`${side}_min_amount`]);
}

import { describe, it, expect } from 'vitest';
import { chargeLineTotal, chargeSideTotal } from '@/lib/chargeMin';

describe('mínimo por taxa', () => {
  it('aplica o mínimo em unidades de peso/medida', () => {
    expect(chargeLineTotal(2, 10, 'per_cw', 50)).toBe(50);
    expect(chargeLineTotal(2, 100, 'per_cw', 50)).toBe(200);
    expect(chargeLineTotal(30, 0.5, 'per_cbm', 40)).toBe(40);
  });
  it('ignora o mínimo em unidade fixa/contêiner ou sem valor', () => {
    expect(chargeLineTotal(2, 10, 'per_container', 50)).toBe(20);
    expect(chargeLineTotal(2, 10, 'per_cw', null)).toBe(20);
    expect(chargeLineTotal(0, 10, 'per_cw', 50)).toBe(0);
  });
  it('lado compra/venda usa o mínimo correspondente', () => {
    const c = { billing_unit: 'per_ton', buy_amount: 10, sell_amount: 20, buy_min_amount: 30, sell_min_amount: 0 };
    expect(chargeSideTotal(c, 'buy', 1)).toBe(30);
    expect(chargeSideTotal(c, 'sell', 1)).toBe(20);
  });
});

import { describe, it, expect } from 'vitest';
import { getAgencyRate, mapChargesToEstimate } from '@/lib/estimateSync';

const charge = (over: any = {}) => ({
  id: 'c1', description: 'TAXAS DE DESTINO', leg: 'destination', charge_type: 'destination',
  billing_unit: 'fixed', currency: 'USD', sell_amount: 100, buy_amount: 0, ...over,
});
const mult = () => 1;

describe('câmbio da agência', () => {
  it('getAgencyRate: manual, auto com spread e vazio', () => {
    expect(getAgencyRate({ usd_brl: 5, usd_brl_agencia: 5.4 })).toBe(5.4);
    expect(getAgencyRate({ usd_brl: 5, usd_brl_agencia_auto: true }, 2)).toBe(5.1);
    expect(getAgencyRate({ usd_brl: 5 })).toBe(0);
  });
  it('despesa em USD converte pela agência; sem agência cai no fiscal', () => {
    const com = mapChargesToEstimate([charge()] as any, { usd_brl: 5, eur_brl: 6, usd_brl_agencia: 5.5 }, mult);
    expect(com.expenses[0].valor_brl).toBe(550);
    const sem = mapChargesToEstimate([charge()] as any, { usd_brl: 5, eur_brl: 6 }, mult);
    expect(sem.expenses[0].valor_brl).toBe(500);
  });
  it('base USD do frete não muda com a agência', () => {
    const f = charge({ id: 'f', description: 'FRETE INTERNACIONAL', leg: 'freight', charge_type: 'freight', sell_amount: 1000 });
    const a = mapChargesToEstimate([f] as any, { usd_brl: 5, eur_brl: 6, usd_brl_agencia: 5.5 }, mult);
    const b = mapChargesToEstimate([f] as any, { usd_brl: 5, eur_brl: 6 }, mult);
    expect(a.frete_intl_usd).toBe(b.frete_intl_usd);
  });
});

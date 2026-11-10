import { describe, it, expect } from 'vitest';
import { buildTaxTargets } from '@/lib/estimateTaxCharges';

describe('buildTaxTargets', () => {
  it('converte tributos de USD p/ BRL, mantém Siscomex/AFRMM em BRL e arredonda em 2 casas', () => {
    const r = buildTaxTargets({
      ii_usd: 100, ipi_usd: 50.555, pis_usd: 0, cofins_usd: 0, icms_usd: 40.1234,
      usd_brl: 5.5, taxa_siscomex_brl: 154.23, afrmm_brl: 59.171,
    });
    expect(r.map(t => t.name)).toEqual(['II', 'IPI', 'PIS', 'COFINS', 'ICMS', 'TAXA SISCOMEX', 'AFRMM']);
    expect(r[0].amountBrl).toBe(550);
    expect(r[1].amountBrl).toBe(278.05);
    expect(r[4].amountBrl).toBe(220.68);
    expect(r[5].amountBrl).toBe(154.23);
    expect(r[6].amountBrl).toBe(59.17);
  });
});

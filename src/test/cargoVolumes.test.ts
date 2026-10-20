import { describe, it, expect } from 'vitest';
import {
  emptyCargoItem, emptyCargoVolume, effectiveCalcItems, legacyItemsToVolumes, getVolumesMissingQty,
  calcItemWeight, getEffectiveVolume, calcChargeableWeight, buildCargoSummaryLines, type CargoVolume,
} from '@/components/quotes/ModeFields';

const vol = (p: Partial<CargoVolume>): CargoVolume => ({ ...emptyCargoVolume, ...p });
const totals = (mode: string, items: any[], vols?: CargoVolume[]) => {
  const c = effectiveCalcItems(mode, items, vols);
  return {
    kg: c.reduce((s, i) => s + calcItemWeight(i), 0),
    cbm: c.reduce((s, i) => s + getEffectiveVolume(i), 0),
    cw: calcChargeableWeight(c, mode),
  };
};

describe('linhas de volume', () => {
  it('peso e cubagem = quantidade × valor por unidade', () => {
    const t = totals('ocean_lcl', [], [vol({ qty: '150', weight_kg: '6.9', volume_cbm: '0.02704' })]);
    expect(t.kg).toBeCloseTo(1035, 4);
    expect(t.cbm).toBeCloseTo(4.056, 4);
    expect(t.cw).toBeCloseTo(4056, 3); // LCL: 1 m³ = 1000 kg
  });

  it('usa C/L/A quando informados', () => {
    const t = totals('air', [], [vol({ qty: '4', length_cm: '120', width_cm: '100', height_cm: '100', weight_kg: '250' })]);
    expect(t.kg).toBe(1000);
    expect(t.cbm).toBeCloseTo(4.8, 6);
  });

  it('soma várias linhas', () => {
    const t = totals('ocean_lcl', [], [
      vol({ qty: '100', weight_kg: '6.9', volume_cbm: '0.02706' }),
      vol({ qty: '20', weight_kg: '6.9', volume_cbm: '0.0273' }),
    ]);
    expect(t.kg).toBeCloseTo(828, 4);
    expect(t.cbm).toBeCloseTo(3.252, 4);
  });

  it('sem linhas cai no formato antigo (medidas dentro do item)', () => {
    const item = { ...emptyCargoItem, packages: '10', weight_kg: '5', volume_cbm: '0.1' };
    const t = totals('ocean_lcl', [item], []);
    expect(t.kg).toBe(50);
    expect(t.cbm).toBeCloseTo(1, 6);
  });

  it('FCL ignora linhas de volume', () => {
    const item = { ...emptyCargoItem, weight_kg: '20000' };
    expect(totals('ocean_fcl', [item], [vol({ qty: '5', weight_kg: '10' })]).kg).toBe(20000);
  });

  it('converte itens antigos em linhas e avisa linha sem quantidade', () => {
    const items = [
      { ...emptyCargoItem, packages: '100', weight_kg: '6.9', volume_cbm: '0.027' },
      { ...emptyCargoItem, packages: '', weight_kg: '6.9', volume_cbm: '0.027' },
      { ...emptyCargoItem, commodity: 'só texto' },
    ];
    const vols = legacyItemsToVolumes(items, 'ocean_lcl');
    expect(vols).toHaveLength(2);
    expect(getVolumesMissingQty(vols)).toEqual([2]);
    expect(legacyItemsToVolumes(items, 'ocean_fcl')).toEqual([]);
  });

  it('resumo copiável lista volumes e itens só comerciais', () => {
    const lines = buildCargoSummaryLines(
      'ocean_lcl',
      [{ ...emptyCargoItem, commodity: 'Estojo CD', pieces: '15000', pieces_unit: 'pçs', ncm_code: '4819.50.00' }],
      { pallets: '4', packages: '320', package_type: 'caixa' },
      [vol({ qty: '150', package_type: 'caixa', weight_kg: '6.9', volume_cbm: '0.02704' })],
    ).join('\n');
    expect(lines).toContain('Peso Total: 1035 kg');
    expect(lines).toContain('Volumes:');
    expect(lines).toContain('150 caixas');
    expect(lines).toContain('Quantidade: 15.000 pçs');
    expect(lines).not.toMatch(/Peso: 6\.9 kg\/vol/);
  });
});

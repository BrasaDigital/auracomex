import { describe, it, expect } from 'vitest';
import { buildCargoSummaryLines, getItemsMissingPackages, emptyCargoItem } from '@/components/quotes/ModeFields';

const item = (over: Partial<typeof emptyCargoItem>) => ({ ...emptyCargoItem, ...over });

// Cotação 26/334 (aéreo, SZX → GRU): peso digitado é POR VOLUME.
const items26_334 = [
  item({ weight_kg: '16.6', length_cm: '72', width_cm: '48', height_cm: '42', packages: '4' }),
  item({ weight_kg: '10.6', length_cm: '56', width_cm: '48', height_cm: '35', packages: '1' }),
];

describe('buildCargoSummaryLines', () => {
  it('multiplica peso por volumes e não vaza ponto flutuante', () => {
    const text = buildCargoSummaryLines('air', items26_334).join('\n');
    expect(text).toContain('Peso Total: 77 kg'); // 16.6×4 + 10.6×1
    expect(text).toContain('Volume Total: 0.6747 m³');
    expect(text).toContain('Total Volumes: 5');
    expect(text).toContain('Peso: 16.6 kg/vol. (total 66.4 kg)');
    expect(text).toContain('Peso: 10.6 kg');
    expect(text).not.toMatch(/\d\.\d{4,} kg/);
  });
});

describe('getItemsMissingPackages', () => {
  it('aponta item preenchido sem Volumes (não-FCL)', () => {
    const items = [items26_334[0], item({ weight_kg: '10.6', length_cm: '56', width_cm: '48', height_cm: '35' })];
    expect(getItemsMissingPackages(items, 'air')).toEqual([2]);
  });
  it('ignora item totalmente vazio e FCL', () => {
    expect(getItemsMissingPackages([item({})], 'air')).toEqual([]);
    expect(getItemsMissingPackages([item({ weight_kg: '10' })], 'ocean_fcl')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { calcEstimativa, EstimateInput, expenseFiscalUsd } from '@/lib/costEstimate';

const baseInput = (overrides: Partial<EstimateInput> = {}): EstimateInput => ({
  acrescimos_usd: 0,
  deducoes_usd: 0,
  frete_intl_usd: 0,
  seguro_intl_usd: 0,
  usd_brl: 5,
  rateio_metodo: 'valor',
  items: [],
  expenses: [],
  ...overrides,
});

describe('calcEstimativa', () => {
  it('FOB marítimo, um item, ICMS 18%', () => {
    // VMCV 1000 USD, frete 100, seguro 10
    // VMLE = 1000, VMLD = 1110
    // II 14% × 1110 = 155.40
    // IPI 5% × (1110+155.40) = 63.27
    // PIS 2.1% × 1110 = 23.31
    // COFINS 9.65% × 1110 = 107.115
    // Base ICMS = 1110+155.40+63.27+23.31+107.115+0 (sem aduaneiras) = 1459.095
    // ICMS = 1459.095/(1-0.18)*0.18 = 320.361...
    const out = calcEstimativa(baseInput({
      frete_intl_usd: 100, seguro_intl_usd: 10,
      items: [{
        nome: 'X', peso: 100, quantidade: 1, vmcv_unit_usd: 1000,
        aliq_ii: 14, aliq_ipi: 5, aliq_pis: 2.1, aliq_cofins: 9.65, aliq_icms: 18,
        destinacao: 'consumo_final',
      }],
    }));
    expect(out.vmld_usd).toBeCloseTo(1110, 2);
    expect(out.ii_usd).toBeCloseTo(155.40, 2);
    expect(out.ipi_usd).toBeCloseTo(63.27, 2);
    expect(out.pis_usd).toBeCloseTo(23.31, 2);
    expect(out.cofins_usd).toBeCloseTo(107.12, 1);
    expect(out.icms_usd).toBeCloseTo(320.29, 1);
  });

  it('Revenda: IPI fora da base do ICMS reduz o imposto', () => {
    const cf = calcEstimativa(baseInput({
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 10, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 18, destinacao: 'consumo_final' }],
    }));
    const rev = calcEstimativa(baseInput({
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 10, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 18, destinacao: 'revenda_industrializacao' }],
    }));
    expect(rev.icms_usd).toBeLessThan(cf.icms_usd);
  });

  it('Taxa Siscomex e AFRMM entram na base de ICMS e no total', () => {
    const semExtras = calcEstimativa(baseInput({
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 18 }],
    }));
    const comExtras = calcEstimativa(baseInput({
      taxa_siscomex_brl: 250, // 50 USD
      afrmm_brl: 500,          // 100 USD
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 18 }],
    }));
    expect(comExtras.icms_usd).toBeGreaterThan(semExtras.icms_usd);
    expect(comExtras.despesas_nac_brl).toBe(750);
    expect(comExtras.despesas_aduaneiras_brl).toBe(750);
  });

  it('COFINS +1% adiciona 1 ponto percentual', () => {
    const semAdicional = calcEstimativa(baseInput({
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 9.65, aliq_icms: 0 }],
    }));
    const comAdicional = calcEstimativa(baseInput({
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 9.65, aliq_icms: 0, cofins_adicional: true }],
    }));
    expect(comAdicional.cofins_usd - semAdicional.cofins_usd).toBeCloseTo(10, 2); // 1% de 1000
  });

  it('Rateio por peso divide corretamente frete entre itens', () => {
    const out = calcEstimativa(baseInput({
      frete_intl_usd: 300,
      rateio_metodo: 'peso',
      items: [
        { nome: 'A', peso: 100, quantidade: 1, vmcv_unit_usd: 500, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 0 },
        { nome: 'B', peso: 200, quantidade: 1, vmcv_unit_usd: 500, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 0 },
      ],
    }));
    expect(out.itemBreakdowns[0].frete_usd).toBeCloseTo(100, 2);
    expect(out.itemBreakdowns[1].frete_usd).toBeCloseTo(200, 2);
  });

  it('Fallback igualitário quando denominador é zero', () => {
    const out = calcEstimativa(baseInput({
      frete_intl_usd: 100,
      rateio_metodo: 'valor',
      items: [
        { nome: 'A', peso: 10, quantidade: 1, vmcv_unit_usd: 0, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 0 },
        { nome: 'B', peso: 10, quantidade: 1, vmcv_unit_usd: 0, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 0 },
      ],
    }));
    expect(out.rateio_igualitario_fallback).toBe(true);
    expect(out.itemBreakdowns[0].frete_usd).toBeCloseTo(50, 2);
    expect(out.itemBreakdowns[1].frete_usd).toBeCloseTo(50, 2);
  });

  it('Classificação automática (null): Armazenagem e Honorários de desembaraço NÃO entram na base do ICMS; Siscomex/THC entram', () => {
    const item = { nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 18 };
    const fora = calcEstimativa(baseInput({
      items: [item],
      expenses: [
        { descricao: 'ARMAZENAGEM', valor_brl: 400, aduaneira: null, category: 'destination' },
        { descricao: 'HONORÁRIOS DE DESEMBARAÇO', valor_brl: 850, aduaneira: null, category: 'destination' },
        { descricao: 'TAXA DE EXPEDIENTE', valor_brl: 250, aduaneira: null, category: 'destination' },
      ],
    }));
    expect(fora.despesas_aduaneiras_brl).toBe(0);
    const dentro = calcEstimativa(baseInput({
      items: [item],
      expenses: [{ descricao: 'THC DESTINO', valor_brl: 500, aduaneira: null, category: 'destination' }],
    }));
    expect(dentro.despesas_aduaneiras_brl).toBe(500);
  });

  it('Classificação automática (aduaneira não definida, null): ARMAZENAGEM ZONA SECUNDÁRIA e FRETE RODOVIÁRIO ficam FORA da base', () => {
    const out = calcEstimativa(baseInput({
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 18 }],
      expenses: [
        { descricao: 'ARMAZENAGEM ZONA SECUNDÁRIA', valor_brl: 500, aduaneira: null, category: 'destination' },
        { descricao: 'FRETE RODOVIÁRIO NVT X IÇARA', valor_brl: 300, aduaneira: null, category: 'destination' },
      ],
    }));
    expect(out.despesas_aduaneiras_brl).toBe(0);
    // continuam no total de despesas nacionais, apenas não entram na base do ICMS
    expect(out.despesas_nac_brl).toBe(800);
  });

  it('Flag manual aduaneira=true prevalece mesmo sem palavra-chave', () => {
    const out = calcEstimativa(baseInput({
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 18 }],
      expenses: [{ descricao: 'TAXA CUSTOMIZADA', valor_brl: 200, aduaneira: true, category: 'destination' }],
    }));
    expect(out.despesas_aduaneiras_brl).toBe(200);
  });

  it('Flag manual aduaneira=false força FORA da base mesmo com palavra-chave batendo', () => {
    const out = calcEstimativa(baseInput({
      items: [{ nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 1000, aliq_ii: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 18 }],
      expenses: [{ descricao: 'CAPATAZIAS', valor_brl: 200, aduaneira: false, category: 'destination' }],
    }));
    // "CAPATAZIA" bateria na palavra-chave e entraria na base automaticamente,
    // mas o override manual (false) tem que vencer.
    expect(out.despesas_aduaneiras_brl).toBe(0);
    expect(out.despesas_nac_brl).toBe(200);
  });
});
describe('expenseFiscalUsd (Cálculo Consolidado: frete/origem na base fiscal)', () => {
  const fx = { usd_brl: 5.5606, eur_brl: 6.1483 };
  it('despesa em USD vale o valor original, mesmo com R$ gravado pelo câmbio da agência', () => {
    // frete US$ 6.200 gravado em R$ a 6,0325 (agência); o consolidado não pode virar 6.726,16
    expect(expenseFiscalUsd({ valor_brl: 37401.5, valor_original: 6200, moeda_original: 'USD' }, fx)).toBe(6200);
  });
  it('despesa em EUR converte pelo câmbio fiscal', () => {
    expect(expenseFiscalUsd({ valor_brl: 999, valor_original: 100, moeda_original: 'EUR' }, fx)).toBeCloseTo((100 * 6.1483) / 5.5606, 6);
  });
  it('despesa em BRL (ou sem original) é dividida pelo câmbio fiscal', () => {
    expect(expenseFiscalUsd({ valor_brl: 5560.6, valor_original: 5560.6, moeda_original: 'BRL' }, fx)).toBeCloseTo(1000, 6);
    expect(expenseFiscalUsd({ valor_brl: 5560.6 }, fx)).toBeCloseTo(1000, 6);
  });
  it('câmbio fiscal zerado não quebra', () => {
    expect(expenseFiscalUsd({ valor_brl: 100 }, { usd_brl: 0 })).toBe(0);
  });
});

describe('valor aduaneiro: mercadoria no câmbio fiscal, frete e seguro no câmbio da agência', () => {
  const item = { id: 'i1', nome: 'X', peso: 1, quantidade: 1, vmcv_unit_usd: 812, aliq_ii: 18, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0, aliq_icms: 0 } as any;
  const base = (over: Partial<EstimateInput> = {}): EstimateInput => ({
    acrescimos_usd: 0, deducoes_usd: 0, frete_intl_usd: 627.83, seguro_intl_usd: 3.93,
    usd_brl: 5.56, rateio_metodo: 'valor', items: [item], expenses: [], ...over,
  });

  it('MD26/0114: VMLD em R$ = 812 × 5,56 + (627,83 + 3,93) × 5,67', () => {
    const out = calcEstimativa(base({ usd_brl_agencia: 5.67 }));
    const esperadoBrl = 812 * 5.56 + (627.83 + 3.93) * 5.67;
    expect(out.vmld_usd * 5.56).toBeCloseTo(esperadoBrl, 1);
    // tributos acompanham a base em R$: II = 18% do valor aduaneiro
    expect(out.ii_usd * 5.56).toBeCloseTo(esperadoBrl * 0.18, 1);
  });
  it('sem câmbio da agência tudo fica no fiscal (comportamento anterior)', () => {
    const sem = calcEstimativa(base());
    const zero = calcEstimativa(base({ usd_brl_agencia: 0 }));
    expect(sem.vmld_usd).toBeCloseTo(812 + 627.83 + 3.93, 2);
    expect(zero.vmld_usd).toBe(sem.vmld_usd);
  });
  it('a mercadoria nunca muda com o câmbio da agência', () => {
    expect(calcEstimativa(base({ usd_brl_agencia: 6.5 })).vmle_usd).toBe(calcEstimativa(base()).vmle_usd);
  });
});

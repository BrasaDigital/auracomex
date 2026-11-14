import { describe, it, expect } from 'vitest';
import { currencyDecimals, formatAmount, formatMoney } from '@/lib/money';

describe('money', () => {
  it('usa as casas decimais padrão de cada moeda', () => {
    expect(currencyDecimals('BRL')).toBe(2);
    expect(currencyDecimals('usd')).toBe(2);
    expect(currencyDecimals('EUR')).toBe(2);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('KRW')).toBe(0);
    expect(currencyDecimals('KWD')).toBe(3);
    expect(currencyDecimals('XYZ')).toBe(2); // desconhecida: 2
    expect(currencyDecimals(null)).toBe(2);
  });

  it('formata o número no padrão brasileiro com as casas da moeda', () => {
    expect(formatAmount(1234.5, 'USD')).toBe('1.234,50');
    expect(formatAmount(1234.5, 'JPY')).toBe('1.235');
    expect(formatAmount(1.2345, 'KWD')).toBe('1,235');
    expect(formatAmount(0, 'BRL')).toBe('0,00');
  });

  it('trata valores vazios ou inválidos como zero', () => {
    expect(formatAmount(null, 'BRL')).toBe('0,00');
    expect(formatAmount(undefined, 'USD')).toBe('0,00');
    expect(formatAmount('abc', 'EUR')).toBe('0,00');
    expect(formatAmount(NaN, 'EUR')).toBe('0,00');
    expect(formatAmount('12.5', 'EUR')).toBe('12,50');
  });

  it('mantém a moeda na mesma linha do valor (espaço sem quebra)', () => {
    const s = formatMoney(1234.56, 'USD');
    expect(s).toBe('USD 1.234,56');
    expect(s.includes(' ')).toBe(false); // nenhum espaço comum, que permitiria quebrar a linha
    expect(formatMoney(5, 'eur')).toBe('EUR 5,00');
  });

  it('mostra R$ para o real só quando pedido', () => {
    expect(formatMoney(10, 'BRL')).toBe('BRL 10,00');
    expect(formatMoney(10, 'BRL', { symbol: true })).toBe('R$ 10,00');
    expect(formatMoney(10, 'USD', { symbol: true })).toBe('USD 10,00');
    expect(formatMoney(1500, undefined)).toBe('BRL 1.500,00');
  });

  it('mostra o sinal também nos positivos quando pedido (diferenças)', () => {
    expect(formatMoney(10, 'BRL', { sign: true })).toBe('BRL +10,00');
    expect(formatMoney(-10, 'BRL', { sign: true })).toBe('BRL -10,00');
    expect(formatMoney(0, 'BRL', { sign: true })).toBe('BRL 0,00');
  });

  it('JPY não ganha casas que não existem', () => {
    expect(formatMoney(1500, 'JPY')).toBe('JPY 1.500');
  });
});

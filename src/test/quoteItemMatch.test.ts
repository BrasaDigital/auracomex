import { describe, it, expect } from 'vitest';
import { isLooseQuoteItemMatch } from '@/lib/estimateSync';

describe('isLooseQuoteItemMatch', () => {
  it('Carga sem mercadoria + mesma NCM NÃO casa (item digitado à mão não pode ser apagado)', () => {
    expect(isLooseQuoteItemMatch({ nome: 'Item 2', ncm: '3916.90.10' }, { commodity: null, ncm_code: '3916.90.10' })).toBe(false);
  });
  it('mesma mercadoria e mesma NCM casa', () => {
    expect(isLooseQuoteItemMatch({ nome: 'Filamentos ', ncm: '3916.90.10' }, { commodity: 'FILAMENTOS', ncm_code: '3916.90.10' })).toBe(true);
  });
  it('mesma mercadoria, Carga sem NCM, casa', () => {
    expect(isLooseQuoteItemMatch({ nome: 'FILAMENTOS', ncm: '3916.90.10' }, { commodity: 'FILAMENTOS', ncm_code: null })).toBe(true);
  });
  it('mesma mercadoria mas NCM diferente não casa', () => {
    expect(isLooseQuoteItemMatch({ nome: 'FILAMENTOS', ncm: '3917.00.00' }, { commodity: 'FILAMENTOS', ncm_code: '3916.90.10' })).toBe(false);
  });
  it('nome diferente com mesma NCM não casa', () => {
    expect(isLooseQuoteItemMatch({ nome: 'Item 2', ncm: '3916.90.10' }, { commodity: 'FILAMENTOS', ncm_code: '3916.90.10' })).toBe(false);
  });
});

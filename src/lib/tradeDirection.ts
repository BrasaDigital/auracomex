export type TradeDirection = 'IMP' | 'EXP';

/** Código de porto/aeroporto (ex.: BRSSZ) ou texto "Cidade, BR" / "(BR)" do Brasil. */
export function isBrazil(place?: string | null): boolean {
  if (!place) return false;
  const p = place.trim().toUpperCase();
  return p.startsWith('BR') || p.includes('(BR)') || p.includes(', BR');
}

/**
 * Regra única de Importação/Exportação:
 * origem Brasil → EXP; destino Brasil → IMP.
 * Sem Brasil em nenhuma ponta (ou rota ainda vazia), mantém `fallback`.
 */
export function getTradeDirection(
  origin?: string | null,
  destination?: string | null,
  fallback: TradeDirection = 'IMP',
): TradeDirection {
  if (isBrazil(origin)) return 'EXP';
  if (isBrazil(destination)) return 'IMP';
  return fallback;
}

export const TRADE_DIRECTION_LABEL: Record<TradeDirection, string> = {
  IMP: 'Importação',
  EXP: 'Exportação',
};

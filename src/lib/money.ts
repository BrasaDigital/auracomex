/**
 * Formatação padrão de valores em moeda para as TELAS do app (não para PDFs de cliente, que têm layout próprio).
 *
 * - Casas decimais conforme a moeda (ISO 4217): a maioria usa 2 (BRL, USD, EUR...), mas JPY, KRW, CLP etc. usam 0 e
 *   KWD, BHD, OMR etc. usam 3. Antes cada tela forçava 2 casas.
 * - A moeda fica sempre na MESMA linha do valor: o separador entre a moeda e o número é um espaço sem quebra (NBSP),
 *   então "USD 1.234,56" nunca vira duas linhas em coluna estreita.
 * - Separadores no padrão brasileiro (1.234,56), igual em todas as telas.
 */

// Moedas que NÃO usam 2 casas decimais (ISO 4217, unidade menor).
const DECIMAIS_POR_MOEDA: Record<string, number> = {
  // 0 casas
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0,
  XAF: 0, XOF: 0, XPF: 0,
  // 3 casas
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

const NBSP = " ";

/** Casas decimais padrão da moeda (2 quando desconhecida). */
export function currencyDecimals(currency?: string | null): number {
  const code = String(currency ?? "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(DECIMAIS_POR_MOEDA, code) ? DECIMAIS_POR_MOEDA[code] : 2;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Só o número, com as casas decimais da moeda e separadores brasileiros (ex.: 1.234,56).
 * `sign: true` mostra o sinal também nos positivos (+1.234,56), útil para diferenças.
 */
export function formatAmount(
  value: number | string | null | undefined,
  currency?: string | null,
  opts: { sign?: boolean } = {},
): string {
  const d = currencyDecimals(currency);
  return toNumber(value).toLocaleString("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    ...(opts.sign ? { signDisplay: "exceptZero" as const } : {}),
  });
}

/**
 * Valor com a moeda na mesma linha. Por padrão mostra o código da moeda ("USD 1.234,56"); com `symbol: true`
 * mostra "R$" para o real ("R$ 1.234,56") e o código para as demais.
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string | null | undefined = "BRL",
  opts: { symbol?: boolean; sign?: boolean } = {},
): string {
  const code = String(currency ?? "BRL").trim().toUpperCase() || "BRL";
  const label = opts.symbol && code === "BRL" ? "R$" : code;
  return `${label}${NBSP}${formatAmount(value, code, { sign: opts.sign })}`;
}

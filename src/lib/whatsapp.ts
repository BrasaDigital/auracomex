/** Número do WhatsApp oficial (Cloud API) da AuraComex — só dígitos, com DDI. */
export const AURA_WHATSAPP_NUMBER = "5511961573287";

/**
 * Link do wa.me com a mensagem pré-preenchida. O marcador "[origem: X]" no fim
 * é lido pelo whatsapp-webhook (Supabase Edge Function): grava a origem em
 * whatsapp_contacts.source e remove o marcador do texto salvo.
 */
export function buildWaLink(message: string, origem?: string): string {
  const text = origem ? `${message}\n\n[origem: ${origem}]` : message;
  return `https://wa.me/${AURA_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

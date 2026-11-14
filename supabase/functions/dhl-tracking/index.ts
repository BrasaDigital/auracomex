import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Erros de diagnóstico voltam com status 200 e um campo "error" (sem segredos),
// para o conector conseguir mostrar a causa em vez de uma falha genérica.
const fail = (stage: string, message: string, extra: Record<string, unknown> = {}) =>
  json({ found: false, error: message, stage, ...extra });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Exige um usuário logado no Aura (não basta a chave anônima pública),
    // para ninguém de fora gastar a cota da API da DHL.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return fail("auth", "Não autenticado");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return fail("auth", "Não autenticado");

    const body = await req.json().catch(() => ({}));
    const trackingNumber = String((body as any).tracking_number || "").replace(/\s/g, "");
    if (!/^[A-Za-z0-9]{6,40}$/.test(trackingNumber)) {
      return fail("input", "Código de rastreio inválido");
    }

    const apiKey = Deno.env.get("DHL_API_KEY");
    if (!apiKey) return fail("config", "DHL_API_KEY não configurada no Supabase");

    const url = `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}&service=express&language=pt`;
    let resp: Response;
    try {
      resp = await fetch(url, { headers: { "DHL-API-Key": apiKey.trim(), Accept: "application/json" } });
    } catch (e) {
      return fail("rede", "Não foi possível conectar à API da DHL", { detalhe: String((e as Error)?.message ?? e).slice(0, 150) });
    }

    if (resp.status === 404) return json({ found: false, tracking_number: trackingNumber, stage: "dhl", dhl_status: 404 });
    if (!resp.ok) {
      const txt = (await resp.text().catch(() => "")).slice(0, 300);
      return fail("dhl", `A DHL respondeu com erro ${resp.status}`, { dhl_status: resp.status, dhl_resposta: txt });
    }

    const data = await resp.json();
    const s = data?.shipments?.[0];
    if (!s) return json({ found: false, tracking_number: trackingNumber });

    const loc = (l: any) => l?.address?.addressLocality || null;
    const last = s.events?.[0] || s.status || {};

    return json({
      found: true,
      tracking_number: trackingNumber,
      service: s.service || null,
      origin: loc(s.origin),
      destination: loc(s.destination),
      status: s.status?.status || null,
      status_code: s.status?.statusCode || null,
      last_event: {
        description: last.description || s.status?.description || null,
        location: loc(last.location),
        timestamp: last.timestamp || s.status?.timestamp || null,
      },
      estimated_delivery: s.estimatedTimeOfDelivery || null,
      estimated_delivery_remark: s.estimatedTimeOfDeliveryRemark || null,
    });
  } catch (_err) {
    return fail("interno", "Erro interno");
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Envia mensagem de WhatsApp (texto livre ou template aprovado) a partir do
 * app da AuraComex, usando o número/token da própria AuraComex. Chamada
 * autenticada (verify_jwt: true) e, além disso, SÓ SUPERADMIN (equipe da
 * plataforma) pode disparar: o painel /admin/whatsapp é só do superadmin, e
 * sem esta checagem qualquer usuário logado de qualquer empresa (ou quem
 * tivesse a chave pública) poderia mandar mensagens pelo número da AuraComex.
 *
 * Body esperado:
 *   { phone: "5511900000000", body: "texto livre" }
 *   ou
 *   { phone: "5511900000000", templateName: "boas_vindas", templateLang?: "pt_BR", templateParams?: string[] }
 *
 * Regra do WhatsApp: fora da janela de 24h desde a última mensagem do
 * cliente, só é permitido iniciar contato com um template pré-aprovado —
 * texto livre nesse caso é rejeitado pela própria Graph API.
 *
 * IDENTIFICAÇÃO DO ATENDENTE: em texto livre, o primeiro nome de quem está
 * logado (profiles.full_name) vai em negrito no início da mensagem enviada ao
 * cliente ("*Marcos:* texto") e fica gravado em whatsapp_messages.sent_by_name
 * (o corpo gravado não leva o prefixo; o painel mostra o nome acima do balão).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Só superadmin (ou chamada interna com a chave de servidor) pode enviar.
    const callerJwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!callerJwt) return jsonResponse({ error: "Não autenticado." }, 401);
    if (callerJwt !== serviceRoleKey) {
      const { data: callerData } = await supabase.auth.getUser(callerJwt);
      const callerId = callerData?.user?.id;
      if (!callerId) return jsonResponse({ error: "Não autenticado." }, 401);
      const { data: callerRoles } = await supabase.from("user_roles").select("role").eq("user_id", callerId);
      if (!(callerRoles ?? []).some((r: any) => r.role === "superadmin")) {
        return jsonResponse({ error: "Sem permissão: somente a equipe da plataforma pode enviar mensagens." }, 403);
      }
    }

    const token = Deno.env.get("WHATSAPP_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    if (!token || !phoneNumberId) {
      return jsonResponse({ error: "WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID não configurados" }, 500);
    }

    const payload = await req.json().catch(() => null);
    if (!payload?.phone) return jsonResponse({ error: "'phone' é obrigatório" }, 400);

    const phone: string = String(payload.phone).replace(/\D/g, "");

    // Quem está atendendo: usuário do JWT -> profiles.full_name (primeiro nome).
    const senderName = await getSenderName(supabase, req.headers.get("authorization"));

    let waBody: Record<string, unknown>;
    let logType: string;
    let logBody: string | null;
    let sentByName: string | null = null;

    if (payload.templateName) {
      waBody = {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: payload.templateName,
          language: { code: payload.templateLang ?? "pt_BR" },
          ...(payload.templateParams?.length
            ? { components: [{ type: "body", parameters: payload.templateParams.map((p: string) => ({ type: "text", text: p })) }] }
            : {}),
        },
      };
      logType = "template";
      logBody = payload.templateParams?.length ? payload.templateParams.join(" | ") : null;
      sentByName = senderName;
    } else if (payload.body) {
      const text = senderName ? `*${senderName}:* ${payload.body}` : String(payload.body);
      waBody = {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: text },
      };
      logType = "text";
      logBody = payload.body;
      sentByName = senderName;
    } else {
      return jsonResponse({ error: "Envie 'body' (texto livre) ou 'templateName' (fora da janela de 24h)" }, 400);
    }

    const graphRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(waBody),
    });
    const graphJson = await graphRes.json();

    if (!graphRes.ok) {
      console.error("whatsapp-send: erro da Graph API", graphJson);
      return jsonResponse({ error: graphJson?.error?.message ?? "Falha ao enviar via WhatsApp", details: graphJson }, graphRes.status);
    }

    const contactId = await upsertContact(supabase, phone);

    const waMessageId: string | undefined = graphJson?.messages?.[0]?.id;
    const { error: insertError } = await supabase.from("whatsapp_messages").insert({
      contact_id: contactId,
      direction: "outbound",
      wa_message_id: waMessageId ?? null,
      message_type: logType,
      body: logBody,
      template_name: payload.templateName ?? null,
      status: "sent",
      sent_by_name: sentByName,
      raw_payload: graphJson,
    });
    if (insertError) console.error("whatsapp-send: falha ao gravar log da mensagem", insertError);

    await supabase
      .from("whatsapp_contacts")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", contactId);

    return jsonResponse({ success: true, waMessageId }, 200);
  } catch (err) {
    console.error("whatsapp-send error", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro interno" }, 500);
  }
});

async function getSenderName(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
): Promise<string | null> {
  try {
    const jwt = authHeader?.replace(/^Bearer\s+/i, "");
    if (!jwt) return null;
    const { data: userData } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id;
    if (!userId) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();
    const full = ((profile as any)?.full_name ?? "").trim();
    return full ? full.split(/\s+/)[0] : null;
  } catch (e) {
    console.warn("whatsapp-send: não foi possível identificar o atendente", e);
    return null;
  }
}

async function upsertContact(supabase: ReturnType<typeof createClient>, phone: string): Promise<string> {
  const { data: existing } = await supabase
    .from("whatsapp_contacts")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (existing) return (existing as any).id;

  const { data: created, error } = await supabase
    .from("whatsapp_contacts")
    .insert({ phone, status: "lead" })
    .select("id")
    .single();
  if (error) throw error;
  return (created as any).id;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { SYSTEM_PROMPT } from "./prompt.ts";

/**
 * Recebe eventos do WhatsApp Cloud API (Meta for Developers) para o número
 * da própria AuraComex — usado para prospecção e atendimento a clientes já
 * fechados. Não é dado de tenant (não tem company_id de cliente da
 * plataforma): grava em whatsapp_contacts / whatsapp_messages.
 *
 * GET: handshake de verificação do webhook (Meta chama uma vez ao salvar a
 * URL em Configuração de produção > Configurar webhooks).
 * POST: eventos de mensagem recebida e atualização de status de entrega.
 *
 * AGENTE DE IA (Gemini): quando AGENT_ENABLED=true, mensagens de texto de
 * contatos com status 'lead' (e ai_paused=false) são respondidas
 * automaticamente. Só roda se WHATSAPP_APP_SECRET estiver definido e a
 * assinatura X-Hub-Signature-256 do Meta for válida — senão qualquer um
 * poderia disparar respostas forjando um POST.
 *
 * TRIAGEM (fluxos fixos, sem IA): a mensagem do wa.me traz um marcador
 * "[origem: X]" no fim. X = "suporte" (botão Suporte do app) inicia o fluxo
 * de SUPORTE; qualquer outra origem (página de vendas) inicia o fluxo de
 * VENDAS. Cada fluxo guarda o estado em whatsapp_contacts.triage_step /
 * triage_data.flow e pausa a IA no contato. Um marcador de outro fluxo
 * reinicia a triagem no fluxo novo; sem marcador, a mensagem é tratada como
 * resposta do fluxo em andamento (30 min) ou segue o caminho normal.
 *
 * AVISOS PUSH (celular do superadmin): alertTeam() e toda mensagem fora de
 * triagem disparam Web Push para as assinaturas em push_subscriptions.
 *
 * Secrets usados:
 *   AGENT_ENABLED            "true" para ligar o agente (qualquer outro valor = desligado)
 *   GEMINI_API_KEY           chave da Gemini API (Google AI Studio)
 *   GEMINI_MODEL             opcional, padrão gemini-2.5-flash
 *   WHATSAPP_TOKEN           token permanente do System User
 *   WHATSAPP_PHONE_NUMBER_ID id do número da AuraComex
 *   WHATSAPP_APP_SECRET      App Secret do app Meta (valida a assinatura)
 *   ALERT_PHONE              opcional, número (só dígitos, com 55) que recebe os avisos
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   chaves do Web Push (sem elas, push é ignorado)
 *   VAPID_SUBJECT            opcional, padrão https://auracomex.app
 *
 * Docs: developers.facebook.com/docs/graph-api/webhooks/getting-started
 */

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

// A landing page (src/pages/Landing.tsx) e o botão Suporte embutem a origem no
// fim da mensagem pré-preenchida do wa.me, ex:
// "...quero saber mais.\n\n[origem: meta/lancamento-set]". Extraído aqui pra
// gravar em whatsapp_contacts.source e removido do corpo salvo em
// whatsapp_messages (o cliente não precisa ver esse marcador na conversa).
const ORIGEM_MARKER = /\n*\[origem: ([^\]]+)\]\s*$/;

function extractOrigem(body: string | null): { body: string | null; origem: string | null } {
  if (!body) return { body, origem: null };
  const match = body.match(ORIGEM_MARKER);
  if (!match) return { body, origem: null };
  return { body: body.slice(0, match.index).trimEnd() || null, origem: match[1] };
}

type AgentJob = { contactId: string; phone: string; messageType: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // --- Verificação do webhook (Meta faz isso uma vez ao configurar a URL) ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
      return new Response(challenge ?? "", { status: 200, headers: corsHeaders });
    }
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Corpo bruto: necessário para validar a assinatura do Meta.
    const rawBody = await req.text();

    // Se WHATSAPP_APP_SECRET estiver definido, a assinatura é obrigatória.
    const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
    let signatureValid = false;
    if (appSecret) {
      signatureValid = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret);
      if (!signatureValid) {
        console.warn("whatsapp-webhook: assinatura inválida, requisição rejeitada");
        return new Response("Invalid signature", { status: 401, headers: corsHeaders });
      }
    }

    let body: any = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
    if (!body) return jsonResponse({ received: true }, 200);

    const agentEnabled = Deno.env.get("AGENT_ENABLED") === "true";
    const agentJobs: AgentJob[] = [];

    // Formato padrão do webhook do WhatsApp Cloud API:
    // entry[].changes[].value.{messages[], statuses[], contacts[]}
    const entries = body.entry ?? [];

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // --- Mensagens recebidas de um cliente/lead ---
        for (const msg of value.messages ?? []) {
          const phone: string = msg.from; // já vem sem "+", ex: 5511900000000
          const contactName: string | undefined = value.contacts?.find(
            (c: any) => c.wa_id === phone,
          )?.profile?.name;

          const messageType: string = msg.type ?? "text";
          const rawBodyText: string | null =
            msg.text?.body ??
            msg.button?.text ??
            msg.interactive?.button_reply?.title ??
            msg.interactive?.list_reply?.title ??
            null;

          const { body: bodyText, origem } = extractOrigem(rawBodyText);

          const contactId = await upsertContact(supabase, phone, contactName, origem);

          const { error: insertError } = await supabase.from("whatsapp_messages").insert({
            contact_id: contactId,
            direction: "inbound",
            wa_message_id: msg.id,
            message_type: messageType,
            body: bodyText,
            status: "received",
            raw_payload: msg,
          });
          // wa_message_id é unique — reentrega do mesmo evento pelo Meta gera
          // violação de unicidade, que é esperado e não deve virar erro 500.
          if (insertError && insertError.code !== "23505") throw insertError;

          await supabase
            .from("whatsapp_contacts")
            .update({ last_message_at: new Date().toISOString() })
            .eq("id", contactId);

          // Reentrega duplicada: nada mais a fazer.
          if (insertError) continue;

          // Triagem fixa (suporte ou vendas): sem agente de IA enquanto durar.
          let handledByTriage = false;
          try {
            handledByTriage = await handleTriage(
              supabase,
              contactId,
              phone,
              contactName ?? null,
              origem,
              bodyText,
              messageType,
            );
          } catch (e) {
            console.error("whatsapp-triage: erro", e);
            handledByTriage = origem !== null;
          }

          // Mensagem fora de triagem: avisa o celular (início/fim de triagem já
          // avisam pelo alertTeam).
          if (!handledByTriage) {
            await sendPush(
              supabase,
              `💬 ${contactName ?? phone}`,
              (bodyText ?? `[${messageType}]`).slice(0, 140),
              `wa-${contactId}`,
            );
          }

          // Só aciona o agente em mensagem nova fora de triagem.
          if (!handledByTriage) agentJobs.push({ contactId, phone, messageType });
        }

        // --- Atualizações de status de mensagens enviadas por nós ---
        for (const status of value.statuses ?? []) {
          const { error: updateError } = await supabase
            .from("whatsapp_messages")
            .update({ status: status.status })
            .eq("wa_message_id", status.id);
          if (updateError) console.error("whatsapp-webhook: falha ao atualizar status", updateError);
        }
      }
    }

    // --- Agente de IA ---
    if (agentEnabled && agentJobs.length > 0) {
      if (!signatureValid) {
        console.error("whatsapp-webhook: AGENT_ENABLED=true mas WHATSAPP_APP_SECRET não está definido; agente não executado");
      } else {
        // Responde 200 ao Meta já e processa o agente em segundo plano.
        const work = runAgentJobs(supabase, agentJobs).catch((e) =>
          console.error("whatsapp-agent: erro inesperado", e)
        );
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
        else await work;
      }
    }

    // O Meta exige 200 rápido, senão reentrega o mesmo evento depois.
    return jsonResponse({ received: true }, 200);
  } catch (err) {
    console.error("whatsapp-webhook error", err);
    // Mesmo em erro interno, retornar 200 evita reentregas em loop pro Meta;
    // o erro já foi logado para investigação.
    return jsonResponse({ received: true, error: err instanceof Error ? err.message : "Erro interno" }, 200);
  }
});

// ---------------------------------------------------------------------------
// Triagem (fluxos fixos, sem IA)
// ---------------------------------------------------------------------------

type FlowStep = {
  key: string;
  kind: "list" | "buttons" | "text";
  text: string;
  options?: string[]; // list: até 10 (título <= 24); buttons: até 3 (título <= 20)
  label: string; // rótulo no resumo enviado à equipe
};

type Flow = {
  opening: string; // prefixo da primeira pergunta
  steps: FlowStep[];
  closing: string;
  pauseReason: string;
  startAlert: string;
  doneAlert: string;
};

const FLOWS: Record<string, Flow> = {
  suporte: {
    opening: "Olá! Recebemos sua mensagem no suporte da AuraComex e já vamos te responder por aqui. 🙂\n\nPara agilizar: ",
    steps: [
      {
        key: "categoria",
        kind: "list",
        text: "sobre o que é?",
        options: ["Cotações", "Embarques/Processo", "Financeiro", "Desembaraço", "Acesso/Senha", "Outro"],
        label: "Assunto",
      },
      {
        key: "urgencia",
        kind: "buttons",
        text: "O quanto isso está te atrapalhando?",
        options: ["Estou parado", "Atrapalha", "É só uma dúvida"],
        label: "Urgência",
      },
      {
        key: "detalhe",
        kind: "text",
        text: "Se puder, mande um print ou descreva em uma frase o que está acontecendo.",
        label: "Detalhe",
      },
    ],
    closing: "Obrigado, já te respondemos por aqui. 🙂",
    pauseReason: "suporte (botão do app)",
    startAlert: "🛟 Suporte AuraComex",
    doneAlert: "🛟 Triagem de suporte concluída",
  },
  vendas: {
    opening:
      "Olá! Que bom ter você aqui na AuraComex. 🙂 Vou te fazer 4 perguntas rápidas para a nossa equipe te atender melhor.\n\n",
    steps: [
      {
        key: "perfil",
        kind: "list",
        text: "Como você atua?",
        options: ["Agente de carga", "Importador", "Exportador", "Outro"],
        label: "Perfil",
      },
      {
        key: "volume",
        kind: "buttons",
        text: "Quantos embarques você faz por mês?",
        options: ["Até 10", "11 a 50", "Mais de 50"],
        label: "Embarques/mês",
      },
      {
        key: "controle",
        kind: "buttons",
        text: "Como você controla isso hoje?",
        options: ["Planilha", "Outro sistema", "Não controlo"],
        label: "Controle atual",
      },
      {
        key: "demo",
        kind: "buttons",
        text: "Quer uma demonstração? Qual período prefere?",
        options: ["Manhã", "Tarde", "Só dúvidas"],
        label: "Demo",
      },
    ],
    closing: "Obrigado! Nossa equipe continua a conversa por aqui e combina o melhor horário. 🙂",
    pauseReason: "pré-atendimento de vendas (fluxo fixo)",
    startAlert: "🆕 Novo lead (site)",
    doneAlert: "🆕 Lead concluiu o pré-atendimento",
  },
};

const TRIAGE_TTL_MS = 30 * 60 * 1000; // 30 min: depois disso uma nova mensagem recomeça a triagem

/**
 * Retorna true se a mensagem foi tratada por uma triagem (e portanto NÃO deve
 * ir para o agente de IA).
 */
async function handleTriage(
  supabase: ReturnType<typeof createClient>,
  contactId: string,
  phone: string,
  name: string | null,
  origem: string | null,
  bodyText: string | null,
  messageType: string,
): Promise<boolean> {
  const markerFlow = origem === null ? null : origem === "suporte" ? "suporte" : "vendas";

  const { data: row } = await supabase
    .from("whatsapp_contacts")
    .select("triage_step, triage_data")
    .eq("id", contactId)
    .maybeSingle();
  const step: string | null = (row as any)?.triage_step ?? null;
  const data: Record<string, any> = ((row as any)?.triage_data ?? {}) as Record<string, any>;
  const currentFlow: string = data.flow ?? "suporte"; // estados antigos não têm "flow"
  const flowDef = FLOWS[currentFlow];
  const startedAt = data.started_at ? Date.parse(data.started_at) : 0;
  const active =
    !!step && !!flowDef && flowDef.steps.some((s) => s.key === step) && Date.now() - startedAt < TRIAGE_TTL_MS;

  // --- Início (ou troca) de fluxo: marcador novo e nada em andamento, ou de outro fluxo ---
  if (markerFlow && (!active || markerFlow !== currentFlow)) {
    const flow = FLOWS[markerFlow];
    const first = flow.steps[0];
    await supabase
      .from("whatsapp_contacts")
      .update({
        ai_paused: true,
        ai_paused_reason: flow.pauseReason,
        triage_step: first.key,
        triage_data: { flow: markerFlow, started_at: new Date().toISOString(), origem },
      })
      .eq("id", contactId);
    await alertTeam(
      supabase,
      `${flow.startAlert}\n${name ?? "(sem nome)"} — ${phone}\n${markerFlow === "vendas" ? `Origem: ${origem}\n` : ""}${(bodyText ?? "").slice(0, 500)}`,
    );
    await sendStep(supabase, contactId, phone, first, flow.opening);
    return true;
  }

  // Fora de triagem e sem marcador: segue o caminho normal.
  if (!active) return false;

  // --- Triagem em andamento: registra a resposta e segue ---
  const answer =
    (bodyText ?? "").trim().slice(0, 300) || (messageType !== "text" ? "(anexo enviado)" : "(sem texto)");
  const idx = flowDef.steps.findIndex((s) => s.key === step);
  const answers = { ...data, flow: currentFlow, [step as string]: answer };
  const next = flowDef.steps[idx + 1];

  if (next) {
    await supabase
      .from("whatsapp_contacts")
      .update({ triage_step: next.key, triage_data: answers })
      .eq("id", contactId);
    await sendStep(supabase, contactId, phone, next, "");
    return true;
  }

  // Última pergunta respondida: fecha e avisa a equipe com o resumo.
  const final = { ...answers, finished_at: new Date().toISOString() };
  await supabase
    .from("whatsapp_contacts")
    .update({ triage_step: "done", triage_data: final, ai_paused: true, ai_paused_reason: flowDef.pauseReason })
    .eq("id", contactId);
  await sendText(supabase, contactId, phone, flowDef.closing);
  const summary = flowDef.steps.map((s) => `${s.label}: ${(final as any)[s.key] ?? "?"}`).join("\n");
  await alertTeam(supabase, `${flowDef.doneAlert}\n${name ?? "(sem nome)"} — ${phone}\n${summary}`);
  return true;
}

async function sendStep(
  supabase: ReturnType<typeof createClient>,
  contactId: string,
  phone: string,
  step: FlowStep,
  prefix: string,
): Promise<void> {
  const text = prefix + step.text;
  if (step.kind === "text" || !step.options?.length) {
    await sendText(supabase, contactId, phone, text);
    return;
  }
  const logBody = `${step.text} (${step.options.join(" / ")})`;
  if (step.kind === "list") {
    await sendInteractive(supabase, contactId, phone, {
      type: "list",
      body: { text },
      action: {
        button: "Escolher",
        sections: [{ title: "Opções", rows: step.options.map((o) => ({ id: o, title: o })) }],
      },
    }, logBody);
    return;
  }
  await sendInteractive(supabase, contactId, phone, {
    type: "button",
    body: { text },
    action: { buttons: step.options.map((o) => ({ type: "reply", reply: { id: o, title: o } })) },
  }, logBody);
}

// ---------------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------------

async function runAgentJobs(supabase: ReturnType<typeof createClient>, jobs: AgentJob[]) {
  // Uma execução por contato (se vieram várias mensagens juntas, responde uma vez
  // considerando todo o histórico).
  const seen = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.contactId)) continue;
    seen.add(job.contactId);
    try {
      await runAgent(supabase, job);
    } catch (e) {
      console.error("whatsapp-agent: falha no contato", job.contactId, e);
      await alertTeam(supabase, `⚠️ Falha do agente de IA no contato ${job.phone}. Verifique a conversa.`);
    }
  }
}

async function runAgent(supabase: ReturnType<typeof createClient>, job: AgentJob) {
  const { data: contact } = await supabase
    .from("whatsapp_contacts")
    .select("id, phone, name, status, ai_paused")
    .eq("id", job.contactId)
    .maybeSingle();
  const c = contact as any;
  // O agente só atende leads e só enquanto não foi passado para humano.
  if (!c || c.status !== "lead" || c.ai_paused) return;

  // Mensagens que não são texto (áudio, imagem, documento...): resposta fixa, sem IA.
  if (!["text", "button", "interactive"].includes(job.messageType)) {
    await sendText(supabase, c.id, c.phone, "Por aqui eu consigo ler apenas mensagens de texto. Pode me escrever o que precisa? 🙂");
    return;
  }

  // Histórico recente (mais antigas primeiro).
  const { data: rows } = await supabase
    .from("whatsapp_messages")
    .select("direction, body, message_type, created_at")
    .eq("contact_id", c.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const r of ((rows ?? []) as any[]).reverse()) {
    if (!r.body || r.message_type === "template") continue;
    const role = r.direction === "inbound" ? "user" : "model";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + r.body;
    else contents.push({ role, parts: [{ text: r.body }] });
  }
  // A conversa precisa começar e terminar com mensagem do usuário.
  while (contents.length && contents[0].role !== "user") contents.shift();
  if (!contents.length || contents[contents.length - 1].role !== "user") return;

  const ai = await callGemini(contents, c.name);

  const reply = (ai.reply ?? "").trim().slice(0, 1500);
  if (reply) await sendText(supabase, c.id, c.phone, reply);

  if (ai.handoff) {
    const reason = (ai.handoff_reason ?? "").trim() || "sem motivo informado";
    await supabase
      .from("whatsapp_contacts")
      .update({ ai_paused: true, ai_paused_reason: reason })
      .eq("id", c.id);
    await alertTeam(
      supabase,
      `🔔 Lead para atendimento humano\n${c.name ?? "(sem nome)"} — ${c.phone}\n${reason}`,
    );
  }
}

async function callGemini(
  contents: { role: string; parts: { text: string }[] }[],
  leadName?: string | null,
): Promise<{ reply: string; handoff: boolean; handoff_reason?: string }> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

  const system = SYSTEM_PROMPT + (leadName ? `\n\nNome do contato no WhatsApp: ${leadName}.` : "");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              reply: { type: "STRING" },
              handoff: { type: "BOOLEAN" },
              handoff_reason: { type: "STRING" },
            },
            required: ["reply", "handoff"],
          },
        },
      }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json?.error?.message ?? "erro"}`);

  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini não retornou texto (possível bloqueio de segurança)");
  const parsed = JSON.parse(text);
  return {
    reply: String(parsed.reply ?? ""),
    handoff: parsed.handoff === true,
    handoff_reason: parsed.handoff_reason ? String(parsed.handoff_reason) : undefined,
  };
}

// Envia texto pelo número da AuraComex e registra em whatsapp_messages.
async function sendText(
  supabase: ReturnType<typeof createClient>,
  contactId: string | null,
  phone: string,
  text: string,
): Promise<boolean> {
  return sendGraph(
    supabase,
    contactId,
    phone,
    { messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } },
    text,
    "text",
  );
}

// Mensagem interativa (lista ou botões). Texto livre/interativo só é aceito
// dentro da janela de 24h; é o caso aqui (o cliente acabou de escrever).
async function sendInteractive(
  supabase: ReturnType<typeof createClient>,
  contactId: string | null,
  phone: string,
  interactive: Record<string, unknown>,
  logBody: string,
): Promise<boolean> {
  return sendGraph(
    supabase,
    contactId,
    phone,
    { messaging_product: "whatsapp", to: phone, type: "interactive", interactive },
    logBody,
    "interactive",
  );
}

async function sendGraph(
  supabase: ReturnType<typeof createClient>,
  contactId: string | null,
  phone: string,
  payload: Record<string, unknown>,
  logBody: string,
  logType: string,
): Promise<boolean> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    console.error("whatsapp-agent: WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID não configurados");
    return false;
  }

  const graphRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const graphJson = await graphRes.json();
  if (!graphRes.ok) {
    console.error("whatsapp-agent: erro da Graph API", graphJson);
    return false;
  }

  if (contactId) {
    const { error } = await supabase.from("whatsapp_messages").insert({
      contact_id: contactId,
      direction: "outbound",
      wa_message_id: graphJson?.messages?.[0]?.id ?? null,
      message_type: logType,
      body: logBody,
      status: "sent",
      raw_payload: graphJson,
    });
    if (error) console.error("whatsapp-agent: falha ao gravar mensagem enviada", error);
    await supabase
      .from("whatsapp_contacts")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", contactId);
  }
  return true;
}

// Web Push para o(s) celular(es) do superadmin (tabela push_subscriptions).
// Sem VAPID_* configurados, não faz nada. Nunca lança erro: aviso é acessório.
async function sendPush(
  supabase: ReturnType<typeof createClient>,
  title: string,
  body: string,
  tag = "whatsapp",
): Promise<void> {
  try {
    const pub = Deno.env.get("VAPID_PUBLIC_KEY");
    const priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!pub || !priv) return;
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "https://auracomex.app", pub, priv);

    const { data: subs } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
    if (!subs?.length) return;

    const payload = JSON.stringify({ title, body, tag, url: "/admin/whatsapp" });
    await Promise.all(
      (subs as any[]).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 3600 },
          );
        } catch (e: any) {
          // 404/410 = assinatura morta (app desinstalado / permissão revogada).
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
          } else {
            console.warn("whatsapp-push: falha ao enviar", e?.statusCode ?? e);
          }
        }
      }),
    );
  } catch (e) {
    console.warn("whatsapp-push: erro", e);
  }
}

// Avisa a equipe: push no celular + WhatsApp (texto livre só chega se a janela
// de 24h do ALERT_PHONE estiver aberta — ver observação no whatsapp-send).
async function alertTeam(supabase: ReturnType<typeof createClient>, text: string) {
  const [firstLine, ...rest] = text.split("\n");
  await sendPush(supabase, firstLine, rest.join("\n").slice(0, 200), "wa-alert");

  const alertPhone = Deno.env.get("ALERT_PHONE")?.replace(/\D/g, "");
  if (!alertPhone) {
    console.warn("whatsapp-agent: ALERT_PHONE não definido; aviso apenas no log:", text);
    return;
  }
  const ok = await sendText(supabase, null, alertPhone, text);
  if (!ok) console.warn("whatsapp-agent: aviso não entregue (janela de 24h fechada?):", text);
}

async function verifySignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const expected = header.slice(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function upsertContact(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  name?: string,
  origem?: string | null,
): Promise<string> {
  const { data: existing } = await supabase
    .from("whatsapp_contacts")
    .select("id, name, source")
    .eq("phone", phone)
    .maybeSingle();

  if (existing) {
    // Atualiza o nome só se ainda não tínhamos um (perfil do WhatsApp pode
    // vir preenchido só na primeira mensagem). A origem também só é gravada
    // uma vez — mensagens seguintes do mesmo contato não têm o marcador.
    const patch: Record<string, string> = {};
    if (!((existing as any).name) && name) patch.name = name;
    if (!((existing as any).source) && origem) patch.source = origem;
    if (Object.keys(patch).length > 0) {
      await supabase.from("whatsapp_contacts").update(patch).eq("id", (existing as any).id);
    }
    return (existing as any).id;
  }

  const { data: created, error } = await supabase
    .from("whatsapp_contacts")
    .insert({ phone, name: name ?? null, status: "lead", source: origem ?? null })
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

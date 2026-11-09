import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOCS_BUCKET = "shipment-documents";

// ===== Visibilidade de campos por cliente (só usada pela TrackingV2) =====
// A página /tracking (atual, em produção) chama essa mesma função sem o
// parâmetro `field_visibility_mode` — continua recebendo todos os campos,
// sem filtro nenhum, exatamente como sempre funcionou. Só a /tracking-v2
// (parceira, ainda em avaliação) manda `field_visibility_mode: true` e passa
// a receber apenas os campos liberados em clients.tracking_field_visibility
// pra aquele cliente (default: nenhum, até a empresa configurar em
// Cadastros > Clientes > Tracking).
//
// Espelha as chaves de src/lib/trackingFieldRegistry.ts — se mudar uma
// chave lá, mudar aqui também (arquivos não compartilhados: esse roda em
// runtime Deno separado, sem bundler pra importar de src/).
const FIELD_COLUMN_MAP: Record<string, string[]> = {
  client_reference: ["client_reference"],
  invoice_number: ["invoice_number"],
  free_time: ["free_time"],
  transit_time_calc: ["etd", "eta"],
  route: ["origin_city", "origin_country", "origin_port", "destination_city", "destination_country", "destination_port", "transshipment"],
  vessel_flight: ["vessel_flight"],
  booking_number: ["booking_number"],
  bl: ["master_bl", "house_bl"],
  ce_mercante: ["ce_mercante_manifest", "ce_mercante_master", "ce_mercante_house"],
  etd: ["etd", "atd"],
  eta: ["eta", "ata"],
  incoterm: ["incoterm"],
  transport_mode: ["transport_mode"],
  courier: ["courier_provider", "courier_tracking_number"],
  customs_channel: ["customs_channel"],
  duimp_number: ["duimp_number"],
  physical_location: ["physical_location"],
  customs_registration_date: ["customs_registration_date"],
  cargo_delivered_at: ["cargo_delivered_at"],
  invoice_sent_at: ["invoice_sent_at"],
  container_numbers: ["container_number", "container_quantity"],
  container_seals: ["container_seals"],
  container_terminal_entry: ["container_terminal_entry_dates"],
  container_return: ["container_return_dates"],
  demurrage_deadline_calc: ["container_terminal_entry_dates", "container_demurrage_deadlines", "container_return_dates", "free_time", "ata", "demurrage_deadline"],
  storage_deadline_calc: ["container_terminal_entry_dates", "storage_deadline"],
  next_update: ["next_update"],
  shipper_name: ["shipper_id"],
  carrier: ["carrier"],
};

// Campos de "Resumo da Carga" vêm de quote_items (não de shipments), ligada
// pelo quotes.shipment_id — um embarque pode ter mais de um item de carga.
// `notes` (observações) de quote_items propositalmente NÃO está aqui: é
// texto livre de uso interno, nunca exposto ao portal do cliente.
const CARGO_FIELD_COLUMN_MAP: Record<string, string[]> = {
  cargo_container_type: ["container_type", "container_qty"],
  cargo_weight: ["weight_kg"],
  cargo_volume: ["volume_cbm"],
  cargo_chargeable_weight: ["chargeable_weight"],
  cargo_dimensions: ["length_cm", "width_cm", "height_cm"],
  cargo_packages: ["packages"],
  cargo_commodity: ["commodity"],
  cargo_dangerous_goods: ["dangerous_goods"],
  cargo_vehicle_type: ["vehicle_type"],
  cargo_ncm: ["ncm_code"],
  cargo_value: ["cargo_value", "cargo_value_currency"],
};

// Sempre incluídos quando field_visibility_mode está ativo — o app quebra
// sem eles (identidade da linha, categoria do status, ícone do modal).
const FIELD_VISIBILITY_BASELINE_COLUMNS = ["id", "reference_number", "status", "company_id", "created_at"];

// ===== Fase 3 — Documentos (4 PDFs) + Numerário =====
// Em vez de expor campos crus de Taxas/Estimativa, essa fase só libera PDFs
// já gerados no processo (marcados com custom_category ao serem salvos —
// QuotePdfPreviewDialog.tsx, EstimatePdfDialog.tsx nos dois modos,
// AccountabilityPdfDialog.tsx) e o total do Numerário (cost_estimates.
// numerario_total_usd, persistido em CostEstimateTab.tsx ao salvar a aba
// Estimativa). Espelha TRACKING_DOC_CATEGORY_MAP de trackingFieldRegistry.ts.
const DOC_CATEGORY_MAP: Record<string, string> = {
  doc_quote_pdf: "tracking:quote_pdf",
  doc_estimate_pdf: "tracking:estimate_pdf",
  doc_numerario_pdf: "tracking:numerario_pdf",
  doc_accountability_pdf: "tracking:accountability_pdf",
};

/** Extrai o path do storage de uma URL pública/assinada antiga ou de um path cru. */
function extractDocPath(fileUrlOrPath: string | null | undefined): string {
  if (!fileUrlOrPath) return "";
  const value = String(fileUrlOrPath);
  for (const marker of [
    `/object/public/${DOCS_BUCKET}/`,
    `/object/sign/${DOCS_BUCKET}/`,
    `/${DOCS_BUCKET}/`,
  ]) {
    const i = value.indexOf(marker);
    if (i !== -1) return decodeURIComponent(value.slice(i + marker.length).split("?")[0]);
  }
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const { action, tax_id, pin, client_id, filter, shipment_ids, quote_ids, field_visibility_mode } = body as any;

    // Step 1: Lookup client by tax_id
    if (action === "lookup") {
      if (!tax_id || typeof tax_id !== "string") {
        return jsonResponse({ error: "tax_id is required" }, 400);
      }

      const cleanTaxId = tax_id.replace(/\D/g, "");
      if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
        return jsonResponse({ error: "Invalid tax_id (CPF ou CNPJ)" }, 400);
      }

      const { data: client, error } = await adminClient
        .from("clients")
        .select("id, name, company_id, tax_id")
        .eq("tax_id", cleanTaxId)
        .single();

      if (error || !client) {
        return jsonResponse({ error: "Client not found" }, 404);
      }

      // Only return minimal info - no PII
      return jsonResponse({ client_id: client.id, name: client.name, company_id: client.company_id });
    }

    // Step 2: Authenticate with PIN (first 4 digits of CNPJ)
    if (action === "auth") {
      if (!client_id || !pin) {
        return jsonResponse({ error: "client_id and pin are required" }, 400);
      }

      const { data: client } = await adminClient
        .from("clients")
        .select("tax_id")
        .eq("id", client_id)
        .single();

      if (!client) {
        return jsonResponse({ error: "Client not found" }, 404);
      }

      const expectedPin = (client.tax_id || "").replace(/\D/g, "").slice(-4);
      if (pin !== expectedPin) {
        return jsonResponse({ error: "Invalid PIN" }, 401);
      }

      // Return company info (minimal fields only)
      const { data: clientFull } = await adminClient
        .from("clients")
        .select("company_id, tracking_field_visibility")
        .eq("id", client_id)
        .single();

      const { data: company } = await adminClient
        .from("companies")
        .select("id, name, logo_url")
        .eq("id", clientFull!.company_id)
        .single();

      // field_visibility só é relevante pra TrackingV2 (que sabe ler e usar
      // isso) — a página atual ignora esse campo extra na resposta, sem
      // efeito nela.
      const fieldVisibility = (clientFull as any)?.tracking_field_visibility || { collapsed: [], expanded: [] };

      return jsonResponse({ authenticated: true, company, field_visibility: fieldVisibility });
    }

    // Step 3: Get tracking data (requires valid client_id)
    if (action === "shipments") {
      if (!client_id || !filter) {
        return jsonResponse({ error: "client_id and filter required" }, 400);
      }

      // O status do embarque não é mais um enum fixo — a empresa cadastra
      // status personalizados em Logística > Gerenciar Status (ex.:
      // "financeiro", "lançar_di", "aguard._nacionalização"). Uma lista fixa
      // de status "ativos" fazia qualquer status personalizado sumir do
      // tracking do cliente, em qualquer aba. Agora "Finalizado" é só o que
      // realmente terminou (arrived/delivered); "Em Andamento" é tudo que
      // não é finalizado, rascunho ou cancelado — cobre qualquer status
      // personalizado que a empresa venha a criar.
      //
      // "Finalizado" também inclui qualquer status (fixo ou personalizado)
      // cuja categoria cadastrada em Gerenciar Status seja "delivered" —
      // ex.: "finalizado", "prestação_de_contas", "processo_endossado".
      // Sem isso, esses processos ficavam presos em "Em Andamento".
      const { data: clientCompany } = await adminClient
        .from("clients")
        .select("company_id")
        .eq("id", client_id)
        .single();
      let deliveredStatuses: string[] = [];
      if (clientCompany?.company_id) {
        const { data: deliveredOpts } = await adminClient
          .from("shipment_status_options")
          .select("value")
          .eq("company_id", clientCompany.company_id)
          .eq("category", "delivered");
        deliveredStatuses = (deliveredOpts || []).map((o: any) => o.value).filter(Boolean);
      }
      const finishedStatuses = [...new Set(["arrived", "delivered", ...deliveredStatuses])];
      const excludedFromActive = [...finishedStatuses, "draft", "cancelled"];
      const excludedList = excludedFromActive.map((v) => `"${String(v).replace(/"/g, "")}"`).join(",");

      let query = adminClient
        .from("shipments")
        .select("id, reference_number, status, transport_mode, incoterm, origin_city, origin_country, origin_port, transshipment, destination_city, destination_country, destination_port, etd, eta, atd, ata, carrier, vessel_flight, booking_number, master_bl, house_bl, container_number, container_seals, container_demurrage_deadlines, container_terminal_entry_dates, container_return_dates, next_update, courier_provider, courier_tracking_number, company_id, customs_channel, duimp_number, physical_location, customs_registration_date, terminal_entry_date, demurrage_deadline, storage_deadline, cargo_delivered_at, invoice_sent_at, client_reference, invoice_number, container_quantity, free_time, shipper_id")
        .eq("client_id", client_id);

      query = filter === "active"
        ? query.not("status", "in", `(${excludedList})`)
        : query.in("status", finishedStatuses);

      const { data: shipmentsData } = await query.order("created_at", { ascending: false });
      const shipments = shipmentsData || [];

      // Categoria de cada status (fixo ou personalizado) da empresa — orienta
      // a linha do tempo genérica de 5 marcos no front (Reservado/Origem/
      // Trânsito/Desembaraço/Entregue), já que não dá mais pra assumir uma
      // lista fixa de status.
      const companyId = shipments[0]?.company_id;
      let statusOptions: any[] = [];
      if (companyId) {
        const { data: opts } = await adminClient
          .from("shipment_status_options")
          .select("value, label, category")
          .eq("company_id", companyId)
          .order("position");
        statusOptions = opts || [];
      }

      // Referência do cliente agora também é gravada direto no embarque
      // (shipments.client_reference), espelhada da cotação de origem. Pra
      // embarques antigos que nunca passaram pela aba Logística depois desse
      // espelho existir, cai de volta pro valor da cotação (quotes.client_reference).
      const shipmentIds = shipments.map((s: any) => s.id);
      const refMap = new Map<string, string>();
      if (shipmentIds.length > 0) {
        const { data: qs } = await adminClient
          .from("quotes")
          .select("shipment_id, client_reference")
          .in("shipment_id", shipmentIds);
        for (const q of qs || []) {
          if (q.shipment_id && q.client_reference) refMap.set(q.shipment_id, q.client_reference);
        }
      }

      // Transbordo é salvo só como código de porto — resolve o nome pra
      // exibição em lote pelos códigos usados.
      const transshipCodes = [...new Set(shipments.map((s: any) => s.transshipment).filter(Boolean))];
      const portMap = new Map<string, { code: string; name: string; city: string | null; country_code: string }>();
      if (transshipCodes.length > 0) {
        const { data: ports } = await adminClient
          .from("ports")
          .select("code, name, city, country_code")
          .in("code", transshipCodes);
        for (const p of ports || []) portMap.set(p.code, p);
      }

      // Shipper (exportador/embarcador) é uma empresa cadastrada em "clients"
      // (mesma tabela usada pra parceiros do processo), referenciada por
      // shipments.shipper_id — resolve o nome em lote pros embarques que têm.
      const shipperIds = [...new Set(shipments.map((s: any) => s.shipper_id).filter(Boolean))];
      const shipperMap = new Map<string, string>();
      if (shipperIds.length > 0) {
        const { data: shippers } = await adminClient
          .from("clients")
          .select("id, name")
          .in("id", shipperIds);
        for (const sh of shippers || []) shipperMap.set(sh.id, sh.name);
      }

      let enrichedShipments = shipments.map((s: any) => ({
        ...s,
        client_reference: s.client_reference || refMap.get(s.id) || null,
        transshipment_info: s.transshipment ? (portMap.get(s.transshipment) || { code: s.transshipment, name: s.transshipment, city: null, country_code: "" }) : null,
        shipper_name: s.shipper_id ? (shipperMap.get(s.shipper_id) || null) : null,
      }));

      // Filtra os campos pelo que esse cliente pode ver — só quando o
      // chamador manda field_visibility_mode (só a TrackingV2 manda; a
      // página atual não manda e continua recebendo tudo, sem filtro).
      // Também devolve a visibilidade atual na resposta (field_visibility)
      // pra TrackingV2 manter a sessão do navegador do cliente sempre em
      // dia, sem precisar deslogar/logar de novo toda vez que a empresa
      // mexe na configuração em Cadastros.
      let fieldVisibilityOut: any = undefined;
      if (field_visibility_mode) {
        const { data: clientRow } = await adminClient
          .from("clients")
          .select("tracking_field_visibility")
          .eq("id", client_id)
          .single();
        const visibility = (clientRow as any)?.tracking_field_visibility || { collapsed: [], expanded: [] };
        fieldVisibilityOut = visibility;
        const allowedKeys = new Set<string>([...(visibility.collapsed || []), ...(visibility.expanded || [])]);
        const allowedColumns = new Set<string>(FIELD_VISIBILITY_BASELINE_COLUMNS);
        for (const key of allowedKeys) {
          for (const col of FIELD_COLUMN_MAP[key] || []) allowedColumns.add(col);
        }
        // Campos derivados (não são coluna crua) — inclui só se a coluna
        // "fonte" correspondente também estiver liberada.
        const includeTransshipmentInfo = allowedColumns.has("transshipment");
        const includeShipperName = allowedKeys.has("shipper_name");
        const includeClientReference = allowedColumns.has("client_reference");

        enrichedShipments = enrichedShipments.map((s: any) => {
          const picked: any = {};
          for (const col of allowedColumns) picked[col] = s[col];
          if (includeTransshipmentInfo) picked.transshipment_info = s.transshipment_info;
          if (includeShipperName) picked.shipper_name = s.shipper_name;
          if (includeClientReference) picked.client_reference = s.client_reference;
          return picked;
        });
      }

      // Resumo da Carga (quote_items) — só busca se algum campo desse grupo
      // estiver liberado pra esse cliente (evita consulta desnecessária).
      if (field_visibility_mode && fieldVisibilityOut) {
        const allowedCargoKeys = new Set<string>(
          [...(fieldVisibilityOut.collapsed || []), ...(fieldVisibilityOut.expanded || [])]
            .filter((k: string) => k in CARGO_FIELD_COLUMN_MAP),
        );
        if (allowedCargoKeys.size > 0 && shipmentIds.length > 0) {
          const allowedCargoColumns = new Set<string>();
          for (const key of allowedCargoKeys) {
            for (const col of CARGO_FIELD_COLUMN_MAP[key] || []) allowedCargoColumns.add(col);
          }

          const { data: quotesForCargo } = await adminClient
            .from("quotes")
            .select("id, shipment_id")
            .in("shipment_id", shipmentIds);

          const quoteIdToShipmentId = new Map<string, string>();
          for (const q of quotesForCargo || []) {
            if (q.id && q.shipment_id) quoteIdToShipmentId.set(q.id, q.shipment_id);
          }
          const cargoQuoteIds = [...quoteIdToShipmentId.keys()];

          if (cargoQuoteIds.length > 0) {
            const { data: cargoItemsData } = await adminClient
              .from("quote_items")
              .select(["id", "quote_id", ...allowedCargoColumns].join(", "))
              .in("quote_id", cargoQuoteIds);

            const cargoItemsByShipment = new Map<string, any[]>();
            for (const item of (cargoItemsData || []) as any[]) {
              const shipmentIdForItem = quoteIdToShipmentId.get(item.quote_id);
              if (!shipmentIdForItem) continue;
              const { quote_id, ...rest } = item;
              const list = cargoItemsByShipment.get(shipmentIdForItem) || [];
              list.push(rest);
              cargoItemsByShipment.set(shipmentIdForItem, list);
            }

            enrichedShipments = enrichedShipments.map((s: any) => ({
              ...s,
              cargo_items: cargoItemsByShipment.get(s.id) || [],
            }));
          }
        }
      }

      // Numerário total (fase 3) — só busca se o campo estiver liberado
      // pra esse cliente.
      if (field_visibility_mode && fieldVisibilityOut) {
        const allowedKeysForNumerario = new Set<string>([...(fieldVisibilityOut.collapsed || []), ...(fieldVisibilityOut.expanded || [])]);
        if (allowedKeysForNumerario.has("numerario_total") && shipmentIds.length > 0) {
          const { data: quotesForNumerario } = await adminClient
            .from("quotes")
            .select("id, shipment_id")
            .in("shipment_id", shipmentIds);

          const quoteIdToShipmentIdForNumerario = new Map<string, string>();
          for (const q of quotesForNumerario || []) {
            if (q.id && q.shipment_id) quoteIdToShipmentIdForNumerario.set(q.id, q.shipment_id);
          }
          const numerarioQuoteIds = [...quoteIdToShipmentIdForNumerario.keys()];

          if (numerarioQuoteIds.length > 0) {
            const { data: estimatesData } = await adminClient
              .from("cost_estimates")
              .select("quote_id, numerario_total_usd, numerario_total_brl")
              .in("quote_id", numerarioQuoteIds);

            const numerarioByShipment = new Map<string, { usd: number; brl: number }>();
            for (const est of (estimatesData || []) as any[]) {
              const shipmentIdForEst = quoteIdToShipmentIdForNumerario.get(est.quote_id);
              if (!shipmentIdForEst) continue;
              numerarioByShipment.set(shipmentIdForEst, {
                usd: Number(est.numerario_total_usd) || 0,
                brl: Number(est.numerario_total_brl) || 0,
              });
            }

            enrichedShipments = enrichedShipments.map((s: any) => {
              const numerario = numerarioByShipment.get(s.id);
              return {
                ...s,
                numerario_total_usd: numerario ? numerario.usd : null,
                numerario_total_brl: numerario ? numerario.brl : null,
              };
            });
          }
        }
      }

      return jsonResponse({ shipments: enrichedShipments, status_options: statusOptions, field_visibility: fieldVisibilityOut });
    }

    if (action === "quotes") {
      if (!client_id) {
        return jsonResponse({ error: "client_id required" }, 400);
      }

      const { data } = await adminClient
        .from("quotes")
        .select("id, quote_number, status, transport_mode, origin, destination, valid_until, created_at")
        .eq("client_id", client_id)
        .neq("status", "converted")
        .order("created_at", { ascending: false });

      return jsonResponse({ quotes: data || [] });
    }

    // Diário do processo — só as entradas marcadas como visíveis no
    // tracking (visible_tracking = true), mesmo padrão de "documents".
    if (action === "events") {
      if (!shipment_ids || shipment_ids.length === 0) {
        return jsonResponse({ events: [] });
      }

      const { data } = await adminClient
        .from("shipment_events")
        .select("id, shipment_id, event_date, category, note")
        .in("shipment_id", shipment_ids)
        .eq("visible_tracking", true)
        .order("event_date", { ascending: false });

      return jsonResponse({ events: data || [] });
    }

    if (action === "documents") {
      let docs: any[] = [];
      if (shipment_ids && shipment_ids.length > 0) {
        // Também inclui documentos da cotação que originou cada embarque
        // (docs anexados na fase de cotação ficam com quote_id e shipment_id nulo).
        const { data: linkedQuotes } = await adminClient
          .from("quotes")
          .select("id, shipment_id")
          .in("shipment_id", shipment_ids);

        const quoteToShipment = new Map<string, string>();
        for (const q of linkedQuotes || []) {
          if (q.id && q.shipment_id) quoteToShipment.set(q.id, q.shipment_id);
        }
        const linkedQuoteIds = [...quoteToShipment.keys()];

        const orParts = [`shipment_id.in.(${shipment_ids.join(",")})`];
        if (linkedQuoteIds.length > 0) {
          orParts.push(`quote_id.in.(${linkedQuoteIds.join(",")})`);
        }

        const { data } = await adminClient
          .from("documents")
          .select("id, name, file_url, shipment_id, quote_id, document_type, custom_category")
          .or(orParts.join(","))
          .eq("visible_tracking", true);

        // Normaliza: doc de cotação recebe o shipment_id do embarque (pro front agrupar)
        docs = (data || []).map((d: any) => ({
          ...d,
          shipment_id: d.shipment_id || (d.quote_id ? quoteToShipment.get(d.quote_id) : null),
        }));
      } else if (quote_ids && quote_ids.length > 0) {
        const { data } = await adminClient
          .from("documents")
          .select("id, name, file_url, shipment_id, quote_id, document_type, custom_category")
          .in("quote_id", quote_ids)
          .eq("visible_tracking", true);
        docs = data || [];
      }

      // Filtra os 4 PDFs marcados com custom_category (fase 3) pelo que esse
      // cliente pode ver — só quando field_visibility_mode + client_id vêm
      // na requisição (só a TrackingV2 manda; a página atual não filtra).
      // Qualquer outro documento (custom_category nulo ou diferente desses 4
      // sentinelas) continua valendo só a regra de sempre: visible_tracking.
      if (field_visibility_mode && client_id) {
        const { data: clientRowForDocs } = await adminClient
          .from("clients")
          .select("tracking_field_visibility")
          .eq("id", client_id)
          .single();
        const visibilityForDocs = (clientRowForDocs as any)?.tracking_field_visibility || { collapsed: [], expanded: [] };
        const allowedKeysForDocs = new Set<string>([...(visibilityForDocs.collapsed || []), ...(visibilityForDocs.expanded || [])]);
        const allowedDocCategories = new Set<string>(
          Object.entries(DOC_CATEGORY_MAP).filter(([key]) => allowedKeysForDocs.has(key)).map(([, cat]) => cat),
        );
        const sentinelCategories = new Set<string>(Object.values(DOC_CATEGORY_MAP));
        docs = docs.filter((d: any) => !sentinelCategories.has(d.custom_category) || allowedDocCategories.has(d.custom_category));
      }

      // Gera URLs assinadas (bucket privado). Cliente já validado por CNPJ+PIN.
      const signed = await Promise.all(
        docs.map(async (d) => {
          const path = extractDocPath(d.file_url);
          if (!path) return d;
          const { data: s } = await adminClient.storage
            .from("shipment-documents")
            .createSignedUrl(path, 60 * 60);
          return { ...d, file_url: s?.signedUrl || d.file_url };
        }),
      );

      return jsonResponse({ documents: signed });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (err) {
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

import https from 'node:https';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Cobrança das assinaturas do Aura por boleto/Pix na conta C6 da Kenaro (API "Boleto com Liquidação via Barra ou Pix").
 *
 * Roda como função serverless Node.js no Vercel (não no Supabase Edge/Deno): a API do C6 exige mTLS — certificado
 * cliente na conexão — e o Deno Deploy não consegue apresentá-lo (mesmo motivo do Portal Único, ver api/portalunico).
 * Tudo está neste arquivo único de propósito (sem módulo compartilhado ao lado): um arquivo "_lib.ts" compartilhado já
 * quebrou as rotas do Portal Único em produção.
 *
 * Duas portas de entrada, ambas POST em /api/c6:
 *  - Ações administrativas (Authorization: Bearer <login do Supabase>), corpo { action, ... }:
 *      test_auth | create | issue | sync | cancel | register_webhook
 *    Só quem é superadmin E está na lista C6_ALLOWED_EMAILS. (O papel superadmin sozinho não basta: a tabela user_roles
 *    de produção ainda não está endurecida, e emitir cobrança em nome da Kenaro é ação financeira.)
 *  - Notificação do C6 (/api/c6?webhook=<C6_WEBHOOK_TOKEN>): as notificações não têm assinatura, então o token na URL
 *    só filtra ruído e o conteúdo é tratado como GATILHO — o estado real do boleto é sempre reconsultado na API do C6.
 *
 * Variáveis de ambiente (segredos no Vercel, NUNCA em tabela nem no repositório):
 *   C6_ENV                 'sandbox' (padrão) | 'production'
 *   C6_CLIENT_ID, C6_CLIENT_SECRET
 *   C6_CERT_PEM, C6_KEY_PEM  conteúdo dos arquivos .crt/.key do C6 (PEM puro ou em base64)
 *   C6_PIX_KEY             chave Pix aleatória (EVP) da conta, que vai junto no boleto
 *   C6_WEBHOOK_TOKEN       texto aleatório longo que vai na URL do webhook
 *   C6_ALLOWED_EMAILS      e-mails (separados por vírgula) autorizados a emitir
 *   SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL ou VITE_SUPABASE_URL)
 */

const HOSTS = {
  sandbox: 'baas-api-sandbox.c6bank.info',
  production: 'baas-api.c6bank.info',
} as const;
// Carteira de cobrança: produção 15, sandbox 21 (documentação do C6).
const BILLING_SCHEME = { sandbox: '21', production: '15' } as const;

export type C6Env = keyof typeof HOSTS;

export interface Payer {
  name: string;
  tax_id: string;
  email?: string | null;
  address: { address: string; neighborhood: string; city: string; state: string; zip_code: string };
}

export interface BoletoRow {
  external_reference_id: string;
  description: string;
  amount: number | string;
  due_date: string; // YYYY-MM-DD
  payer: Payer;
  instructions?: string[] | null;
  notify_email?: boolean | null;
}

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Hoje no fuso de Brasília, YYYY-MM-DD (o vencimento não pode ser anterior a hoje). */
export function todayBR(now = new Date()): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

/** 26 caracteres A-Z0-9, o formato exigido pelo C6 para external_reference_id. */
export function newExternalReferenceId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(26);
  let out = '';
  for (let i = 0; i < 26; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Valida e normaliza os dados de uma cobrança. Devolve a lista de problemas (vazia = ok) e o pagador limpo. */
export function validateBoletoInput(input: {
  amount: unknown;
  due_date: unknown;
  description: unknown;
  payer: any;
}, today = todayBR()): { errors: string[]; amount: number; payer: Payer; description: string; due_date: string } {
  const errors: string[] = [];
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 5_000_000) errors.push('Valor deve ser maior que zero e no máximo R$ 5.000.000,00.');

  const due_date = String(input.due_date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) errors.push('Vencimento deve estar no formato AAAA-MM-DD.');
  else if (due_date < today) errors.push('Vencimento não pode ser anterior a hoje.');

  const description = String(input.description ?? '').trim();
  if (!description || description.length > 100) errors.push('Descrição é obrigatória e tem no máximo 100 caracteres.');

  const p = input.payer || {};
  const a = p.address || {};
  const tax_id = onlyDigits(p.tax_id);
  const name = String(p.name ?? '').trim();
  const payer: Payer = {
    name,
    tax_id,
    email: p.email ? String(p.email).trim() : null,
    address: {
      address: String(a.address ?? '').trim(),
      neighborhood: String(a.neighborhood ?? '').trim(),
      city: String(a.city ?? '').trim(),
      state: String(a.state ?? '').trim().toUpperCase(),
      zip_code: onlyDigits(a.zip_code),
    },
  };
  if (!name || name.length > 40) errors.push('Nome de quem paga é obrigatório e tem no máximo 40 caracteres (limite do C6).');
  if (!(tax_id.length === 11 || tax_id.length === 14)) errors.push('CPF/CNPJ de quem paga deve ter 11 ou 14 dígitos.');
  if (payer.email && (payer.email.length > 70 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payer.email))) errors.push('E-mail de quem paga é inválido (máx. 70 caracteres).');
  for (const [k, label] of [['address', 'Logradouro'], ['neighborhood', 'Bairro'], ['city', 'Cidade']] as const) {
    const v = payer.address[k];
    if (!v || v.length > 40) errors.push(`${label} é obrigatório e tem no máximo 40 caracteres.`);
  }
  if (!/^[A-Z]{2}$/.test(payer.address.state)) errors.push('UF deve ter 2 letras.');
  if (payer.address.zip_code.length !== 8) errors.push('CEP deve ter 8 dígitos.');
  return { errors, amount, payer, description, due_date };
}

/** Corpo do POST /v2/bank_slips. Multa/juros/desconto ficam de fora até serem validados no sandbox. */
export function buildBankSlipPayload(row: BoletoRow, env: C6Env, pixKey: string) {
  const payer = row.payer;
  const body: any = {
    external_reference_id: row.external_reference_id,
    amount: Math.round(Number(row.amount) * 100) / 100,
    due_date: row.due_date,
    description: row.description,
    payer: {
      name: payer.name,
      tax_id: onlyDigits(payer.tax_id),
      ...(payer.email ? { email: payer.email } : {}),
      address: payer.address,
    },
    payment_method: {
      bank_slip: {
        billing_scheme: BILLING_SCHEME[env],
        ...(row.instructions && row.instructions.length ? { instructions: row.instructions.slice(0, 4).map((s) => s.slice(0, 80)) } : {}),
      },
      pix: { type: 'EVP', key: pixKey },
    },
    origin: 'AURACOMEX',
  };
  if (row.notify_email && payer.email) {
    body.payer_notification = (['ISSUE_DATE', 'BEFORE_DUE_DATE', 'DUE_DATE'] as const).map((when) => ({
      channel: 'EMAIL',
      destination: payer.email,
      notification_date: when,
    }));
  }
  return body;
}

const STATUS_MAP: Record<string, string> = {
  CREATED: 'created',
  PAID: 'paid',
  CANCELED: 'canceled',
  CANCELLED: 'canceled',
  WAITING_CONFIRMATION: 'waiting_confirmation',
};

/** Traduz a resposta (GET/POST) do C6 nas colunas da nossa tabela. */
export function mapC6Response(r: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const status = STATUS_MAP[String(r?.status || '').toUpperCase()];
  if (status) out.status = status;
  else if (r?.payment_method) out.status = 'created'; // resposta de emissão não traz status
  if (r?.id) out.c6_id = String(r.id);
  const bs = r?.payment_method?.bank_slip;
  if (bs?.digitable_line) out.digitable_line = bs.digitable_line;
  if (bs?.bar_code) out.bar_code = bs.bar_code;
  if (bs?.our_number) out.our_number = bs.our_number;
  const qr = r?.payment_method?.pix?.qr_code;
  if (qr) out.pix_qr_code = qr;
  const pay = Array.isArray(r?.payments) && r.payments.length ? r.payments[0] : null;
  if (pay) {
    out.paid_amount = Number(pay.amount);
    out.payment_type = pay.payment_type;
    if (pay.payment_date) out.paid_at = new Date(`${pay.payment_date}T12:00:00-03:00`).toISOString();
  }
  return out;
}

/**
 * Aceita o PEM colado do jeito que costuma chegar na Vercel: com aspas, com texto antes/depois, com "\n" literal,
 * com quebras CRLF ou com as linhas coladas em uma só (espaço no lugar da quebra). Também aceita o PEM em base64.
 * Devolve sempre um bloco PEM válido (corpo em linhas de 64 caracteres) ou null.
 */
export function pem(value: string | undefined, kind?: 'cert' | 'key'): string | null {
  if (!value) return null;
  // Corpo em base64 SEM as linhas BEGIN/END (acontece quando o arquivo é colado sem o cabeçalho): põe o cabeçalho.
  const headerless = (text: string): string | null => {
    const body = text.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
    if (!kind || !body || !/^[A-Za-z0-9+/]+=*$/.test(body)) return null;
    const der = Buffer.from(body, 'base64');
    if (der.length < 64 || der[0] !== 0x30) return null; // DER sempre começa com SEQUENCE
    const wrap = (label: string) => `-----BEGIN ${label}-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;
    if (kind === 'cert') return wrap('CERTIFICATE');
    for (const label of ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY']) {
      const candidate = wrap(label);
      try { crypto.createPrivateKey(candidate); return candidate; } catch { /* tenta o próximo formato */ }
    }
    return null;
  };
  const extract = (text: string): string | null => {
    const m = text.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]+?)-----END \1-----/);
    if (!m) return null;
    const body = m[2].replace(/\s+/g, '');
    if (!body) return null;
    return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END ${m[1]}-----\n`;
  };
  const v = value.trim().replace(/\\n/g, '\n');
  const direct = extract(v);
  if (direct) return direct;
  const semCabecalho = headerless(v);
  if (semCabecalho) return semCabecalho;
  try {
    return extract(Buffer.from(v.replace(/\s+/g, ''), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/** Descreve só o FORMATO do que veio na variável (tamanho, linhas, marcadores), nunca um trecho do conteúdo. */
export function describePem(value: string | undefined): string {
  if (value === undefined) return 'não existe neste ambiente';
  const v = value.trim();
  if (!v) return 'vazia';
  const lines = v.split(/\r?\n/).length;
  const begin = /-----BEGIN [A-Z0-9 ]+-----/.test(v);
  const end = /-----END [A-Z0-9 ]+-----/.test(v);
  const onlyB64 = /^[A-Za-z0-9+/=\s]+$/.test(v);
  const parts = [`${v.length} caracteres`, `${lines} linha(s)`, begin ? 'tem BEGIN' : 'sem BEGIN', end ? 'tem END' : 'sem END'];
  if (!begin && onlyB64) parts.push('só base64, sem cabeçalho');
  if (/^["']/.test(v)) parts.push('começa com aspas');
  return parts.join(', ');
}

interface C6Config {
  env: C6Env;
  host: string;
  clientId: string;
  clientSecret: string;
  cert: string;
  key: string;
  pixKey: string;
}

function loadConfig(): { cfg: C6Config } | { error: string } {
  const env = (process.env.C6_ENV || 'sandbox') as C6Env;
  if (env !== 'sandbox' && env !== 'production') return { error: 'C6_ENV deve ser "sandbox" ou "production".' };
  const clientId = process.env.C6_CLIENT_ID;
  const clientSecret = process.env.C6_CLIENT_SECRET;
  const cert = pem(process.env.C6_CERT_PEM, 'cert');
  const key = pem(process.env.C6_KEY_PEM, 'key');
  const pixKey = process.env.C6_PIX_KEY;
  const missing = [
    !clientId && 'C6_CLIENT_ID', !clientSecret && 'C6_CLIENT_SECRET', !cert && `C6_CERT_PEM [${describePem(process.env.C6_CERT_PEM)}]`,
    !key && `C6_KEY_PEM [${describePem(process.env.C6_KEY_PEM)}]`, !pixKey && 'C6_PIX_KEY',
  ].filter(Boolean);
  if (missing.length) return { error: `Integração com o C6 não configurada (faltam variáveis: ${missing.join(', ')}).` };
  return { cfg: { env, host: HOSTS[env], clientId: clientId!, clientSecret: clientSecret!, cert: cert!, key: key!, pixKey: pixKey! } };
}

function c6Request(
  cfg: C6Config,
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; form?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = opts.form ? new URLSearchParams(opts.form).toString() : opts.json !== undefined ? JSON.stringify(opts.json) : null;
    const headers: Record<string, string> = { 'partner-software-name': 'AuraComex', 'partner-software-version': '1.0' };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (payload !== null) {
      headers['Content-Type'] = opts.form ? 'application/x-www-form-urlencoded' : 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = https.request(
      { hostname: cfg.host, path, method, cert: cfg.cert, key: cfg.key, headers, timeout: 20000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: any = raw;
          try { body = raw ? JSON.parse(raw) : null; } catch { /* corpo não-JSON: devolve texto */ }
          resolve({ status: res.statusCode || 0, body });
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('Tempo esgotado ao falar com o C6.')); });
    req.on('error', (e) => reject(e));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function getToken(cfg: C6Config): Promise<string> {
  const r = await c6Request(cfg, 'POST', '/v1/auth/', {
    form: { client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' },
  });
  const token = r.body?.access_token;
  if (r.status !== 200 || !token) throw new Error(`Falha ao autenticar no C6 (HTTP ${r.status}).`);
  return token;
}

const errText = (body: any) => {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  return String(body.message || body.detail || body.error || JSON.stringify(body)).slice(0, 300);
};

async function authorizeAdmin(supabase: any, req: any): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const header = String(req.headers?.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Não autenticado.' };
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user?.id) return { ok: false, status: 401, error: 'Sessão inválida.' };
  const allowed = String(process.env.C6_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length || !allowed.includes(String(user.email || '').toLowerCase())) {
    return { ok: false, status: 403, error: 'Sem permissão para operar cobranças do C6.' };
  }
  const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
  if (!(roles || []).some((r: any) => r.role === 'superadmin')) return { ok: false, status: 403, error: 'Apenas superadmin.' };
  return { ok: true, userId: user.id };
}

async function loadBoleto(supabase: any, id: string) {
  const { data, error } = await supabase.from('company_boletos').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveFromC6(supabase: any, id: string, r: any, extra: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const patch: Record<string, any> = { ...mapC6Response(r), ...extra, last_error: null, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('company_boletos').update(patch).eq('id', id);
  if (error) throw error;
  return patch;
}

async function issue(supabase: any, cfg: C6Config, id: string) {
  const row = await loadBoleto(supabase, id);
  if (!row) return { status: 404, body: { success: false, error: 'Cobrança não encontrada.' } };
  if (row.environment !== cfg.env) {
    return { status: 409, body: { success: false, error: `Cobrança criada para ${row.environment}, mas o servidor está em ${cfg.env}.` } };
  }
  if (!['draft', 'failed', 'issuing'].includes(row.status)) {
    return { status: 409, body: { success: false, error: `Cobrança já está "${row.status}".` } };
  }
  const check = validateBoletoInput(row);
  if (check.errors.length) return { status: 422, body: { success: false, error: check.errors.join(' ') } };

  // Trava contra emissão dupla: só um chamador consegue sair de draft/failed para issuing. Se estava "issuing" (uma
  // tentativa anterior caiu sem resposta), primeiro consulta no C6 se aquela emissão chegou a acontecer.
  if (row.status !== 'issuing') {
    const { data: claimed } = await supabase.from('company_boletos').update({ status: 'issuing', updated_at: new Date().toISOString() })
      .eq('id', id).in('status', ['draft', 'failed']).select('id');
    if (!claimed || claimed.length === 0) return { status: 409, body: { success: false, error: 'Emissão já em andamento.' } };
  }

  try {
    const token = await getToken(cfg);
    const existing = await c6Request(cfg, 'GET', `/v2/bank_slips/${row.external_reference_id}`, { token });
    if (existing.status === 200 && existing.body) {
      const saved = await saveFromC6(supabase, id, existing.body, { issued_at: new Date().toISOString() });
      return { status: 200, body: { success: true, recovered: true, status: saved.status } };
    }
    const r = await c6Request(cfg, 'POST', '/v2/bank_slips', { token, json: buildBankSlipPayload(row, cfg.env, cfg.pixKey) });
    if (r.status === 201 || r.status === 200) {
      const saved = await saveFromC6(supabase, id, r.body, { issued_at: new Date().toISOString() });
      return { status: 201, body: { success: true, status: saved.status } };
    }
    if (r.status >= 400 && r.status < 500) {
      // O C6 recusou: nada foi emitido, dá para corrigir e tentar de novo.
      await supabase.from('company_boletos').update({ status: 'failed', last_error: `C6 ${r.status}: ${errText(r.body)}`, updated_at: new Date().toISOString() }).eq('id', id);
      return { status: 422, body: { success: false, error: `O C6 recusou a cobrança (HTTP ${r.status}): ${errText(r.body)}` } };
    }
    // 5xx: resultado incerto. Fica "issuing"; a próxima tentativa consulta antes de emitir de novo.
    await supabase.from('company_boletos').update({ last_error: `C6 ${r.status}: ${errText(r.body)}`, updated_at: new Date().toISOString() }).eq('id', id);
    return { status: 502, body: { success: false, error: 'Resposta incerta do C6. Use "sync" para conferir antes de tentar de novo.' } };
  } catch (e: any) {
    await supabase.from('company_boletos').update({ last_error: String(e?.message || e).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', id);
    return { status: 502, body: { success: false, error: 'Não foi possível concluir a emissão agora. Use "sync" para conferir antes de tentar de novo.' } };
  }
}

async function sync(supabase: any, cfg: C6Config, id: string) {
  const row = await loadBoleto(supabase, id);
  if (!row) return { status: 404, body: { success: false, error: 'Cobrança não encontrada.' } };
  const token = await getToken(cfg);
  const r = await c6Request(cfg, 'GET', `/v2/bank_slips/${row.external_reference_id}`, { token });
  if (r.status === 404) {
    if (row.status === 'issuing') {
      // Nunca chegou ao C6: volta para rascunho para poder emitir de novo.
      await supabase.from('company_boletos').update({ status: 'failed', last_error: 'Emissão não encontrada no C6.', updated_at: new Date().toISOString() }).eq('id', id);
    }
    return { status: 404, body: { success: false, error: 'Cobrança não existe no C6.' } };
  }
  if (r.status !== 200) return { status: 502, body: { success: false, error: `C6 respondeu HTTP ${r.status}: ${errText(r.body)}` } };
  const saved = await saveFromC6(supabase, id, r.body);
  return { status: 200, body: { success: true, status: saved.status } };
}

async function cancel(supabase: any, cfg: C6Config, id: string) {
  const row = await loadBoleto(supabase, id);
  if (!row) return { status: 404, body: { success: false, error: 'Cobrança não encontrada.' } };
  if (row.status === 'draft' || row.status === 'failed') {
    await supabase.from('company_boletos').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', id);
    return { status: 200, body: { success: true, status: 'canceled' } };
  }
  if (row.status !== 'created') return { status: 409, body: { success: false, error: `Só cobrança em aberto pode ser cancelada (está "${row.status}").` } };
  const token = await getToken(cfg);
  const r = await c6Request(cfg, 'PUT', `/v2/bank_slips/${row.external_reference_id}/cancel`, { token });
  if (r.status !== 200 && r.status !== 204) return { status: 502, body: { success: false, error: `C6 respondeu HTTP ${r.status}: ${errText(r.body)}` } };
  await supabase.from('company_boletos').update({ status: 'canceled', last_error: null, updated_at: new Date().toISOString() }).eq('id', id);
  return { status: 200, body: { success: true, status: 'canceled' } };
}

async function registerWebhook(cfg: C6Config, publicUrl: string) {
  const token = await getToken(cfg);
  const r = await c6Request(cfg, 'POST', '/v1/webhooks/', { token, json: { url: publicUrl, service: 'BANK_SLIP_PIX' } });
  if (r.status !== 200 && r.status !== 201) return { status: 502, body: { success: false, error: `C6 respondeu HTTP ${r.status}: ${errText(r.body)}` } };
  return { status: 200, body: { success: true } };
}

// Notificação do C6: registra tudo, localiza a cobrança e reconsulta o estado real na API.
async function handleWebhook(supabase: any, req: any, res: any) {
  const expected = process.env.C6_WEBHOOK_TOKEN;
  const given = String(req.query?.webhook || '');
  if (!expected || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    res.status(401).json({ success: false });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const externalId = body.external_id ? String(body.external_id) : null;
  let boleto: any = null;
  try {
    if (externalId) {
      const { data } = await supabase.from('company_boletos').select('id, external_reference_id, c6_id')
        .or(`external_reference_id.eq.${externalId.replace(/[^A-Za-z0-9-]/g, '')},c6_id.eq.${externalId.replace(/[^A-Za-z0-9-]/g, '')}`).maybeSingle();
      boleto = data;
    }
    await supabase.from('c6_webhook_events').insert({
      service: body.service ? String(body.service) : null,
      status: body.status ? String(body.status) : null,
      external_id: externalId,
      matched: !!boleto,
      boleto_id: boleto?.id ?? null,
      raw_body: body,
    });
    const loaded = loadConfig();
    if (boleto && 'cfg' in loaded) await sync(supabase, loaded.cfg, boleto.id);
  } catch (e: any) {
    // Sempre responde 200 ao C6 para não gerar reentrega em loop; o evento já está registrado e dá para rodar "sync".
    console.error('c6 webhook', e?.message || e);
  }
  res.status(200).json({ success: true });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Método não permitido' });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel.' });
    return;
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (req.query?.webhook !== undefined) {
    await handleWebhook(supabase, req, res);
    return;
  }

  const admin: any = await authorizeAdmin(supabase, req);
  if (!admin.ok) {
    res.status(admin.status).json({ success: false, error: admin.error });
    return;
  }
  const loaded = loadConfig();
  if ('error' in loaded) {
    res.status(503).json({ success: false, error: loaded.error });
    return;
  }
  const cfg = loaded.cfg;
  const { action, boleto_id } = req.body || {};

  try {
    let out: { status: number; body: any };
    if (action === 'create') {
      const b = req.body || {};
      const check = validateBoletoInput({ amount: b.amount, due_date: b.due_date, description: b.description, payer: b.payer });
      if (!b.company_id) check.errors.push('company_id é obrigatório.');
      if (check.errors.length) {
        out = { status: 422, body: { success: false, error: check.errors.join(' ') } };
      } else {
        const instructions = Array.isArray(b.instructions) ? b.instructions.map((s: unknown) => String(s).slice(0, 80)).slice(0, 4) : [];
        const { data, error } = await supabase.from('company_boletos').insert({
          company_id: b.company_id,
          external_reference_id: newExternalReferenceId(),
          environment: cfg.env,
          description: check.description,
          amount: check.amount,
          due_date: check.due_date,
          payer: check.payer,
          instructions,
          notify_email: !!b.notify_email,
          created_by: admin.userId,
        }).select('id, external_reference_id').single();
        if (error) throw error;
        out = { status: 201, body: { success: true, boleto: data } };
      }
    } else if (action === 'issue' && boleto_id) out = await issue(supabase, cfg, String(boleto_id));
    else if (action === 'sync' && boleto_id) out = await sync(supabase, cfg, String(boleto_id));
    else if (action === 'cancel' && boleto_id) out = await cancel(supabase, cfg, String(boleto_id));
    else if (action === 'test_auth') {
      // Só confirma que credenciais + certificado são aceitos pelo C6; nunca devolve o token.
      await getToken(cfg);
      out = { status: 200, body: { success: true, env: cfg.env } };
    } else if (action === 'register_webhook') {
      const token = process.env.C6_WEBHOOK_TOKEN;
      const base = String(req.body?.base_url || '').replace(/\/+$/, '');
      if (!token || !/^https:\/\//.test(base)) out = { status: 422, body: { success: false, error: 'Defina C6_WEBHOOK_TOKEN e informe base_url (https).' } };
      else out = await registerWebhook(cfg, `${base}/api/c6?webhook=${encodeURIComponent(token)}`);
    } else out = { status: 400, body: { success: false, error: 'Ação inválida.' } };
    res.status(out.status).json(out.body);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || 'Erro interno' });
  }
}

import https from 'node:https';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Assina, no Portal Único Siscomex, os eventos de push da DUIMP que
 * interessam pro tracking (canal, situação, registro, retificação,
 * diagnóstico) — ver docs.portalunico.siscomex.gov.br/pages/webhooks/.
 *
 * Não existe (ainda) endpoint público de CONSULTA síncrona de DUIMP pra
 * intervenientes privados — só a assinatura de eventos, então é assim que
 * o AuraComex fica sabendo quando o canal ou a situação de uma DUIMP muda,
 * sem precisar ficar consultando de tempos em tempos.
 *
 * Cada empresa assina com o PRÓPRIO certificado (mesma mTLS do
 * test-connection.ts) e recebe um `webhook_secret` só dela — é esse secret
 * que a supabase/functions/portalunico-webhook usa pra confirmar de qual
 * empresa é cada notificação recebida.
 *
 * Nota: a lógica de autenticação mTLS é duplicada de test-connection.ts em
 * vez de importada de um módulo compartilhado — um _lib.ts prefixado com
 * "_" quebrou os dois endpoints em produção (aparentemente excluído do
 * bundle da função pela Vercel). Duplicar é menos elegante, mas garante
 * que cada função funcione isolada.
 */

const PORTAL_HOST = 'portalunico.siscomex.gov.br';

const EVENTOS_DUIMP_IMPORTADOR = [
  'dimp-situacao-import',
  'dimp-registro-import',
  'dimp-retifica-import',
  'dimp-diag-import',
];

type TlsOptions = { pfx: Buffer; passphrase: string } | { cert: string; key: string };

async function loadTlsOptions(
  supabase: any,
  config: { certificate_pem_path?: string | null; certificate_path?: string | null; certificate_password?: string | null },
): Promise<{ tlsOptions: TlsOptions } | { error: string; status: number }> {
  if (config.certificate_pem_path) {
    const { data: pemBlob, error: pemDownloadError } = await supabase.storage
      .from('company-certificates')
      .download(config.certificate_pem_path);
    if (pemDownloadError || !pemBlob) {
      return { error: `Falha ao baixar o certificado PEM: ${pemDownloadError?.message || 'arquivo não encontrado'}`, status: 500 };
    }
    const pemText = await pemBlob.text();
    const certMatch = pemText.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    const keyMatch = pemText.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/);
    if (!certMatch || !keyMatch) {
      return { error: 'O arquivo PEM cadastrado não tem um bloco CERTIFICATE e/ou PRIVATE KEY reconhecível.', status: 422 };
    }
    return { tlsOptions: { cert: certMatch[0], key: keyMatch[0] } };
  }

  if (config.certificate_path && config.certificate_password) {
    const { data: certBlob, error: downloadError } = await supabase.storage
      .from('company-certificates')
      .download(config.certificate_path);
    if (downloadError || !certBlob) {
      return { error: `Falha ao baixar o certificado: ${downloadError?.message || 'arquivo não encontrado'}`, status: 500 };
    }
    const certBuffer = Buffer.from(await certBlob.arrayBuffer());
    return { tlsOptions: { pfx: certBuffer, passphrase: config.certificate_password } };
  }

  return { error: 'Certificado digital (.pfx/.p12 ou PEM combinado) ainda não cadastrado para esta empresa.', status: 422 };
}

function authenticate(tlsOptions: TlsOptions, roleType: string): Promise<
  | { success: true; token: string; csrfToken: string }
  | { success: false; error: string; portal_status?: number; portal_response?: unknown }
> {
  return new Promise((resolve) => {
    const request = https.request(
      {
        hostname: PORTAL_HOST,
        path: '/portal/api/autenticar',
        method: 'POST',
        ...tlsOptions,
        headers: { 'Content-Type': 'application/json', 'Role-Type': roleType },
        timeout: 15000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          let parsedBody: any = null;
          try { parsedBody = rawBody ? JSON.parse(rawBody) : null; } catch { /* corpo não é JSON */ }

          const token = response.headers['set-token'] as string | undefined;
          const csrfToken = response.headers['x-csrf-token'] as string | undefined;
          const success = (response.statusCode || 0) < 300 && !!token;

          resolve(
            success
              ? { success: true, token: token!, csrfToken: csrfToken || '' }
              : {
                  success: false,
                  error: parsedBody?.message || `Falha na autenticação com o Portal Único (status ${response.statusCode}).`,
                  portal_status: response.statusCode,
                  portal_response: parsedBody || rawBody || null,
                },
          );
        });
      },
    );

    request.on('timeout', () => {
      request.destroy();
      resolve({ success: false, error: 'Tempo esgotado ao conectar no Portal Único.' });
    });
    request.on('error', (err: any) => {
      resolve({ success: false, error: `Erro de conexão TLS com o Portal Único: ${err.message}` });
    });
    request.end();
  });
}

function authenticatedRequest(
  tlsOptions: TlsOptions,
  auth: { token: string; csrfToken: string },
  options: { method: string; path: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = options.body ? JSON.stringify(options.body) : undefined;
    const request = https.request(
      {
        hostname: PORTAL_HOST,
        path: options.path,
        method: options.method,
        ...tlsOptions,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': auth.token,
          'X-CSRF-Token': auth.csrfToken,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 15000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          let parsedBody: any = null;
          try { parsedBody = rawBody ? JSON.parse(rawBody) : null; } catch { /* corpo não é JSON */ }
          resolve({ status: response.statusCode || 0, body: parsedBody ?? rawBody });
        });
      },
    );
    request.on('timeout', () => { request.destroy(); reject(new Error('Tempo esgotado ao conectar no Portal Único.')); });
    request.on('error', (err: any) => reject(new Error(`Erro de conexão com o Portal Único: ${err.message}`)));
    if (payload) request.write(payload);
    request.end();
  });
}

// Confere quem está chamando: exige o login do usuário (Bearer token do Supabase) e que a empresa pedida seja a
// dele (ou que ele seja superadmin). Sem isto, qualquer pessoa na internet poderia disparar o uso das credenciais
// de qualquer empresa só informando o company_id. Duplicada em test-connection.ts e subscribe-webhook.ts de
// propósito (ver nota acima sobre não extrair módulo compartilhado). Depende de profiles.company_id não ser
// alterável pelo próprio usuário (migration 20261112120000_hardening_acesso.sql).
async function authorizeCaller(
  supabase: any,
  req: any,
  companyId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const header = String(req.headers?.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Não autenticado.' };
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userErr || !userId) return { ok: false, status: 401, error: 'Sessão inválida.' };
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from('profiles').select('company_id').eq('user_id', userId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);
  const isSuperadmin = (roles || []).some((r: any) => r.role === 'superadmin');
  if (!isSuperadmin && profile?.company_id !== companyId) {
    return { ok: false, status: 403, error: 'Sem permissão para esta empresa.' };
  }
  return { ok: true };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Método não permitido' });
    return;
  }

  const { company_id } = req.body || {};
  if (!company_id) {
    res.status(400).json({ success: false, error: 'company_id é obrigatório' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY não configurada nas variáveis de ambiente do Vercel.' });
    return;
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const caller = await authorizeCaller(supabase, req, String(company_id));
  if (!caller.ok) {
    res.status(caller.status).json({ success: false, error: caller.error });
    return;
  }

  try {
    const { data: config, error: configError } = await supabase
      .from('company_portalunico_configs').select('*')
      .eq('company_id', company_id).eq('is_active', true).maybeSingle();
    if (configError) throw configError;
    if (!config) { res.status(404).json({ success: false, error: 'Nenhuma credencial do Portal Único cadastrada para esta empresa.' }); return; }

    const tlsResult = await loadTlsOptions(supabase, config);
    if ('error' in tlsResult) { res.status(tlsResult.status).json({ success: false, error: tlsResult.error }); return; }

    const authResult = await authenticate(tlsResult.tlsOptions, config.role_type || 'IMPEXP');
    if (!authResult.success) { res.status(400).json(authResult); return; }

    const webhookSecret: string = config.webhook_secret || crypto.randomBytes(24).toString('hex');
    const webhookEndpoint = `${supabaseUrl}/functions/v1/portalunico-webhook`;

    const existingIds: Record<string, number> = config.webhook_subscription_ids || {};
    const subscriptionIds: Record<string, number> = { ...existingIds };
    const errors: Record<string, string> = {};

    for (const evento of EVENTOS_DUIMP_IMPORTADOR) {
      try {
        const alreadySubscribed = existingIds[evento];
        const response = await authenticatedRequest(
          tlsResult.tlsOptions,
          { token: authResult.token, csrfToken: authResult.csrfToken },
          {
            method: alreadySubscribed ? 'PUT' : 'POST',
            path: alreadySubscribed ? `/portal/api/ext/webhook/${alreadySubscribed}` : '/portal/api/ext/webhook',
            body: {
              ...(alreadySubscribed ? { id: alreadySubscribed } : {}),
              evento,
              endpoint: webhookEndpoint,
              chaveSecreta: webhookSecret,
            },
          },
        );
        if (response.status >= 200 && response.status < 300 && response.body?.id) {
          subscriptionIds[evento] = response.body.id;
        } else {
          errors[evento] = response.body?.message || `status ${response.status}`;
        }
      } catch (err: any) {
        errors[evento] = err?.message || 'erro desconhecido';
      }
    }

    const anySuccess = Object.keys(subscriptionIds).length > 0;
    await supabase
      .from('company_portalunico_configs')
      .update({
        webhook_secret: webhookSecret,
        webhook_subscription_ids: subscriptionIds,
        webhook_active: anySuccess,
      })
      .eq('company_id', company_id);

    if (!anySuccess) {
      res.status(400).json({ success: false, error: 'Não foi possível assinar nenhum evento no Portal Único.', details: errors });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Notificações automáticas ativadas (${Object.keys(subscriptionIds).length}/${EVENTOS_DUIMP_IMPORTADOR.length} eventos).`,
      subscriptions: subscriptionIds,
      errors: Object.keys(errors).length ? errors : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro interno' });
  }
}

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Loader2, ExternalLink, FileCode, BellRing } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Props {
  companyId: string;
}

/**
 * O client do Supabase, ao receber um status non-2xx de uma Edge Function,
 * joga fora o corpo da resposta e só expõe uma mensagem genérica
 * ("Edge Function returned a non-2xx status code") no `error.message`. O
 * corpo de verdade (com a mensagem detalhada que a função devolveu, ex. o
 * erro real do Portal Único) fica em `error.context`, que é a Response
 * crua — precisa ser lido manualmente.
 */
async function extractFunctionErrorMessage(error: any): Promise<string> {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.clone().json();
      if (body?.error) return body.error as string;
    }
  } catch {
    // corpo não era JSON ou já foi consumido — cai no fallback abaixo
  }
  return error?.message || 'Erro desconhecido';
}

/**
 * Cada empresa cadastra AQUI sua própria credencial do Portal Único
 * Siscomex — nunca compartilhada entre empresas/tenants do AuraComex.
 *
 * A autenticação real do Portal Único exige TLS mútuo (o certificado
 * digital A1 sendo apresentado na própria conexão) — a Chave de Acesso
 * (Client-Id/Client-Secret) sozinha não basta, confirmado via teste real
 * (handshake TLS falha sem o certificado). Por isso o certificado é
 * obrigatório aqui, guardado no bucket privado `company-certificates`
 * (isolado por empresa via RLS) e usado pela função serverless Node.js do
 * Vercel (api/portalunico/*.ts) — o runtime do Supabase Edge Function não
 * suporta apresentar certificado cliente numa conexão TLS.
 */
export function PortalUnicoConfigWizard({ companyId }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pemFileInputRef = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificatePassword, setCertificatePassword] = useState('');
  const [pemFile, setPemFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  const { data: config } = useQuery({
    queryKey: ['company-portalunico-config', companyId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('company_portalunico_configs') as any)
        .select('client_id, role_type, is_active, certificate_path, certificate_pem_path, last_tested_at, last_test_success, webhook_active, webhook_subscription_ids, webhook_last_event_at')
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.pfx') && !file.name.endsWith('.p12')) {
      toast.error('Selecione um arquivo de certificado (.pfx ou .p12)');
      return;
    }
    setCertificateFile(file);
  }

  function handlePemFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.pem')) {
      toast.error('Selecione o arquivo .pem gerado pelo openssl');
      return;
    }
    setPemFile(file);
  }

  async function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error('Informe o Client-Id e o Client-Secret gerados no Portal Único');
      return;
    }
    if (!config?.certificate_path && (!certificateFile || !certificatePassword.trim())) {
      toast.error('O certificado digital (.pfx/.p12) e a senha são obrigatórios');
      return;
    }
    setSaving(true);
    try {
      let certificatePath: string | undefined;
      if (certificateFile) {
        const fileExt = certificateFile.name.split('.').pop();
        certificatePath = `${companyId}/portalunico_cert_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('company-certificates')
          .upload(certificatePath, certificateFile, { upsert: true });
        if (uploadError) throw uploadError;
      }

      let certificatePemPath: string | undefined;
      if (pemFile) {
        certificatePemPath = `${companyId}/portalunico_cert_${Date.now()}.pem`;
        const { error: uploadPemError } = await supabase.storage
          .from('company-certificates')
          .upload(certificatePemPath, pemFile, { upsert: true });
        if (uploadPemError) throw uploadPemError;
      }

      const { data, error } = await supabase.functions.invoke('portalunico-gateway', {
        body: {
          action: 'save_config',
          company_id: companyId,
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          certificate_path: certificatePath,
          certificate_password: certificatePassword.trim() || undefined,
          certificate_pem_path: certificatePemPath,
        },
      });
      if (error) throw new Error(await extractFunctionErrorMessage(error));
      if (!data?.success) throw new Error(data?.error || 'Falha ao salvar credenciais');
      toast.success('Credenciais do Portal Único salvas.');
      setClientSecret('');
      setCertificateFile(null);
      setCertificatePassword('');
      setPemFile(null);
      queryClient.invalidateQueries({ queryKey: ['company-portalunico-config', companyId] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  // As funções /api/portalunico/* exigem o login do usuário (token da sessão do Supabase).
  async function authHeaders(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function handleTest() {
    setTesting(true);
    try {
      const response = await fetch('/api/portalunico/test-connection', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ company_id: companyId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        toast.error(data?.error || `Falha ao autenticar no Portal Único (status ${response.status})`);
      } else {
        toast.success(data.message || 'Conexão validada com sucesso.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Falha ao chamar a função de teste');
    } finally {
      setTesting(false);
      queryClient.invalidateQueries({ queryKey: ['company-portalunico-config', companyId] });
    }
  }

  async function handleSubscribe() {
    setSubscribing(true);
    try {
      const response = await fetch('/api/portalunico/subscribe-webhook', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ company_id: companyId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        toast.error(data?.error || `Falha ao ativar as notificações (status ${response.status})`);
      } else {
        toast.success(data.message || 'Notificações automáticas ativadas.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Falha ao chamar a função de assinatura');
    } finally {
      setSubscribing(false);
      queryClient.invalidateQueries({ queryKey: ['company-portalunico-config', companyId] });
    }
  }

  return (
    <Card className="glass">
      <CardContent className="pt-6 space-y-4">
        <p className="text-xs text-muted-foreground">
          Gere a Chave de Acesso em{' '}
          <a
            href="https://portalunico.siscomex.gov.br/portal/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline inline-flex items-center gap-1"
          >
            Portal Único <ExternalLink className="w-3 h-3" />
          </a>
          {' '}→ Perfil do Usuário → Chaves de Acesso → Incluir (Tipo: Pessoa Física). O certificado
          digital (.pfx/.p12) é o mesmo que você usa pra acessar o Portal Único — cada empresa deve
          usar sua própria chave e certificado, nunca compartilhados entre contas.
        </p>

        {config?.client_id && (
          <div className="flex items-center gap-2 text-xs rounded-md border border-border px-3 py-2 flex-wrap">
            <span className="text-muted-foreground">Chave atual:</span>
            <span className="font-mono">{config.client_id.slice(0, 6)}…</span>
            {config.certificate_path && (
              <Badge variant="outline" className="gap-1"><FileCode className="w-3 h-3" /> Certificado cadastrado</Badge>
            )}
            {config.certificate_pem_path && (
              <Badge variant="outline" className="gap-1"><FileCode className="w-3 h-3" /> PEM cadastrado</Badge>
            )}
            {config.last_tested_at && (
              <span className="flex items-center gap-1 ml-auto">
                {config.last_test_success ? (
                  <Badge className="bg-green-500/10 text-green-600 gap-1"><CheckCircle2 className="w-3 h-3" /> Conectado</Badge>
                ) : (
                  <Badge className="bg-red-500/10 text-red-600 gap-1"><XCircle className="w-3 h-3" /> Falhou</Badge>
                )}
                <span className="text-muted-foreground">{format(new Date(config.last_tested_at), 'dd/MM/yyyy HH:mm')}</span>
              </span>
            )}
            {config.webhook_active && (
              <Badge className="bg-blue-500/10 text-blue-600 gap-1">
                <BellRing className="w-3 h-3" /> Notificações ativas
                {config.webhook_last_event_at && ` · último evento ${format(new Date(config.webhook_last_event_at), 'dd/MM HH:mm')}`}
              </Badge>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Client-Id (Chave)</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Gerado no Portal Único" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Client-Secret (Senha)</Label>
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Gerado no Portal Único" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Certificado Digital (.pfx/.p12)</Label>
            <div
              className="border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileCode className={`h-6 w-6 ${certificateFile ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="text-xs font-medium text-center">
                {certificateFile ? certificateFile.name : config?.certificate_path ? 'Substituir certificado atual' : 'Clique para selecionar'}
              </span>
              <input ref={fileInputRef} type="file" className="hidden" accept=".pfx,.p12" onChange={handleFileChange} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Senha do Certificado</Label>
            <Input
              type="password"
              value={certificatePassword}
              onChange={(e) => setCertificatePassword(e.target.value)}
              placeholder={config?.certificate_path ? 'Preencha se for substituir o certificado' : 'Senha do arquivo .pfx'}
            />
          </div>
        </div>

        <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <Label className="text-xs">Certificado combinado em PEM (opcional — só se o .pfx der erro "Unsupported PKCS12 PFX data")</Label>
          <p className="text-[11px] text-muted-foreground">
            Certificados A1 mais antigos usam criptografia que o Node.js/OpenSSL 3 não abre mais diretamente.
            Rode no seu computador (com openssl instalado): <br />
            <code className="text-[10px] bg-muted px-1 rounded">openssl pkcs12 -in seu_certificado.pfx -nodes -out combinado.pem -legacy</code>
            {' '}(se der erro de opção desconhecida, tire o <code className="text-[10px]">-legacy</code> do final) e envie o arquivo <code className="text-[10px]">combinado.pem</code> gerado abaixo.
          </p>
          <div
            className="border-2 border-dashed rounded-lg p-3 flex items-center justify-center gap-2 cursor-pointer hover:bg-muted/50 transition-colors mt-2"
            onClick={() => pemFileInputRef.current?.click()}
          >
            <FileCode className={`h-5 w-5 ${pemFile ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="text-xs font-medium">
              {pemFile ? pemFile.name : config?.certificate_pem_path ? 'PEM cadastrado — clique para substituir' : 'Clique para selecionar combinado.pem'}
            </span>
            <input ref={pemFileInputRef} type="file" className="hidden" accept=".pem" onChange={handlePemFileChange} />
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Salvar
          </Button>
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !config?.client_id}>
            {testing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Testar Conexão
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSubscribe}
            disabled={subscribing || !config?.last_test_success}
            title={!config?.last_test_success ? 'Teste a conexão com sucesso antes de ativar as notificações' : undefined}
          >
            {subscribing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <BellRing className="w-4 h-4 mr-1.5" />}
            {config?.webhook_active ? 'Reativar Notificações' : 'Ativar Notificações Automáticas'}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Ativando, o canal e a situação da DUIMP são atualizados sozinhos no embarque sempre que mudarem no Portal Único —
          basta preencher o "Número DUIMP" na aba Logística de cada processo.
        </p>
      </CardContent>
    </Card>
  );
}

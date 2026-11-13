import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, Loader2, PlugZap, RefreshCw, Webhook } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Cobranças C6 (boleto/Pix) das assinaturas — painel do superadmin. Toda ação passa pela função /api/c6, que só aceita
 * superadmin listado em C6_ALLOWED_EMAILS. Ambiente (sandbox/produção) vem da variável C6_ENV no Vercel.
 */

type Boleto = {
  id: string;
  company_id: string;
  external_reference_id: string;
  environment: string;
  description: string;
  amount: number;
  due_date: string;
  status: string;
  digitable_line: string | null;
  pix_qr_code: string | null;
  last_error: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  issuing: 'Emitindo',
  created: 'Emitido',
  waiting_confirmation: 'Aguardando confirmação',
  paid: 'Pago',
  canceled: 'Cancelado',
  failed: 'Falhou',
};

const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => iso.split('-').reverse().join('/');

async function callC6(body: Record<string, unknown>): Promise<any> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre de novo.');
  const res = await fetch('/api/c6', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.error || `Erro ${res.status}`);
  return json;
}

const EMPTY_FORM = {
  company_id: '', amount: '', due_date: '', description: '',
  name: '', tax_id: '', email: '', address: '', neighborhood: '', city: '', state: '', zip_code: '',
};

export function C6BillingPanel() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: companies = [] } = useQuery({
    queryKey: ['c6', 'companies'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name, cnpj, email').order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string; cnpj: string | null; email: string | null }[];
    },
  });

  const { data: boletos = [], isLoading } = useQuery({
    queryKey: ['c6', 'boletos'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('company_boletos').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as Boleto[];
    },
  });

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || '—';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['c6', 'boletos'] });

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e?.message || 'Erro'); } finally { setBusy(null); }
  }

  const testar = () => run('test', async () => {
    const r = await callC6({ action: 'test_auth' });
    toast.success(`Conexão com o C6 OK (ambiente: ${r.env}).`);
  });

  const registrarWebhook = () => run('webhook', async () => {
    if (!/^https:\/\//.test(window.location.origin)) throw new Error('O webhook só pode ser registrado a partir do site em https.');
    await callC6({ action: 'register_webhook', base_url: window.location.origin });
    toast.success('Webhook registrado no C6.');
  });

  const criarEEmitir = () => run('create', async () => {
    const created = await callC6({
      action: 'create',
      company_id: form.company_id,
      amount: Number(String(form.amount).replace(',', '.')),
      due_date: form.due_date,
      description: form.description,
      payer: {
        name: form.name, tax_id: form.tax_id, email: form.email || null,
        address: { address: form.address, neighborhood: form.neighborhood, city: form.city, state: form.state, zip_code: form.zip_code },
      },
    });
    await refresh();
    try {
      await callC6({ action: 'issue', boleto_id: created.boleto.id });
      toast.success('Cobrança criada e emitida no C6.');
      setForm(EMPTY_FORM);
    } catch (e: any) {
      toast.error(`Cobrança criada como rascunho, mas a emissão falhou: ${e?.message}`);
    }
    await refresh();
  });

  const acao = (action: 'issue' | 'sync' | 'cancel', b: Boleto, ok: string) => run(`${action}-${b.id}`, async () => {
    await callC6({ action, boleto_id: b.id });
    toast.success(ok);
    await refresh();
  });

  function escolherEmpresa(id: string) {
    const c = companies.find((x) => x.id === id);
    setForm((f) => ({
      ...f, company_id: id,
      name: f.name || (c?.name || '').slice(0, 40),
      tax_id: f.tax_id || (c?.cnpj || '').replace(/\D/g, ''),
      email: f.email || c?.email || '',
    }));
  }

  const copiar = (txt: string) => { navigator.clipboard?.writeText(txt); toast.success('Copiado.'); };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conexão com o C6 Bank</CardTitle>
          <CardDescription>
            As chaves ficam no Vercel (nunca no banco). O ambiente (sandbox ou produção) é o da variável C6_ENV.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={testar} disabled={busy !== null}>
            {busy === 'test' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlugZap className="w-4 h-4 mr-2" />}Testar conexão
          </Button>
          <Button variant="outline" onClick={registrarWebhook} disabled={busy !== null}>
            {busy === 'webhook' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Webhook className="w-4 h-4 mr-2" />}Registrar webhook de pagamento
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova cobrança (boleto com Pix)</CardTitle>
          <CardDescription>Nome de quem paga: até 40 caracteres. Endereço completo é exigido pelo C6.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2 space-y-1.5">
              <Label>Empresa cliente</Label>
              <Select value={form.company_id} onValueChange={escolherEmpresa}>
                <SelectTrigger><SelectValue placeholder="Escolha a empresa" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Valor (R$)</Label><Input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0,00" /></div>
            <div className="space-y-1.5"><Label>Vencimento</Label><Input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} /></div>
            <div className="md:col-span-4 space-y-1.5"><Label>Descrição (até 100)</Label><Input maxLength={100} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Assinatura Aura Comex — dezembro/2026" /></div>
            <div className="md:col-span-2 space-y-1.5"><Label>Nome de quem paga</Label><Input maxLength={40} value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>CPF/CNPJ</Label><Input value={form.tax_id} onChange={(e) => set('tax_id', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>E-mail</Label><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="md:col-span-2 space-y-1.5"><Label>Logradouro e número</Label><Input maxLength={40} value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Bairro</Label><Input maxLength={40} value={form.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Cidade</Label><Input maxLength={40} value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>UF</Label><Input maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} /></div>
            <div className="space-y-1.5"><Label>CEP</Label><Input value={form.zip_code} onChange={(e) => set('zip_code', e.target.value)} /></div>
          </div>
          <Button onClick={criarEEmitir} disabled={busy !== null || !form.company_id}>
            {busy === 'create' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Criar e emitir no C6
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Cobranças emitidas</CardTitle>
          <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead><TableHead>Valor</TableHead><TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead><TableHead>Ambiente</TableHead><TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {!isLoading && boletos.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma cobrança ainda.</TableCell></TableRow>}
              {boletos.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <div className="font-medium">{companyName(b.company_id)}</div>
                    <div className="text-xs text-muted-foreground">{b.description}</div>
                    {b.last_error && <div className="text-xs text-destructive">{b.last_error}</div>}
                  </TableCell>
                  <TableCell>{brl(b.amount)}</TableCell>
                  <TableCell>{dataBR(b.due_date)}</TableCell>
                  <TableCell><Badge variant={b.status === 'paid' ? 'default' : 'secondary'}>{STATUS_LABEL[b.status] || b.status}</Badge></TableCell>
                  <TableCell>{b.environment}</TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    {b.digitable_line && <Button size="sm" variant="ghost" title="Copiar linha digitável" onClick={() => copiar(b.digitable_line!)}><Copy className="w-4 h-4" /></Button>}
                    {b.pix_qr_code && <Button size="sm" variant="ghost" title="Copiar Pix copia e cola" onClick={() => copiar(b.pix_qr_code!)}>Pix</Button>}
                    {(b.status === 'draft' || b.status === 'failed' || b.status === 'issuing') && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => acao('issue', b, 'Cobrança emitida.')}>Emitir</Button>
                    )}
                    {b.status !== 'draft' && b.status !== 'failed' && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => acao('sync', b, 'Situação atualizada.')}>Consultar</Button>
                    )}
                    {(b.status === 'created' || b.status === 'waiting_confirmation') && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => acao('cancel', b, 'Cobrança cancelada.')}>Cancelar</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

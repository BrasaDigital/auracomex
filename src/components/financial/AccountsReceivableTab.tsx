import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { CheckCircle, Wallet, AlertTriangle, CalendarClock, Paperclip, Undo2 } from 'lucide-react';
import { format, isBefore, addDays, startOfDay, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { DOCS_BUCKET, openSignedDoc } from '@/lib/storage';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { ColumnSearch } from '@/components/shared/ColumnSearch';
import { MonthSelect } from './MonthSelect';

type AR = {
  id: string;
  source: string;
  debit_note_id: string | null;
  quote_id: string | null;
  shipment_id: string | null;
  client_id: string | null;
  company_id: string;
  description: string;
  currency: string;
  amount: number;
  due_date: string | null;
  status: 'aberto' | 'recebido' | 'atrasado' | 'cancelado';
  received_at: string | null;
  received_amount: number | null;
  receipt_reference: string | null;
  receipt_url: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  aberto: 'Em aberto', recebido: 'Recebido', atrasado: 'Atrasado', cancelado: 'Cancelado',
};
const STATUS_COLOR: Record<string, string> = {
  aberto: 'bg-slate-500/20 text-slate-300',
  recebido: 'bg-emerald-500/20 text-emerald-300',
  atrasado: 'bg-red-500/20 text-red-300',
  cancelado: 'bg-muted text-muted-foreground',
};
const SOURCE_LABEL: Record<string, string> = {
  debit_note: 'Nota de Débito',
  manual: 'Manual',
  storage_fee: 'Rebate de Armazenagem',
};

export default function AccountsReceivableTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  // Filtro de mês: para contas já recebidas, localiza pela data de
  // recebimento (received_at) — não pela data de vencimento/lançamento.
  // Contas ainda em aberto/atrasadas não têm data de recebimento, então
  // continuam localizadas pelo vencimento.
  const [monthFilter, setMonthFilter] = useState<string>(() => format(new Date(), 'yyyy-MM'));
  const [searchDesc, setSearchDesc] = useState('');
  const [searchDescOpen, setSearchDescOpen] = useState(false);
  const [searchClient, setSearchClient] = useState('');
  const [searchClientOpen, setSearchClientOpen] = useState(false);
  const [searchProcess, setSearchProcess] = useState('');
  const [searchProcessOpen, setSearchProcessOpen] = useState(false);
  const [target, setTarget] = useState<AR | null>(null);
  const [form, setForm] = useState<{ received_at: string; received_amount: string; receipt_reference: string; file: File | null }>({ received_at: format(new Date(), 'yyyy-MM-dd'), received_amount: '', receipt_reference: '', file: null });
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [unreceiveTarget, setUnreceiveTarget] = useState<AR | null>(null);
  const [unreceiving, setUnreceiving] = useState(false);

  const { data: rows = [], refetch } = useQuery({
    queryKey: ['accounts_receivable'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts_receivable' as any)
        .select('*')
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AR[];
    },
  });

  const clients = useQuery({
    queryKey: ['ar-clients'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });
  const clientMap = new Map((clients.data ?? []).map((p) => [p.id, p.name]));

  const quoteIds = Array.from(new Set(rows.map((r) => r.quote_id).filter(Boolean))) as string[];
  const quotesQ = useQuery({
    queryKey: ['ar-quotes', quoteIds.join(',')],
    enabled: quoteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('quotes').select('id, base_reference, storage_fee_amount').in('id', quoteIds);
      return (data ?? []) as Array<{ id: string; base_reference: string | null; storage_fee_amount: number | null }>;
    },
  });
  const quoteMap = new Map((quotesQ.data ?? []).map((q) => [q.id, q.base_reference]));
  // Câmbio de cada linha tem que ser o digitado pelo usuário na hora de
  // criar a ND (debit_notes.exchange_rate), não a cotação do dia.
  const debitNoteIds = Array.from(new Set(rows.map((r) => r.debit_note_id).filter(Boolean))) as string[];
  const dnRatesQ = useQuery({
    queryKey: ['ar-dn-rates', debitNoteIds.join(',')],
    enabled: debitNoteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('debit_notes' as any).select('id, exchange_rate').in('id', debitNoteIds);
      return (data ?? []) as unknown as Array<{ id: string; exchange_rate: number | null }>;
    },
  });
  const dnRateMap = new Map((dnRatesQ.data ?? []).map((d) => [d.id, d.exchange_rate]));
  // Para armazenagem, o "Valor Lançado" tem que ser espelho do campo "Armazenagem no
  // destino" da aba Geral do processo (quotes.storage_fee_amount) — não o valor
  // gravado em accounts_receivable.amount, que na verdade é o rebate já calculado
  // (% do fornecedor Co-loader) e pode ficar desatualizado se o % mudar depois.
  const storageFeeMap = new Map((quotesQ.data ?? []).map((q) => [q.id, q.storage_fee_amount]));

  const today = startOfDay(new Date());
  const enriched = rows.map((r) => {
    const overdue = r.status === 'aberto' && !!r.due_date && isBefore(parseISO(r.due_date), today);
    return { ...r, status: overdue ? ('atrasado' as const) : r.status };
  });

  const filtered = enriched.filter((r) => {
    if (statusFilter !== 'todos' && r.status !== statusFilter) return false;
    if (searchDesc && !r.description?.toLowerCase().includes(searchDesc.toLowerCase())) return false;
    if (searchClient) {
      const name = r.client_id ? clientMap.get(r.client_id) ?? '' : '';
      if (!name.toLowerCase().includes(searchClient.toLowerCase())) return false;
    }
    if (searchProcess) {
      const ref = (r.quote_id ? quoteMap.get(r.quote_id) : null) || '';
      if (!ref.toLowerCase().includes(searchProcess.toLowerCase())) return false;
    }
    if (monthFilter && monthFilter !== 'todos') {
      const relevant = r.status === 'recebido' ? r.received_at : r.due_date;
      if (!relevant || relevant.slice(0, 7) !== monthFilter) return false;
    }
    return true;
  });

  // Idem AccountsPayableTab: os KPIs somavam linhas em moedas diferentes
  // (USD/EUR/BRL) direto, exibindo o total como se fosse tudo BRL.
  const { usdBrl, eurBrl } = useExchangeRate();
  // Taxa efetiva de uma linha: a digitada pelo usuário na ND, se houver; senão
  // (conta manual, sem ND) cai pra cotação do dia como estimativa.
  function rateFor(currency: string, debitNoteId: string | null): number {
    const cur = (currency || 'BRL').toUpperCase();
    if (cur === 'BRL') return 1;
    const stored = debitNoteId ? dnRateMap.get(debitNoteId) : null;
    if (stored != null) return Number(stored);
    if (cur === 'USD') return usdBrl || 0;
    if (cur === 'EUR') return eurBrl || 0;
    return 1;
  }
  function toBRL(amount: number, currency: string, debitNoteId: string | null = null): number {
    return amount * rateFor(currency, debitNoteId);
  }

  const kpis = useMemo(() => {
    const in7 = addDays(today, 7);
    let vencidos = 0, aVencer = 0, recebidos = 0, aberto = 0;
    for (const r of enriched) {
      const amt = toBRL(Number(r.amount) || 0, r.currency, r.debit_note_id);
      if (r.status === 'recebido') recebidos += toBRL(Number(r.received_amount ?? r.amount) || 0, r.currency, r.debit_note_id);
      else if (r.status === 'atrasado') vencidos += amt;
      else if (r.status === 'aberto') {
        aberto += amt;
        if (r.due_date && isBefore(parseISO(r.due_date), in7)) aVencer += amt;
      }
    }
    return { vencidos, aVencer, recebidos, aberto };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, today, usdBrl, eurBrl, dnRateMap]);

  async function markReceived() {
    if (!target) return;
    const receivedAmount = Number(form.received_amount);
    if (!isFinite(receivedAmount) || receivedAmount < 0) {
      return toast.error('Informe um valor recebido válido');
    }
    let receipt_url: string | null = null;
    if (form.file) {
      setUploadingReceipt(true);
      const path = `${target.company_id}/receipts/${target.id}/${Date.now()}_${sanitizeStorageFileName(form.file.name)}`;
      const { error: upErr } = await supabase.storage.from(DOCS_BUCKET).upload(path, form.file);
      setUploadingReceipt(false);
      if (upErr) return toast.error('Erro ao anexar comprovante', { description: upErr.message });
      receipt_url = path;
    }
    const { error } = await supabase
      .from('accounts_receivable' as any)
      .update({
        status: 'recebido',
        received_at: form.received_at,
        received_amount: receivedAmount,
        receipt_reference: form.receipt_reference || null,
        ...(receipt_url ? { receipt_url } : {}),
      })
      .eq('id', target.id);
    if (error) return toast.error('Erro ao registrar recebimento', { description: error.message });

    if (target.debit_note_id) {
      await supabase.from('debit_notes' as any).update({
        status: 'paga', paid_at: form.received_at, paid_amount: receivedAmount, payment_reference: form.receipt_reference || null,
      }).eq('id', target.debit_note_id);
    }

    toast.success('Recebimento registrado');
    setTarget(null);
    refetch();
    qc.invalidateQueries({ queryKey: ['client_debit_notes'] });
  }

  // Desfaz um recebimento já registrado — volta a conta pra "Em aberto" e,
  // se vier de uma ND, reabre a ND (status 'emitida').
  async function unreceive() {
    if (!unreceiveTarget) return;
    setUnreceiving(true);
    const { error } = await supabase
      .from('accounts_receivable' as any)
      .update({ status: 'aberto', received_at: null, received_amount: null, receipt_reference: null, receipt_url: null })
      .eq('id', unreceiveTarget.id);
    if (error) {
      setUnreceiving(false);
      return toast.error('Erro ao desfazer recebimento', { description: error.message });
    }

    if (unreceiveTarget.debit_note_id) {
      await supabase.from('debit_notes' as any).update({ status: 'emitida' }).eq('id', unreceiveTarget.debit_note_id);
      qc.invalidateQueries({ queryKey: ['client_debit_notes'] });
    }

    setUnreceiving(false);
    toast.success('Recebimento desfeito — conta voltou para "Em aberto"');
    setUnreceiveTarget(null);
    refetch();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Kpi title="A receber (7d)" value={kpis.aVencer} icon={<CalendarClock className="w-4 h-4" />} tone="amber" />
        <Kpi title="Atrasados" value={kpis.vencidos} icon={<AlertTriangle className="w-4 h-4" />} tone="red" />
        <Kpi title="Em aberto" value={kpis.aberto} icon={<Wallet className="w-4 h-4" />} tone="slate" />
        <Kpi title="Recebidos" value={kpis.recebidos} icon={<CheckCircle className="w-4 h-4" />} tone="emerald" />
      </div>

      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Valores a Receber</CardTitle>
          <div className="flex items-center gap-2">
            <MonthSelect
              value={monthFilter}
              onChange={setMonthFilter}
              allowAll
              extraMonths={rows.map((r) => (r.status === 'recebido' ? r.received_at : r.due_date)).filter(Boolean).map((d) => (d as string).slice(0, 7))}
              title="Filtra recebidos pela data de recebimento; em aberto/atrasados pelo vencimento"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="aberto">Em aberto</SelectItem>
                <SelectItem value="atrasado">Atrasados</SelectItem>
                <SelectItem value="recebido">Recebidos</SelectItem>
                <SelectItem value="cancelado">Cancelados</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma conta encontrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1.5">
                      Descrição
                      <ColumnSearch value={searchDesc} onChange={setSearchDesc} open={searchDescOpen} onOpenChange={setSearchDescOpen} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1.5">
                      Cliente/Fornecedor
                      <ColumnSearch value={searchClient} onChange={setSearchClient} open={searchClientOpen} onOpenChange={setSearchClientOpen} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1.5">
                      Processo
                      <ColumnSearch value={searchProcess} onChange={setSearchProcess} open={searchProcessOpen} onOpenChange={setSearchProcessOpen} />
                    </div>
                  </TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor Lançado</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source] || r.source}</TableCell>
                    <TableCell className="max-w-[220px] truncate whitespace-nowrap" title={r.description}>{r.description}</TableCell>
                    <TableCell>{r.client_id ? clientMap.get(r.client_id) ?? '—' : '—'}</TableCell>
                    <TableCell>
                      {r.quote_id && quoteMap.get(r.quote_id) ? (
                        <Link to={`/quotes?open=${r.quote_id}`} className="text-primary hover:underline font-mono text-xs">
                          {quoteMap.get(r.quote_id)}
                        </Link>
                      ) : (
                        <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">—</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.due_date ? format(parseISO(r.due_date), 'dd/MM/yyyy') : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {(() => {
                        const launched = r.source === 'storage_fee' && r.quote_id && storageFeeMap.get(r.quote_id) != null
                          ? Number(storageFeeMap.get(r.quote_id))
                          : Number(r.amount);
                        return <>{r.currency} {launched.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
                      })()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.status === 'recebido' && r.received_amount != null && Number(r.received_amount) !== Number(r.amount) ? (
                        <span className={Number(r.received_amount) < Number(r.amount) ? 'text-amber-500' : 'text-emerald-500'}>
                          {r.currency} {Number(r.received_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <>{r.currency} {Number(r.status === 'recebido' ? (r.received_amount ?? r.amount) : r.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                      )}
                      {r.currency && r.currency.toUpperCase() !== 'BRL' && (() => {
                        const shown = Number(r.status === 'recebido' ? (r.received_amount ?? r.amount) : r.amount);
                        return (
                          <div className="text-[10px] text-muted-foreground font-normal">
                            câmbio {rateFor(r.currency, r.debit_note_id).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                            {' = R$ '}{toBRL(shown, r.currency, r.debit_note_id).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[r.status]} variant="secondary">
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {r.receipt_url && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver comprovante" onClick={() => openSignedDoc(r.receipt_url).catch((e) => toast.error(e.message))}>
                            <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                        )}
                        {r.status !== 'recebido' && r.status !== 'cancelado' && (
                          <Button size="sm" variant="outline" onClick={() => { setTarget(r); setForm({ received_at: format(new Date(), 'yyyy-MM-dd'), received_amount: String(r.amount), receipt_reference: '', file: null }); }}>
                            Receber
                          </Button>
                        )}
                        {r.status === 'recebido' && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setUnreceiveTarget(r)}>
                            <Undo2 className="w-3.5 h-3.5 mr-1" /> Desfazer
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar recebimento</DialogTitle></DialogHeader>
          {target && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {target.description} — previsto {target.currency} {Number(target.amount).toFixed(2)}
              </div>
              <div>
                <Label>Data do recebimento</Label>
                <Input type="date" value={form.received_at} onChange={(e) => setForm({ ...form, received_at: e.target.value })} />
              </div>
              <div>
                <Label>Valor recebido</Label>
                <Input type="number" step="0.01" value={form.received_amount} onChange={(e) => setForm({ ...form, received_amount: e.target.value })} />
                {form.received_amount !== '' && Number(form.received_amount) !== Number(target.amount) && (
                  <p className={`text-xs mt-1 ${Number(form.received_amount) < Number(target.amount) ? 'text-amber-500' : 'text-emerald-500'}`}>
                    Diferença em relação ao previsto: {target.currency} {(Number(form.received_amount) - Number(target.amount)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' })}
                  </p>
                )}
              </div>
              <div>
                <Label>Referência (TED/PIX/SWIFT)</Label>
                <Input placeholder="Opcional" value={form.receipt_reference} onChange={(e) => setForm({ ...form, receipt_reference: e.target.value })} />
              </div>
              <div>
                <Label>Comprovante (opcional)</Label>
                <Input type="file" accept="application/pdf,image/*" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={uploadingReceipt}>Cancelar</Button>
            <Button onClick={markReceived} disabled={uploadingReceipt}>{uploadingReceipt ? 'Enviando…' : 'Confirmar recebimento'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!unreceiveTarget} onOpenChange={(o) => !unreceiving && !o && setUnreceiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer este recebimento?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta volta para "Em aberto" e o registro do recebimento (data, valor recebido, referência,
              comprovante) é apagado.
              {unreceiveTarget?.debit_note_id && ' A Nota de Débito vinculada volta a ficar "Emitida".'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unreceiving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={unreceive} disabled={unreceiving}>
              {unreceiving ? 'Desfazendo…' : 'Sim, desfazer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kpi({ title, value, icon, tone }: { title: string; value: number; icon: React.ReactNode; tone: string }) {
  const toneMap: Record<string, string> = {
    amber: 'text-amber-400', red: 'text-red-400', emerald: 'text-emerald-400', slate: 'text-slate-300',
  };
  return (
    <Card className="glass">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{title}</span>
          <span className={toneMap[tone]}>{icon}</span>
        </div>
        <div className={`text-xl font-semibold tabular-nums mt-1 ${toneMap[tone]}`}>
          {value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })}
        </div>
      </CardContent>
    </Card>
  );
}
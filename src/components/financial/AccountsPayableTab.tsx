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
import { format, isBefore, addDays, addMonths, startOfDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { DOCS_BUCKET, openSignedDoc } from '@/lib/storage';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { ColumnSearch } from '@/components/shared/ColumnSearch';

type AP = {
  id: string;
  company_id: string;
  source: string;
  debit_note_id: string | null;
  quote_id: string | null;
  shipment_id: string | null;
  partner_id: string | null;
  description: string;
  currency: string;
  amount: number;
  due_date: string;
  status: 'aberto' | 'pago' | 'atrasado' | 'cancelado';
  paid_at: string | null;
  payment_method: string | null;
  receipt_url: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  aberto: 'Em aberto',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
};
const STATUS_COLOR: Record<string, string> = {
  aberto: 'bg-slate-500/20 text-slate-300',
  pago: 'bg-emerald-500/20 text-emerald-300',
  atrasado: 'bg-red-500/20 text-red-300',
  cancelado: 'bg-muted text-muted-foreground',
};

export default function AccountsPayableTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  // Filtro de mês: para contas já pagas, localiza pela data de pagamento
  // (paid_at) — não pela data de vencimento/lançamento (due_date). Contas
  // ainda em aberto/atrasadas não têm data de pagamento, então continuam
  // localizadas pelo vencimento, já que é a única data que têm.
  // 'todos' = sem filtro de mês; senão 'yyyy-MM'. Começa no mês atual.
  const [monthFilter, setMonthFilter] = useState<string>(() => format(new Date(), 'yyyy-MM'));
  const [searchDesc, setSearchDesc] = useState('');
  const [searchDescOpen, setSearchDescOpen] = useState(false);
  const [searchPartner, setSearchPartner] = useState('');
  const [searchPartnerOpen, setSearchPartnerOpen] = useState(false);
  const [searchProcess, setSearchProcess] = useState('');
  const [searchProcessOpen, setSearchProcessOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<AP | null>(null);
  const [payForm, setPayForm] = useState<{ paid_at: string; payment_method: string; file: File | null }>({ paid_at: format(new Date(), 'yyyy-MM-dd'), payment_method: '', file: null });
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [unpayTarget, setUnpayTarget] = useState<AP | null>(null);
  const [unpaying, setUnpaying] = useState(false);

  const { data: rows = [], refetch } = useQuery({
    queryKey: ['accounts_payable'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts_payable' as any)
        .select('*')
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AP[];
    },
  });

  const partners = useQuery({
    queryKey: ['ap-partners'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });
  const partnerMap = new Map((partners.data ?? []).map((p) => [p.id, p.name]));

  const quoteIds = Array.from(new Set(rows.map((r) => r.quote_id).filter(Boolean))) as string[];
  const shipmentIds = Array.from(new Set(rows.map((r) => r.shipment_id).filter(Boolean))) as string[];

  const quotesQ = useQuery({
    queryKey: ['ap-quotes', quoteIds.join(',')],
    enabled: quoteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('quotes').select('id, base_reference').in('id', quoteIds);
      return (data ?? []) as Array<{ id: string; base_reference: string | null }>;
    },
  });
  const shipmentsQ = useQuery({
    queryKey: ['ap-shipments', shipmentIds.join(',')],
    enabled: shipmentIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('shipments').select('id, reference_number').in('id', shipmentIds);
      return (data ?? []) as Array<{ id: string; reference_number: string | null }>;
    },
  });
  const quoteMap = new Map((quotesQ.data ?? []).map((q) => [q.id, q.base_reference]));
  const shipmentMap = new Map((shipmentsQ.data ?? []).map((s) => [s.id, s.reference_number]));

  // Câmbio de cada linha tem que ser o digitado pelo usuário na hora de
  // criar a DN (debit_notes.exchange_rate), não a cotação do dia — senão o
  // valor em R$ exibido muda todo dia mesmo pra pagamentos já fechados.
  const debitNoteIds = Array.from(new Set(rows.map((r) => r.debit_note_id).filter(Boolean))) as string[];
  const dnRatesQ = useQuery({
    queryKey: ['ap-dn-rates', debitNoteIds.join(',')],
    enabled: debitNoteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('debit_notes' as any).select('id, exchange_rate').in('id', debitNoteIds);
      return (data ?? []) as unknown as Array<{ id: string; exchange_rate: number | null }>;
    },
  });
  const dnRateMap = new Map((dnRatesQ.data ?? []).map((d) => [d.id, d.exchange_rate]));

  const today = startOfDay(new Date());
  const enriched = rows.map((r) => {
    const due = parseISO(r.due_date);
    const overdue = r.status === 'aberto' && isBefore(due, today);
    return { ...r, status: overdue ? ('atrasado' as const) : r.status };
  });

  const filtered = enriched.filter((r) => {
    if (statusFilter !== 'todos' && r.status !== statusFilter) return false;
    if (searchDesc && !r.description?.toLowerCase().includes(searchDesc.toLowerCase())) return false;
    if (searchPartner) {
      const name = r.partner_id ? partnerMap.get(r.partner_id) ?? '' : '';
      if (!name.toLowerCase().includes(searchPartner.toLowerCase())) return false;
    }
    if (searchProcess) {
      const ref = (r.shipment_id ? shipmentMap.get(r.shipment_id) : null) || (r.quote_id ? quoteMap.get(r.quote_id) : null) || '';
      if (!ref.toLowerCase().includes(searchProcess.toLowerCase())) return false;
    }
    if (monthFilter && monthFilter !== 'todos') {
      const relevant = r.status === 'pago' ? r.paid_at : r.due_date;
      if (!relevant || relevant.slice(0, 7) !== monthFilter) return false;
    }
    return true;
  });

  // Opções do seletor de mês: janela de 12 meses atrás até 2 à frente, mais
  // qualquer mês que já tenha lançamento (pra nunca esconder dado antigo).
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    const base = new Date();
    for (let i = -2; i <= 12; i++) set.add(format(addMonths(base, -i), 'yyyy-MM'));
    for (const r of rows) {
      const d = r.status === 'pago' ? r.paid_at : r.due_date;
      if (d) set.add(d.slice(0, 7));
    }
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((ym) => {
        const label = format(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1), 'MMMM/yyyy', { locale: ptBR });
        return { value: ym, label: label.charAt(0).toUpperCase() + label.slice(1) };
      });
  }, [rows]);

  // Os KPIs somam linhas em moedas diferentes (USD, EUR, BRL) — sem converter
  // pra uma moeda comum antes de somar, o total exibido como "R$" na verdade
  // misturava valores de moedas diferentes como se fossem a mesma coisa.
  const { usdBrl, eurBrl } = useExchangeRate();
  // Taxa efetiva de uma linha: a digitada pelo usuário na DN, se houver; senão
  // (conta manual, sem DN) cai pra cotação do dia como estimativa.
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
    let vencidos = 0, aVencer = 0, pagos = 0, aberto = 0;
    for (const r of enriched) {
      const amt = toBRL(Number(r.amount) || 0, r.currency, r.debit_note_id);
      if (r.status === 'pago') pagos += amt;
      else if (r.status === 'atrasado') vencidos += amt;
      else if (r.status === 'aberto') {
        aberto += amt;
        if (isBefore(parseISO(r.due_date), in7)) aVencer += amt;
      }
    }
    return { vencidos, aVencer, pagos, aberto };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, today, usdBrl, eurBrl, dnRateMap]);

  async function markPaid() {
    if (!payTarget) return;
    let receipt_url: string | null = null;
    if (payForm.file) {
      setUploadingReceipt(true);
      const path = `${payTarget.company_id}/receipts/${payTarget.id}/${Date.now()}_${sanitizeStorageFileName(payForm.file.name)}`;
      const { error: upErr } = await supabase.storage.from(DOCS_BUCKET).upload(path, payForm.file);
      setUploadingReceipt(false);
      if (upErr) return toast.error('Erro ao anexar comprovante', { description: upErr.message });
      receipt_url = path;
    }
    const { error } = await supabase
      .from('accounts_payable' as any)
      .update({
        status: 'pago',
        paid_at: payForm.paid_at,
        payment_method: payForm.payment_method || null,
        ...(receipt_url ? { receipt_url } : {}),
      })
      .eq('id', payTarget.id);
    if (error) return toast.error('Erro ao registrar pagamento', { description: error.message });

    if (payTarget.debit_note_id) {
      await supabase.from('debit_notes' as any).update({ status: 'paga' }).eq('id', payTarget.debit_note_id);
      // Trava as taxas que foram enviadas nessa DN — depois de paga, não
      // podem mais ser reabertas/editadas na aba Taxas. Se o fornecedor
      // mandar uma cobrança nova, o usuário cadastra outra taxa em vez de
      // mexer nesta.
      await supabase.from('quote_charges' as any)
        .update({ buy_paid_at: payForm.paid_at })
        .eq('sent_in_debit_note_id', payTarget.debit_note_id);
      qc.invalidateQueries({ queryKey: ['quote-charges'] });
    }

    toast.success('Pagamento registrado');
    setPayTarget(null);
    refetch();
    qc.invalidateQueries({ queryKey: ['debit_notes'] });
  }

  // Desfaz um pagamento já registrado — volta a conta pra "Em aberto" e, se
  // vier de uma DN, reabre a DN (status 'aprovada') e libera as taxas presas
  // nela (buy_paid_at) pra edição de novo na aba Taxas.
  async function unpay() {
    if (!unpayTarget) return;
    setUnpaying(true);
    const { error } = await supabase
      .from('accounts_payable' as any)
      .update({ status: 'aberto', paid_at: null, payment_method: null, receipt_url: null })
      .eq('id', unpayTarget.id);
    if (error) {
      setUnpaying(false);
      return toast.error('Erro ao desfazer pagamento', { description: error.message });
    }

    if (unpayTarget.debit_note_id) {
      await supabase.from('debit_notes' as any).update({ status: 'aprovada' }).eq('id', unpayTarget.debit_note_id);
      await supabase.from('quote_charges' as any)
        .update({ buy_paid_at: null })
        .eq('sent_in_debit_note_id', unpayTarget.debit_note_id);
      qc.invalidateQueries({ queryKey: ['quote-charges'] });
      qc.invalidateQueries({ queryKey: ['debit_notes'] });
    }

    setUnpaying(false);
    toast.success('Pagamento desfeito — conta voltou para "Em aberto"');
    setUnpayTarget(null);
    refetch();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Kpi title="A vencer (7d)" value={kpis.aVencer} icon={<CalendarClock className="w-4 h-4" />} tone="amber" />
        <Kpi title="Vencidos" value={kpis.vencidos} icon={<AlertTriangle className="w-4 h-4" />} tone="red" />
        <Kpi title="Em aberto" value={kpis.aberto} icon={<Wallet className="w-4 h-4" />} tone="slate" />
        <Kpi title="Pagos" value={kpis.pagos} icon={<CheckCircle className="w-4 h-4" />} tone="emerald" />
      </div>

      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Valores a Pagar</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-44" title="Filtra pagos pela data de pagamento; em aberto/atrasados pelo vencimento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os meses</SelectItem>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="aberto">Em aberto</SelectItem>
                <SelectItem value="atrasado">Atrasados</SelectItem>
                <SelectItem value="pago">Pagos</SelectItem>
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
                      Fornecedor
                      <ColumnSearch value={searchPartner} onChange={setSearchPartner} open={searchPartnerOpen} onOpenChange={setSearchPartnerOpen} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1.5">
                      Processo
                      <ColumnSearch value={searchProcess} onChange={setSearchProcess} open={searchProcessOpen} onOpenChange={setSearchProcessOpen} />
                    </div>
                  </TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Pago em</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs uppercase text-muted-foreground">{r.source}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell>{r.partner_id ? partnerMap.get(r.partner_id) ?? '—' : '—'}</TableCell>
                    <TableCell>
                      {r.shipment_id && shipmentMap.get(r.shipment_id) ? (
                        <Link to={`/shipments?open=${r.shipment_id}`} className="text-primary hover:underline font-mono text-xs">
                          {shipmentMap.get(r.shipment_id)}
                        </Link>
                      ) : r.quote_id && quoteMap.get(r.quote_id) ? (
                        <Link to={`/quotes?open=${r.quote_id}`} className="text-primary hover:underline font-mono text-xs">
                          {quoteMap.get(r.quote_id)}
                        </Link>
                      ) : (
                        <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">Sem vínculo</Badge>
                      )}
                    </TableCell>
                    <TableCell>{format(parseISO(r.due_date), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>
                      {r.paid_at ? (
                        <span className="text-emerald-300">{format(parseISO(r.paid_at), 'dd/MM/yyyy')}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{r.currency} {Number(r.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      {r.currency && r.currency.toUpperCase() !== 'BRL' && (
                        <div className="text-[10px] text-muted-foreground font-normal">
                          câmbio {rateFor(r.currency, r.debit_note_id).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                          {' = R$ '}{toBRL(Number(r.amount), r.currency, r.debit_note_id).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      )}
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
                        {r.status !== 'pago' && r.status !== 'cancelado' && (
                          <Button size="sm" variant="outline" onClick={() => { setPayTarget(r); setPayForm({ paid_at: format(new Date(), 'yyyy-MM-dd'), payment_method: '', file: null }); }}>
                            Pagar
                          </Button>
                        )}
                        {r.status === 'pago' && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setUnpayTarget(r)}>
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

      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
          </DialogHeader>
          {payTarget && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {payTarget.description} — {payTarget.currency} {Number(payTarget.amount).toFixed(2)}
              </div>
              <div>
                <Label>Data do pagamento</Label>
                <Input type="date" value={payForm.paid_at} onChange={(e) => setPayForm({ ...payForm, paid_at: e.target.value })} />
              </div>
              <div>
                <Label>Forma de pagamento</Label>
                <Input placeholder="Ex: TED, Boleto, PIX" value={payForm.payment_method} onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })} />
              </div>
              <div>
                <Label>Comprovante (opcional)</Label>
                <Input type="file" accept="application/pdf,image/*" onChange={(e) => setPayForm({ ...payForm, file: e.target.files?.[0] ?? null })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayTarget(null)} disabled={uploadingReceipt}>Cancelar</Button>
            <Button onClick={markPaid} disabled={uploadingReceipt}>{uploadingReceipt ? 'Enviando…' : 'Confirmar pagamento'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!unpayTarget} onOpenChange={(o) => !unpaying && !o && setUnpayTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer este pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta volta para "Em aberto" e o registro do pagamento (data, forma, comprovante) é apagado.
              {unpayTarget?.debit_note_id && ' A Debit Note vinculada volta a ficar "Aprovada" e a taxa correspondente é liberada de novo na aba Taxas.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unpaying}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={unpay} disabled={unpaying}>
              {unpaying ? 'Desfazendo…' : 'Sim, desfazer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kpi({ title, value, icon, tone }: { title: string; value: number; icon: React.ReactNode; tone: string }) {
  const toneMap: Record<string, string> = {
    amber: 'text-amber-400',
    red: 'text-red-400',
    emerald: 'text-emerald-400',
    slate: 'text-slate-300',
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
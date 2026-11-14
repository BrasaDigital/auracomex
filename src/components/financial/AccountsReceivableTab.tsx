import { formatMoney } from '@/lib/money';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { CheckCircle, Wallet, AlertTriangle, CalendarClock, Paperclip, Undo2, FileText, Ban, Download } from 'lucide-react';
import { format, isBefore, startOfDay, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { DOCS_BUCKET, openSignedDoc } from '@/lib/storage';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { ColumnSearch } from '@/components/shared/ColumnSearch';
import { exportRowsToXlsx, ymdToDate } from '@/lib/exportXlsx';
import { MonthRangeSelect, currentMonthRange, monthInRange, monthRangeLabel } from './MonthSelect';
import { ClientDebitNotePdfDialog } from '@/components/quotes/ClientDebitNotePdfDialog';
import { GenerateClientNdDialog, type ClientDnCharge } from '@/components/quotes/ClientDebitNotesTab';
import { cancelClientDn } from '@/lib/debitNotes';
import { useAuth } from '@/contexts/AuthContext';

type AR = {
  id: string;
  source: string;
  debit_note_id: string | null;
  quote_charge_id?: string | null;
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
  aberto: 'bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/30',
  recebido: 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30',
  atrasado: 'bg-red-100 text-red-800 border border-red-300 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30',
  cancelado: 'bg-muted text-muted-foreground border border-border',
};
const SOURCE_LABEL: Record<string, string> = {
  debit_note: 'Nota de Débito',
  manual: 'Manual',
  storage_fee: 'Rebate de Armazenagem',
};

export default function AccountsReceivableTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [pdfTarget, setPdfTarget] = useState<AR | null>(null);
  const [ndGen, setNdGen] = useState<{ row: AR; charges: ClientDnCharge[] } | null>(null);
  const [createdNd, setCreatedNd] = useState<{ id: string; companyId: string; quoteId: string } | null>(null);
  const [inactivateTarget, setInactivateTarget] = useState<AR | null>(null);
  const [inactivating, setInactivating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  // Contas inativas (canceladas) ficam ocultas, a não ser que a caixa seja marcada ou o filtro seja "Cancelados".
  const [showInactive, setShowInactive] = useState(false);
  // Filtro de mês: para contas já recebidas, localiza pela data de
  // recebimento (received_at) — não pela data de vencimento/lançamento.
  // Contas ainda em aberto/atrasadas não têm data de recebimento, então
  // continuam localizadas pelo vencimento.
  const [monthRange, setMonthRange] = useState(() => currentMonthRange());
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

  // Busca por coluna + mês: é o "recorte" da lista, e também o que os cartões do mês somam.
  const inScope = (r: (typeof enriched)[number]) => {
    if (searchDesc && !r.description?.toLowerCase().includes(searchDesc.toLowerCase())) return false;
    if (searchClient) {
      const name = r.client_id ? clientMap.get(r.client_id) ?? '' : '';
      if (!name.toLowerCase().includes(searchClient.toLowerCase())) return false;
    }
    if (searchProcess) {
      const ref = (r.quote_id ? quoteMap.get(r.quote_id) : null) || '';
      if (!ref.toLowerCase().includes(searchProcess.toLowerCase())) return false;
    }
    if (monthRange.from !== 'todos') {
      const relevant = r.status === 'recebido' ? r.received_at : r.due_date;
      if (!monthInRange(relevant, monthRange)) return false;
    }
    return true;
  };

  const filtered = enriched.filter((r) => {
    if (statusFilter !== 'todos' && r.status !== statusFilter) return false;
    if (!showInactive && statusFilter !== 'cancelado' && r.status === 'cancelado') return false;
    return inScope(r);
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

  // Cartões: os do mês somam o que está no mês escolhido (e na busca), sem olhar o filtro de
  // status; inativas (canceladas) nunca entram. "A receber" = tudo que ainda não foi pago
  // (em aberto + atrasado). O cartão Global soma o a receber de todos os meses.
  const kpis = useMemo(() => {
    let aReceber = 0, vencidos = 0, recebidos = 0, global = 0;
    for (const r of enriched) {
      if (r.status === 'cancelado') continue;
      const amt = toBRL(Number(r.amount) || 0, r.currency, r.debit_note_id);
      if (r.status !== 'recebido') global += amt;
      if (!inScope(r)) continue;
      if (r.status === 'recebido') recebidos += toBRL(Number(r.received_amount ?? r.amount) || 0, r.currency, r.debit_note_id);
      else {
        aReceber += amt;
        if (r.status === 'atrasado') vencidos += amt;
      }
    }
    return { aReceber, vencidos, recebidos, global };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, monthRange, searchDesc, searchClient, searchProcess, usdBrl, eurBrl, dnRateMap]);
  const periodo = monthRangeLabel(monthRange);

  async function exportXlsx() {
    if (filtered.length === 0) return toast.error('Nada para exportar com os filtros atuais');
    let total = 0;
    const out = filtered.map((r) => {
      const shown = Number(r.status === 'recebido' ? (r.received_amount ?? r.amount) : r.amount) || 0;
      const brl = toBRL(shown, r.currency, r.debit_note_id);
      if (r.status !== 'cancelado') total += brl;
      const cur = (r.currency || 'BRL').toUpperCase();
      return {
        origem: r.quote_charge_id ? 'Taxa conferida' : (SOURCE_LABEL[r.source] || r.source),
        descricao: r.description ?? '',
        cliente: r.client_id ? clientMap.get(r.client_id) ?? '' : '',
        processo: (r.quote_id && quoteMap.get(r.quote_id)) || '',
        vencimento: ymdToDate(r.due_date),
        recebido_em: ymdToDate(r.received_at),
        moeda: cur,
        valor: shown,
        cambio: cur === 'BRL' ? null : rateFor(r.currency, r.debit_note_id),
        valor_brl: brl,
        status: STATUS_LABEL[r.status] ?? r.status,
      };
    });
    try {
      await exportRowsToXlsx({
        filename: `receita-por-processo-${format(new Date(), 'yyyy-MM-dd')}.xlsx`,
        sheetName: 'Receita por Processo',
        columns: [
          { header: 'Origem', key: 'origem', width: 16 },
          { header: 'Descrição', key: 'descricao', width: 40 },
          { header: 'Cliente', key: 'cliente', width: 28 },
          { header: 'Processo', key: 'processo', width: 16 },
          { header: 'Vencimento', key: 'vencimento', width: 13, kind: 'date' },
          { header: 'Recebido em', key: 'recebido_em', width: 13, kind: 'date' },
          { header: 'Moeda', key: 'moeda', width: 8 },
          { header: 'Valor', key: 'valor', width: 14, kind: 'money' },
          { header: 'Câmbio', key: 'cambio', width: 10, kind: 'rate' },
          { header: 'Valor (R$)', key: 'valor_brl', width: 14, kind: 'money' },
          { header: 'Status', key: 'status', width: 12 },
        ],
        rows: out,
        totalRow: { descricao: 'TOTAL (sem canceladas)', valor_brl: total },
      });
    } catch (e: any) {
      toast.error('Erro ao exportar', { description: e?.message });
    }
  }

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
    qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
  }

  // Taxas conferidas na aba Taxas ficam aqui como receita avulsa, sem ND. "Gerar ND" reúne as
  // taxas conferidas (ainda não recebidas) do mesmo processo e cliente numa ND só.
  async function openGenerateNd(r: AR) {
    if (!r.quote_id || !r.client_id) return toast.error('Conta sem processo ou cliente vinculado.');
    const { data: ch, error } = await supabase
      .from('quote_charges' as any)
      .select('id, description, currency, leg, exchange_rate, sell_confirmed_amount')
      .eq('quote_id', r.quote_id).eq('partner_id', r.client_id)
      .not('sell_confirmed_at', 'is', null).is('sent_in_debit_note_id', null);
    if (error) return toast.error('Erro ao buscar as taxas', { description: error.message });
    const ids = ((ch ?? []) as any[]).map((c) => c.id);
    const { data: ars } = ids.length
      ? await supabase.from('accounts_receivable' as any).select('quote_charge_id, status').in('quote_charge_id', ids)
      : { data: [] as any[] };
    const open = new Set(((ars ?? []) as any[]).filter((a) => a.status !== 'recebido' && a.status !== 'cancelado').map((a) => a.quote_charge_id));
    const charges: ClientDnCharge[] = ((ch ?? []) as any[]).filter((c) => open.has(c.id)).map((c) => ({
      id: c.id, description: c.description, sell_amount: Number(c.sell_confirmed_amount) || 0,
      currency: c.currency || 'USD', leg: c.leg, exchange_rate: c.exchange_rate,
    }));
    if (charges.length === 0) return toast.error('Não há taxas conferidas e em aberto para gerar a ND.');
    setNdGen({ row: r, charges });
  }

  // Inativa a conta (status "Cancelado"). Se veio de uma ND, cancela a ND também
  // (fica no histórico) e libera as taxas de venda pra irem numa ND nova.
  async function inactivate() {
    if (!inactivateTarget) return;
    setInactivating(true);
    let errMsg: string | null = null;
    if (inactivateTarget.debit_note_id) {
      const res = await cancelClientDn({
        dnId: inactivateTarget.debit_note_id,
        companyId: inactivateTarget.company_id,
        quoteId: inactivateTarget.quote_id,
        userId: user?.id,
      });
      if (res.ok === false) errMsg = res.error;
    } else {
      const { error } = await supabase.from('accounts_receivable' as any).update({ status: 'cancelado' }).eq('id', inactivateTarget.id);
      if (error) errMsg = error.message;
    }
    setInactivating(false);
    if (errMsg) return toast.error('Erro ao inativar', { description: errMsg });
    toast.success(inactivateTarget.debit_note_id ? 'ND inativada — taxas liberadas para uma nova ND' : 'Conta inativada');
    setInactivateTarget(null);
    refetch();
    qc.invalidateQueries({ queryKey: ['client_debit_notes'] });
    qc.invalidateQueries({ queryKey: ['quote-charges'] });
    qc.invalidateQueries({ queryKey: ['quote_sell_charges'] });
  }

  // Reativa uma conta manual inativada. Conta de ND cancelada não volta: as taxas
  // já foram liberadas, então o caminho é emitir uma ND nova.
  async function reactivate(r: AR) {
    const { error } = await supabase.from('accounts_receivable' as any).update({ status: 'aberto' }).eq('id', r.id);
    if (error) return toast.error('Erro ao reativar', { description: error.message });
    toast.success('Conta reativada');
    refetch();
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
    qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
  }

  const semNd = rows.filter((r) => r.quote_charge_id && !r.debit_note_id && r.status === 'aberto');

  return (
    <div className="space-y-4">
      {semNd.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {semNd.length} taxa(s) conferida(s) ainda sem ND — use "Gerar ND" na linha para emitir e enviar ao cliente.
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Kpi title={`A receber (${periodo})`} value={kpis.aReceber} icon={<CalendarClock className="w-4 h-4" />} tone="amber" />
        <Kpi title={`Atrasados (${periodo})`} value={kpis.vencidos} icon={<AlertTriangle className="w-4 h-4" />} tone="red" />
        <Kpi title={`Recebidos (${periodo})`} value={kpis.recebidos} icon={<CheckCircle className="w-4 h-4" />} tone="emerald" />
        <Kpi title="A receber — global (todos os meses)" value={kpis.global} icon={<Wallet className="w-4 h-4" />} tone="slate" />
      </div>

      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Valores a Receber</CardTitle>
          <div className="flex items-center gap-2">
            <MonthRangeSelect
              value={monthRange}
              onChange={setMonthRange}
              extraMonths={rows.map((r) => (r.status === 'recebido' ? r.received_at : r.due_date)).filter(Boolean).map((d) => (d as string).slice(0, 7))}
              title="Filtra recebidos pela data de recebimento; em aberto/atrasados pelo vencimento"
            />
            <Button variant="outline" size="sm" onClick={exportXlsx} title="Exporta para Excel o que está filtrado na tela">
              <Download className="w-4 h-4 mr-1" /> Exportar
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap">
              <Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(v === true)} />
              Mostrar inativas
            </label>
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
                    <TableCell className="text-xs text-muted-foreground">{r.quote_charge_id ? 'Taxa conferida' : (SOURCE_LABEL[r.source] || r.source)}</TableCell>
                    <TableCell title={r.description}>{r.description}</TableCell>
                    <TableCell>{r.client_id ? clientMap.get(r.client_id) ?? '—' : '—'}</TableCell>
                    <TableCell>
                      {r.quote_id && quoteMap.get(r.quote_id) ? (
                        <Link to={`/quotes?open=${r.quote_id}&tab=charges`} className="text-primary hover:underline font-mono text-xs">
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
                        return <>{formatMoney(launched, r.currency)}</>;
                      })()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.status === 'recebido' && r.received_amount != null && Number(r.received_amount) !== Number(r.amount) ? (
                        <span className={Number(r.received_amount) < Number(r.amount) ? 'text-amber-500' : 'text-emerald-500'}>
                          {formatMoney(Number(r.received_amount), r.currency)}
                        </span>
                      ) : (
                        <>{formatMoney(Number(r.status === 'recebido' ? (r.received_amount ?? r.amount) : r.amount), r.currency)}</>
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
                      {r.quote_charge_id && !r.debit_note_id && r.status !== 'recebido' && r.status !== 'cancelado' && (
                        <Badge variant="outline" className="ml-1.5 bg-amber-500/15 text-amber-600 border-amber-500/40">Conferida · sem ND</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {r.quote_charge_id && !r.debit_note_id && r.status !== 'recebido' && r.status !== 'cancelado' && (
                          <Button size="sm" variant="outline" onClick={() => openGenerateNd(r)} title="Gerar a ND com as taxas conferidas deste processo e cliente">
                            Gerar ND
                          </Button>
                        )}
                        {r.debit_note_id && r.quote_id && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver PDF da ND" onClick={() => setPdfTarget(r)}>
                            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                        )}
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
                        {r.status !== 'recebido' && r.status !== 'cancelado' && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground" title="Inativar (cancelar) esta conta" onClick={() => setInactivateTarget(r)}>
                            <Ban className="w-3.5 h-3.5 mr-1" /> Inativar
                          </Button>
                        )}
                        {r.status === 'cancelado' && !r.debit_note_id && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => reactivate(r)}>
                            <Undo2 className="w-3.5 h-3.5 mr-1" /> Reativar
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
                {target.description} — previsto {formatMoney(Number(target.amount), target.currency)}
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
                    Diferença em relação ao previsto: {formatMoney(Number(form.received_amount) - Number(target.amount), target.currency, { sign: true })}
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

      {ndGen && ndGen.row.quote_id && ndGen.row.client_id && (
        <GenerateClientNdDialog
          open
          onClose={() => setNdGen(null)}
          quoteId={ndGen.row.quote_id}
          companyId={ndGen.row.company_id}
          clientId={ndGen.row.client_id}
          charges={ndGen.charges}
          onCreated={(dnId) => {
            const row = ndGen.row;
            setNdGen(null);
            setCreatedNd({ id: dnId, companyId: row.company_id, quoteId: row.quote_id! });
            refetch();
            qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
          }}
        />
      )}

      {/* Logo depois de emitir, abre o PDF da ND — que já é guardado sozinho em Documentos */}
      {createdNd && (
        <ClientDebitNotePdfDialog
          open
          onClose={() => setCreatedNd(null)}
          debitNoteId={createdNd.id}
          companyId={createdNd.companyId}
          quoteId={createdNd.quoteId}
        />
      )}

      {pdfTarget?.debit_note_id && pdfTarget.quote_id && (
        <ClientDebitNotePdfDialog
          open
          onClose={() => setPdfTarget(null)}
          debitNoteId={pdfTarget.debit_note_id}
          companyId={pdfTarget.company_id}
          quoteId={pdfTarget.quote_id}
        />
      )}

      <AlertDialog open={!!inactivateTarget} onOpenChange={(o) => !inactivating && !o && setInactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar esta conta?</AlertDialogTitle>
            <AlertDialogDescription>
              {inactivateTarget?.debit_note_id
                ? 'A Nota de Débito fica no histórico como cancelada, a conta sai do que está a receber e as taxas de venda voltam a ficar livres para uma nova ND.'
                : 'A conta fica como "Cancelado" e sai do que está a receber. Dá para reativar depois.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={inactivating}>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={inactivate} disabled={inactivating}>
              {inactivating ? 'Inativando…' : 'Sim, inativar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
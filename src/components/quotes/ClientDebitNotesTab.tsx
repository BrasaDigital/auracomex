import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Trash2, FileText, CheckCircle, XCircle, DollarSign } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ClientDebitNotePdfDialog } from './ClientDebitNotePdfDialog';
import { cancelClientDn, nextClientDnNumber, DEFAULT_CLIENT_ND_NOTES } from '@/lib/debitNotes';
import { useExchangeRate } from '@/hooks/useExchangeRate';

type DN = {
  id: string;
  dn_number: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total_amount: number;
  status: string;
  client_id: string | null;
  bank_account_id: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  payment_reference: string | null;
  notes: string | null;
};

type Charge = { id: string; description: string; sell_amount: number; currency: string; leg: string; exchange_rate?: number | null };
export type { Charge as ClientDnCharge };

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Rascunho', emitida: 'Emitida', paga: 'Paga', cancelada: 'Cancelada',
  em_conferencia: 'Rascunho', aprovada: 'Emitida', rejeitada: 'Cancelada',
};
const STATUS_COLOR: Record<string, string> = {
  pendente: 'bg-slate-500/20 text-slate-300',
  emitida: 'bg-primary/20 text-primary',
  paga: 'bg-emerald-500/20 text-emerald-300',
  cancelada: 'bg-red-500/20 text-red-300',
};

interface Props {
  quoteId: string;
  companyId: string;
  clientId: string | null;
  /** Modo somente leitura — usado na aba Documentos: lista informativa, sem
   *  nenhum botão de ação (nem "Emitir Nova DN", nem os botões por linha). */
  readOnly?: boolean;
  /** Esconde o botão "Emitir Nova DN" (a DN do cliente nasce em "Gerar ND", na aba Taxas). */
  hideCreate?: boolean;
}

export function ClientDebitNotesTab({ quoteId, companyId, clientId, readOnly, hideCreate }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [pdfDn, setPdfDn] = useState<DN | null>(null);
  const [payDn, setPayDn] = useState<DN | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const { data: notes = [] } = useQuery({
    queryKey: ['client_debit_notes', quoteId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('debit_notes' as any) as any)
        .select('*')
        .eq('quote_id', quoteId)
        .eq('kind', 'client_outgoing')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DN[];
    },
  });

  const { data: charges = [] } = useQuery({
    queryKey: ['quote_sell_charges', quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_charges')
        .select('id, description, sell_amount, currency, leg, exchange_rate, sent_in_debit_note_id, is_auto_tax')
        .eq('quote_id', quoteId);
      if (error) throw error;
      // Taxas já enviadas numa ND anterior ficam de fora — pra reentrar numa
      // ND nova é preciso reabrir (excluir a ND antiga) primeiro.
      return ((data ?? []) as any[]).filter((c: any) => !c.is_auto_tax && Number(c.sell_amount) > 0 && !c.sent_in_debit_note_id) as Charge[];
    },
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['company_bank_accounts', companyId],
    queryFn: async () => {
      const { data } = await supabase.from('company_bank_accounts' as any)
        .select('*').eq('company_id', companyId).eq('active', true);
      return (data ?? []) as any[];
    },
  });


  async function markPaid() {
    if (!payDn) return;
    const paid_amount = Number((document.getElementById('paid_amount_input') as HTMLInputElement)?.value || payDn.total_amount);
    const paid_at = (document.getElementById('paid_at_input') as HTMLInputElement)?.value || format(new Date(), 'yyyy-MM-dd');
    const payment_reference = (document.getElementById('paid_ref_input') as HTMLInputElement)?.value || null;
    const { error } = await supabase.from('debit_notes' as any).update({
      status: 'paga', paid_amount, paid_at, payment_reference,
    }).eq('id', payDn.id);
    if (error) return toast.error(error.message);
    await supabase.from('accounts_receivable' as any).update({
      status: 'recebido', received_at: paid_at, received_amount: paid_amount, receipt_reference: payment_reference,
    }).eq('debit_note_id', payDn.id);
    toast.success('DN marcada como paga');
    setPayDn(null);
    qc.invalidateQueries({ queryKey: ['client_debit_notes', quoteId] });
    qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
  }

  async function cancelDn(id: string) {
    setCancelling(true);
    const result = await cancelClientDn({ dnId: id, companyId, quoteId, userId: user?.id });
    setCancelling(false);
    if (result.ok === false) return toast.error('Erro ao cancelar', { description: result.error });
    toast.success('ND cancelada — taxas liberadas para uma nova ND');
    setConfirmCancelId(null);
    qc.invalidateQueries({ queryKey: ['client_debit_notes', quoteId] });
    qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
    qc.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
    qc.invalidateQueries({ queryKey: ['quote_sell_charges', quoteId] });
  }

  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="w-4 h-4" /> Notas de Débito ao Cliente
        </CardTitle>
        {!readOnly && !hideCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!clientId}>
            <Plus className="w-4 h-4 mr-1" /> Emitir Nova DN
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!clientId && !hideCreate && <p className="text-sm text-amber-400 mb-3">Defina o cliente na aba Geral antes de emitir DN.</p>}
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma DN emitida.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                {!readOnly && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {notes.map(dn => (
                <TableRow key={dn.id}>
                  <TableCell className="font-medium">{dn.dn_number}</TableCell>
                  <TableCell>{format(parseISO(dn.issue_date), 'dd/MM/yyyy')}</TableCell>
                  <TableCell>{dn.due_date ? format(parseISO(dn.due_date), 'dd/MM/yyyy') : '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">{dn.currency} {Number(dn.total_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  <TableCell><Badge className={STATUS_COLOR[dn.status] || 'bg-slate-500/20'} variant="secondary">{STATUS_LABEL[dn.status] || dn.status}</Badge></TableCell>
                  {!readOnly && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" title="Ver PDF" onClick={() => setPdfDn(dn)}><FileText className="w-4 h-4" /></Button>
                      {dn.status !== 'paga' && dn.status !== 'cancelada' && (
                        <>
                          <Button variant="ghost" size="icon" title="Marcar como paga" onClick={() => setPayDn(dn)}><CheckCircle className="w-4 h-4 text-emerald-400" /></Button>
                          <Button variant="ghost" size="icon" title="Cancelar ND" onClick={() => setConfirmCancelId(dn.id)}><XCircle className="w-4 h-4 text-amber-400" /></Button>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {createOpen && (
        <CreateClientDnDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          quoteId={quoteId}
          companyId={companyId}
          clientId={clientId!}
          charges={charges}
          bankAccounts={bankAccounts}
          userId={user?.id || null}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['client_debit_notes', quoteId] });
            qc.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
          }}
        />
      )}

      {pdfDn && (
        <ClientDebitNotePdfDialog
          open={!!pdfDn}
          onClose={() => setPdfDn(null)}
          debitNoteId={pdfDn.id}
          companyId={companyId}
          quoteId={quoteId}
        />
      )}

      <Dialog open={!!payDn} onOpenChange={(o) => !o && setPayDn(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Marcar DN como paga</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Data do pagamento</Label><Input id="paid_at_input" type="date" defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
            <div><Label>Valor recebido ({payDn?.currency})</Label><Input id="paid_amount_input" type="number" step="0.01" defaultValue={payDn?.total_amount} /></div>
            <div><Label>Referência (TED/PIX/SWIFT)</Label><Input id="paid_ref_input" placeholder="Opcional" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDn(null)}>Cancelar</Button>
            <Button onClick={markPaid}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmCancelId} onOpenChange={(o) => !cancelling && !o && setConfirmCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta ND?</AlertDialogTitle>
            <AlertDialogDescription>
              A ND fica no histórico como cancelada, a conta a receber vinculada também é cancelada no
              Financeiro e as taxas que estavam nela voltam a ficar livres para uma nova ND. ND já paga
              não pode ser cancelada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmCancelId && cancelDn(confirmCancelId)} disabled={cancelling}>
              {cancelling ? 'Cancelando…' : 'Cancelar ND'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/**
 * Wrapper de "Gerar ND" acionado a partir do cabeçalho de cada empresa na
 * aba Taxas (lado Venda) — reaproveita o mesmo formulário de emissão de DN
 * ao Cliente (câmbio, conta bancária, seleção de taxas), só que já escopado
 * às taxas daquele grupo/empresa específica.
 */
export function GenerateClientNdDialog({
  open,
  onClose,
  quoteId,
  companyId,
  clientId,
  charges,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  companyId: string;
  clientId: string;
  charges: Charge[];
  onCreated?: (dnId: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['company_bank_accounts', companyId],
    queryFn: async () => {
      const { data } = await supabase.from('company_bank_accounts' as any)
        .select('*').eq('company_id', companyId).eq('active', true);
      return (data ?? []) as any[];
    },
    enabled: open,
  });

  if (!open) return null;

  return (
    <CreateClientDnDialog
      open={open}
      onClose={onClose}
      quoteId={quoteId}
      companyId={companyId}
      clientId={clientId}
      charges={charges}
      bankAccounts={bankAccounts}
      userId={user?.id || null}
      onCreated={(dnId) => {
        qc.invalidateQueries({ queryKey: ['client_debit_notes', quoteId] });
        qc.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
        qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
        onCreated?.(dnId);
      }}
    />
  );
}

function CreateClientDnDialog({
  open, onClose, quoteId, companyId, clientId, charges, bankAccounts, userId, onCreated,
}: {
  open: boolean; onClose: () => void; quoteId: string; companyId: string; clientId: string;
  charges: Charge[]; bankAccounts: any[]; userId: string | null; onCreated: (dnId: string) => void;
}) {
  // Moedas estrangeiras presentes nas taxas (sempre cobradas em BRL)
  const foreignCurrencies = useMemo(() => {
    const s = new Set<string>();
    for (const c of charges) if (c.currency !== 'BRL') s.add(c.currency);
    return Array.from(s);
  }, [charges]);

  const [selected, setSelected] = useState<Set<string>>(new Set(charges.map(c => c.id)));
  const [issueDate, setIssueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(new Date(Date.now() + 15 * 86400000), 'yyyy-MM-dd'));
  const [bankId, setBankId] = useState<string>('');
  const [notes, setNotes] = useState(DEFAULT_CLIENT_ND_NOTES);
  const [saving, setSaving] = useState(false);

  // Modo de câmbio
  const [rateMode, setRateMode] = useState<'single' | 'per_currency'>('single');
  const [singleRate, setSingleRate] = useState<string>('');
  const [ratesByCurrency, setRatesByCurrency] = useState<Record<string, string>>({});
  const { usdBrl, eurBrl } = useExchangeRate();

  // Câmbio sugerido de uma moeda: o que já foi digitado numa taxa dessa moeda
  // (aba Taxas) e, se não houver, a cotação do dia.
  function suggestedRate(cur: string): number | null {
    const fromCharge = charges.find(c => c.currency === cur && Number(c.exchange_rate) > 0);
    if (fromCharge) return Number(fromCharge.exchange_rate);
    if (cur === 'USD') return usdBrl || null;
    if (cur === 'EUR') return eurBrl || null;
    return null;
  }

  useEffect(() => {
    setSelected(new Set(charges.map(c => c.id)));
    const defaultBank = bankAccounts.find(b => b.currency === 'BRL' && b.is_default)
      || bankAccounts.find(b => b.currency === 'BRL');
    setBankId(defaultBank?.id || '');
    setRatesByCurrency(prev => {
      const next = { ...prev };
      for (const cur of foreignCurrencies) if (!next[cur]) { const r = suggestedRate(cur); if (r) next[cur] = String(r); }
      return next;
    });
    setSingleRate(prev => {
      if (prev) return prev;
      const r = foreignCurrencies.length ? suggestedRate(foreignCurrencies[0]) : null;
      return r ? String(r) : '';
    });
  }, [charges.length, bankAccounts.length, foreignCurrencies.join(','), usdBrl, eurBrl]);

  function rateFor(cur: string): number {
    if (cur === 'BRL') return 1;
    if (rateMode === 'single') return Number(singleRate) || 0;
    return Number(ratesByCurrency[cur]) || 0;
  }

  // Taxa que já tem câmbio próprio (digitado na aba Taxas) usa esse câmbio;
  // as demais usam o câmbio informado acima.
  function rateForRow(c: Charge): number {
    if (c.currency === 'BRL') return 1;
    if (Number(c.exchange_rate) > 0) return Number(c.exchange_rate);
    return rateFor(c.currency);
  }

  const rows = charges.map(c => {
    const rate = rateForRow(c);
    const brl = Number(c.sell_amount) * rate;
    return { ...c, rate, brl };
  });

  const totalBRL = rows.filter(r => selected.has(r.id)).reduce((s, r) => s + r.brl, 0);

  function toggle(id: string) {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  }

  async function submit() {
    if (selected.size === 0) return toast.error('Selecione ao menos uma taxa');
    if (!bankId) return toast.error('Selecione a conta bancária em BRL');
    // Validar câmbios (só das taxas selecionadas)
    for (const c of charges.filter(c => selected.has(c.id) && c.currency !== 'BRL')) {
      if (rateForRow(c) <= 0) return toast.error(`Informe a taxa de câmbio para ${c.currency}`);
    }
    setSaving(true);
    try {
      const dn_number = await nextClientDnNumber(quoteId);

      const firstForeign = charges.find(c => selected.has(c.id) && c.currency !== 'BRL');
      const headerRate = firstForeign ? rateForRow(firstForeign) || 1 : 1;

      const { data: dn, error: dErr } = await supabase.from('debit_notes' as any).insert({
        company_id: companyId,
        quote_id: quoteId,
        client_id: clientId,
        kind: 'client_outgoing',
        dn_number,
        issue_date: issueDate,
        due_date: dueDate,
        currency: 'BRL',
        exchange_rate: headerRate,
        total_amount: totalBRL,
        status: 'emitida',
        bank_account_id: bankId,
        notes,
        created_by: userId,
      }).select().single();
      if (dErr) throw dErr;

      const items = rows
        .filter(r => selected.has(r.id))
        .map(r => ({
          debit_note_id: (dn as any).id,
          quote_charge_id: r.id,
          description: r.description,
          charged_amount: r.brl,           // valor final em BRL
          quoted_amount: Number(r.sell_amount), // valor original na moeda origem
          currency: r.currency,             // moeda ORIGINAL (para rastreio no PDF)
          exchange_rate: r.rate,
        }));
      const { error: iErr } = await supabase.from('debit_note_items').insert(items as any);
      if (iErr) throw iErr;

      // Marca as taxas incluídas nesta ND — não podem mais ser excluídas
      // enquanto houver essa movimentação financeira vinculada.
      const includedChargeIds = rows.filter(r => selected.has(r.id)).map(r => r.id);
      if (includedChargeIds.length > 0) {
        await supabase.from('quote_charges' as any).update({ sent_in_debit_note_id: (dn as any).id }).in('id', includedChargeIds);
        // A conta da ND passa a representar o valor: tira as contas avulsas dessas taxas
        // (geradas ao Conferir) que ainda não foram recebidas.
        await supabase.from('accounts_receivable' as any).delete().in('quote_charge_id', includedChargeIds).neq('status', 'recebido');
      }

      // Cria Conta a Receber no Financeiro
      await supabase.from('accounts_receivable' as any).insert({
        company_id: companyId,
        source: 'debit_note',
        debit_note_id: (dn as any).id,
        quote_id: quoteId,
        client_id: clientId,
        bank_account_id: bankId,
        description: `DN ${dn_number}`,
        currency: 'BRL',
        amount: totalBRL,
        due_date: dueDate,
        status: 'aberto',
        created_by: userId,
      });

      toast.success(`DN ${dn_number} emitida`);
      onCreated((dn as any).id);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Emitir Nota de Débito ao Cliente</DialogTitle></DialogHeader>
        {charges.length === 0 ? (
          <p className="text-sm text-muted-foreground">Não há taxas de venda nesta cotação.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Emissão</Label><Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
              <div><Label>Vencimento</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
              <div>
                <Label>Conta bancária (BRL)</Label>
                <Select value={bankId} onValueChange={setBankId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {bankAccounts.filter(b => b.currency === 'BRL').map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_holder}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {foreignCurrencies.length > 0 && (
              <div className="border border-border rounded p-3 space-y-3 bg-muted/20">
                <div className="text-sm font-medium">Taxa de câmbio (cobrança em BRL)</div>
                <p className="text-xs text-muted-foreground">
                  Já vem preenchida com o câmbio digitado nas Taxas ou, se não houver, com a cotação do dia.
                  Taxas que têm câmbio próprio mantêm o delas (marcadas com "(taxa)" na tabela).
                </p>
                <RadioGroup
                  value={rateMode}
                  onValueChange={(v) => setRateMode(v as any)}
                  className="flex gap-6"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="single" id="rm_single" />
                    <Label htmlFor="rm_single" className="cursor-pointer">Mesma taxa para todas as moedas</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="per_currency" id="rm_per" />
                    <Label htmlFor="rm_per" className="cursor-pointer">Uma taxa por moeda</Label>
                  </div>
                </RadioGroup>
                {rateMode === 'single' ? (
                  <div className="max-w-xs">
                    <Label>Taxa (BRL por 1 unidade estrangeira)</Label>
                    <Input type="number" step="0.0001" value={singleRate} onChange={e => setSingleRate(e.target.value)} />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {foreignCurrencies.map(cur => (
                      <div key={cur}>
                        <Label>1 {cur} = ? BRL</Label>
                        <Input
                          type="number" step="0.0001"
                          value={ratesByCurrency[cur] ?? ''}
                          onChange={e => setRatesByCurrency(p => ({ ...p, [cur]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="border border-border rounded max-h-72 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor origem</TableHead>
                    <TableHead className="text-right">Câmbio</TableHead>
                    <TableHead className="text-right">Valor BRL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id}>
                      <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                      <TableCell>{r.description}</TableCell>
                      <TableCell className="text-right font-mono">{r.currency} {Number(r.sell_amount).toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        {r.currency === 'BRL' ? (
                          <span className="font-mono">—</span>
                        ) : (
                          <span className="font-mono" title={Number(r.exchange_rate) > 0 ? 'Câmbio digitado na taxa (aba Taxas)' : 'Câmbio informado acima'}>
                            {r.rate > 0 ? r.rate.toFixed(4) : '—'}{Number(r.exchange_rate) > 0 && <span className="text-xs text-muted-foreground"> (taxa)</span>}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">BRL {r.brl.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between items-center">
              <Textarea placeholder="Observações (opcional)" value={notes} onChange={e => setNotes(e.target.value)} className="max-w-md" />
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Total a cobrar</div>
                <div className="text-xl font-bold font-mono">BRL {totalBRL.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || charges.length === 0}>Emitir DN</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

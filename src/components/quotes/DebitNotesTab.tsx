import { removeChargeExpense } from '@/lib/chargeExpense';
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { openSignedDoc } from '@/lib/storage';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Trash2, Upload, CheckCircle, FileText, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { format, parseISO } from 'date-fns';
import { deleteSupplierDn } from '@/lib/debitNotes';
import { useExchangeRate } from '@/hooks/useExchangeRate';

type DebitNote = {
  id: string;
  dn_number: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  exchange_rate: number | null;
  total_amount: number;
  status: string;
  partner_id: string | null;
  file_url: string | null;
  notes: string | null;
};

type DebitNoteItem = {
  id: string;
  debit_note_id: string;
  quote_charge_id: string | null;
  description: string;
  quoted_amount: number | null;
  charged_amount: number;
  currency: string;
  variance: number | null;
  reason: string | null;
  reconciled: boolean;
};

type QuoteCharge = {
  id: string;
  description: string;
  amount: number; // buy_amount
  currency: string;
};

const CURRENCIES = ['BRL', 'USD', 'EUR', 'GBP', 'CNY'];
const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_conferencia: 'Em conferência',
  aprovada: 'Aprovada',
  rejeitada: 'Rejeitada',
  paga: 'Paga',
};
const STATUS_COLOR: Record<string, string> = {
  pendente: 'bg-slate-500/20 text-slate-300',
  em_conferencia: 'bg-amber-500/20 text-amber-300',
  aprovada: 'bg-emerald-500/20 text-emerald-300',
  rejeitada: 'bg-red-500/20 text-red-300',
  paga: 'bg-primary/20 text-primary',
};

interface DebitNotesTabProps {
  quoteId: string;
  companyId: string;
  partners: Array<{ id: string; name: string; partner_category?: string | null }>;
  /** Arquivo já anexado na aba Documentos (categoria "DN Fornecedor") — quando
   *  presente, abre o formulário de criação automaticamente com o arquivo
   *  pronto, sem precisar clicar em "Nova Debit Note". */
  pendingFile?: { path: string; name: string } | null;
  onPendingFileConsumed?: () => void;
  /** Esconde o botão manual "Nova Debit Note" — a criação passa a acontecer
   *  só via anexo na aba Documentos. */
  hideCreateButton?: boolean;
  /** Modo somente leitura — usado na aba Documentos: lista informativa, sem
   *  nenhum botão de ação (nem "Nova Debit Note", nem "Abrir"/"Excluir" por
   *  linha, nem clique para abrir o detalhe). */
  readOnly?: boolean;
}

export function DebitNotesTab({ quoteId, companyId, partners, pendingFile, onPendingFileConsumed, hideCreateButton, readOnly }: DebitNotesTabProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [activeDnId, setActiveDnId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Documento anexado na aba Documentos com a categoria "DN Fornecedor":
  // abre o formulário de criação automaticamente, já com o arquivo anexado.
  useEffect(() => {
    if (pendingFile) setCreateOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFile?.path]);

  const { data: notes = [], refetch } = useQuery({
    queryKey: ['debit_notes', quoteId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('debit_notes' as any) as any)
        .select('*')
        .eq('quote_id', quoteId)
        .or('kind.eq.partner_incoming,kind.is.null')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DebitNote[];
    },
  });

  // Fase 3: status da conta a pagar vinculada a cada DN
  const { data: apMap = new Map<string, { status: string; due_date: string; paid_at: string | null }>() } = useQuery({
    queryKey: ['debit_notes_ap', quoteId],
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts_payable' as any)
        .select('debit_note_id, status, due_date, paid_at')
        .eq('quote_id', quoteId);
      const map = new Map<string, any>();
      (data ?? []).forEach((r: any) => {
        if (r.debit_note_id) map.set(r.debit_note_id, r);
      });
      return map;
    },
  });

  const { data: charges = [] } = useQuery({
    queryKey: ['quote_charges_for_dn', quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_charges')
        .select('id, description, buy_amount, currency')
        .eq('quote_id', quoteId);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        description: r.description,
        amount: Number(r.buy_amount) || 0,
        currency: r.currency ?? 'USD',
      })) as QuoteCharge[];
    },
  });

  const buyCharges = charges;

  const activeDn = notes.find((n) => n.id === activeDnId) ?? null;

  async function handleDelete(id: string) {
    const dn = notes.find((n) => n.id === id);
    const partner = partners.find((p) => p.id === dn?.partner_id);
    const result = await deleteSupplierDn({
      dnId: id,
      companyId,
      quoteId,
      userId: user?.id,
      partnerName: partner?.name,
    });
    if (result.ok === false) return toast.error('Erro ao excluir', { description: result.error });
    toast.success('Debit Note excluída — taxas liberadas para edição');
    setConfirmDelete(null);
    refetch();
    qc.invalidateQueries({ queryKey: ['accounts_payable'] });
    qc.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
    qc.invalidateQueries({ queryKey: ['quote_charges_for_dn', quoteId] });
  }

  return (
    <div className="space-y-4">
      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" /> Debit Notes
          </CardTitle>
          {!hideCreateButton && !readOnly && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Nova Debit Note
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma Debit Note registrada. Ao lançar uma DN você poderá conferir o cobrado × cotado
              antes de aprovar e gerar a conta a pagar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº DN</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  {!readOnly && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {notes.map((n) => {
                  const partner = partners.find((p) => p.id === n.partner_id);
                  return (
                    <TableRow key={n.id} className={readOnly ? '' : 'cursor-pointer'} onClick={() => !readOnly && setActiveDnId(n.id)}>
                      <TableCell className="font-medium">{n.dn_number}</TableCell>
                      <TableCell>{partner?.name ?? '—'}</TableCell>
                      <TableCell>{n.issue_date ? format(parseISO(n.issue_date), 'dd/MM/yyyy') : '—'}</TableCell>
                      <TableCell>{n.due_date ? format(parseISO(n.due_date), 'dd/MM/yyyy') : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {n.currency} {Number(n.total_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLOR[n.status] ?? ''} variant="secondary">
                          {STATUS_LABEL[n.status] ?? n.status}
                        </Badge>
                        {(() => {
                          const ap = apMap.get(n.id);
                          if (!ap) return null;
                          const today = new Date().toISOString().slice(0, 10);
                          const overdue = ap.status === 'aberto' && ap.due_date < today;
                          const cls = ap.status === 'pago'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : overdue
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-slate-500/20 text-slate-300';
                          const label = ap.status === 'pago' ? 'Pago' : overdue ? 'Vencida' : 'Em aberto';
                          return (
                            <Badge className={`ml-1 ${cls}`} variant="secondary" title="Conta a Pagar">
                              {label}
                            </Badge>
                          );
                        })()}
                      </TableCell>
                      {!readOnly && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" onClick={() => setActiveDnId(n.id)}>
                            Abrir
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(n.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateDnDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) onPendingFileConsumed?.();
        }}
        quoteId={quoteId}
        companyId={companyId}
        partners={partners}
        presetFile={pendingFile ?? null}
        onCreated={(id) => {
          setCreateOpen(false);
          onPendingFileConsumed?.();
          refetch();
          setActiveDnId(id);
        }}
      />

      {activeDn && (
        <DnDetailDialog
          dn={activeDn}
          onClose={() => setActiveDnId(null)}
          buyCharges={buyCharges}
          partners={partners}
          onChanged={() => {
            refetch();
            qc.invalidateQueries({ queryKey: ['accounts_payable'] });
          }}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Debit Note?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A conta a pagar vinculada some junto (se já estiver paga,
              o registro do pagamento também é perdido) e as taxas que estavam presas nesta DN voltam a
              ficar editáveis (é preciso conferir de novo antes de reenviar).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && handleDelete(confirmDelete)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateDnDialog({
  open,
  onOpenChange,
  quoteId,
  companyId,
  partners,
  presetFile,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  quoteId: string;
  companyId: string;
  partners: Array<{ id: string; name: string }>;
  /** Arquivo já anexado via aba Documentos (categoria "DN Fornecedor") —
   *  quando presente, pula o upload próprio e usa esse arquivo direto. */
  presetFile?: { path: string; name: string } | null;
  onCreated: (id: string) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    dn_number: '',
    partner_id: '',
    issue_date: format(new Date(), 'yyyy-MM-dd'),
    due_date: '',
    currency: 'BRL',
    exchange_rate: '1',
    total_amount: '',
    notes: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        dn_number: '',
        partner_id: '',
        issue_date: format(new Date(), 'yyyy-MM-dd'),
        due_date: '',
        currency: 'BRL',
        exchange_rate: '1',
        total_amount: '',
        notes: '',
      });
      setFile(null);
    }
  }, [open]);

  async function handleSave() {
    if (!form.dn_number || !form.partner_id) {
      toast.error('Preencha nº da DN e fornecedor');
      return;
    }
    setSaving(true);
    try {
      let file_url: string | null = presetFile?.path ?? null;
      if (!presetFile && file) {
        const path = `debit-notes/${quoteId}/${Date.now()}_${sanitizeStorageFileName(file.name)}`;
        const { error: upErr } = await supabase.storage.from('shipment-documents').upload(path, file);
        if (upErr) throw upErr;
        file_url = path;
      }
      const { data, error } = await supabase
        .from('debit_notes' as any)
        .insert({
          company_id: companyId,
          quote_id: quoteId,
          partner_id: form.partner_id,
          dn_number: form.dn_number,
          issue_date: form.issue_date,
          due_date: form.due_date || null,
          currency: form.currency,
          exchange_rate: Number(form.exchange_rate) || 1,
          total_amount: Number(form.total_amount) || 0,
          notes: form.notes || null,
          file_url,
          created_by: user?.id,
          status: 'em_conferencia',
        })
        .select('id')
        .single();
      if (error) throw error;
      toast.success('Debit Note criada');
      onCreated((data as any).id);
    } catch (e: any) {
      toast.error('Erro ao salvar', { description: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova Debit Note</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Nº da DN *</Label>
            <Input value={form.dn_number} onChange={(e) => setForm({ ...form, dn_number: e.target.value })} />
          </div>
          <div>
            <Label>Fornecedor *</Label>
            <Select value={form.partner_id} onValueChange={(v) => setForm({ ...form, partner_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data de emissão</Label>
            <Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} />
          </div>
          <div>
            <Label>Vencimento</Label>
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div>
            <Label>Moeda</Label>
            <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Câmbio</Label>
            <Input type="number" step="0.0001" value={form.exchange_rate} onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })} />
          </div>
          <div>
            <Label>Valor total</Label>
            <Input type="number" step="0.01" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
          </div>
          <div>
            <Label>Arquivo (PDF)</Label>
            {presetFile ? (
              <div className="h-10 flex items-center gap-1.5 text-sm text-muted-foreground border rounded-md px-3 bg-muted/30 truncate">
                <FileText className="w-3.5 h-3.5 shrink-0" /> {presetFile.name}
              </div>
            ) : (
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            )}
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            <Upload className="w-4 h-4 mr-1" /> Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DnDetailDialog({
  dn,
  onClose,
  buyCharges,
  partners,
  onChanged,
}: {
  dn: DebitNote;
  onClose: () => void;
  buyCharges: QuoteCharge[];
  partners: Array<{ id: string; name: string }>;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<DebitNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('debit_note_items' as any)
      .select('*')
      .eq('debit_note_id', dn.id)
      .order('created_at', { ascending: true });
    if (!error) setItems((data ?? []) as unknown as DebitNoteItem[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dn.id]);

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random()}`,
        debit_note_id: dn.id,
        quote_charge_id: null,
        description: '',
        quoted_amount: null,
        charged_amount: 0,
        currency: dn.currency,
        variance: null,
        reason: null,
        reconciled: false,
      },
    ]);
  }

  function updateItem(id: string, patch: Partial<DebitNoteItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function linkCharge(id: string, chargeId: string) {
    const c = buyCharges.find((x) => x.id === chargeId);
    if (!c) return updateItem(id, { quote_charge_id: null });
    updateItem(id, {
      quote_charge_id: chargeId,
      description: c.description,
      quoted_amount: c.amount,
      currency: c.currency,
    });
  }

  async function saveItems() {
    setSaving(true);
    try {
      const toDelete = items.filter((i) => i.id.startsWith('delete-')).map((i) => i.id.replace('delete-', ''));
      if (toDelete.length) {
        await supabase.from('debit_note_items' as any).delete().in('id', toDelete);
      }
      const rows = items
        .filter((i) => !i.id.startsWith('delete-'))
        .map((i) => ({
          ...(i.id.startsWith('new-') ? {} : { id: i.id }),
          debit_note_id: dn.id,
          quote_charge_id: i.quote_charge_id,
          description: i.description,
          quoted_amount: i.quoted_amount,
          charged_amount: Number(i.charged_amount) || 0,
          currency: i.currency,
          reason: i.reason,
          reconciled: i.reconciled,
        }));
      if (rows.length) {
        const { error } = await supabase.from('debit_note_items' as any).upsert(rows as any);
        if (error) throw error;
      }
      toast.success('Itens salvos');
      await load();
      onChanged();
    } catch (e: any) {
      toast.error('Erro ao salvar itens', { description: e.message });
    } finally {
      setSaving(false);
    }
  }

  const totalCharged = items.reduce((s, i) => s + (Number(i.charged_amount) || 0), 0);
  const totalQuoted = items.reduce((s, i) => s + (Number(i.quoted_amount) || 0), 0);
  const totalVariance = totalCharged - totalQuoted;
  const hasUnjustifiedVariance = items.some(
    (i) => Math.abs((Number(i.charged_amount) || 0) - (Number(i.quoted_amount) || 0)) > 0.01 && !i.reason,
  );

  async function approve() {
    if (hasUnjustifiedVariance) {
      toast.error('Justifique todas as divergências antes de aprovar');
      return;
    }
    if (approving) return;
    setApproving(true);
    try {
      const { error: upErr } = await supabase
        .from('debit_notes' as any)
        .update({
          status: 'aprovada',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          total_amount: totalCharged || dn.total_amount,
        })
        .eq('id', dn.id);
      if (upErr) throw upErr;

      // Recupera shipment vinculado (via base_reference da cotação)
      const { data: qRef } = await supabase
        .from('quotes')
        .select('base_reference')
        .eq('id', (dn as any).quote_id)
        .maybeSingle();
      let shipmentId: string | null = null;
      if (qRef?.base_reference) {
        const { data: sh } = await supabase
          .from('shipments')
          .select('id')
          .eq('reference_number', qRef.base_reference)
          .maybeSingle();
        shipmentId = sh?.id ?? null;
      }

      // Cria conta a pagar (idempotente — evita duplicidade se aprovar 2×)
      const { data: existingAp } = await supabase
        .from('accounts_payable' as any)
        .select('id')
        .eq('debit_note_id', dn.id)
        .maybeSingle();
      if (existingAp) {
        toast.success('DN aprovada (conta a pagar já existia)');
        onChanged();
        onClose();
        return;
      }
      const { error: apErr } = await supabase.from('accounts_payable' as any).insert({
        company_id: (dn as any).company_id ?? undefined,
        source: 'debit_note',
        debit_note_id: dn.id,
        quote_id: (dn as any).quote_id,
        shipment_id: shipmentId,
        partner_id: dn.partner_id,
        description: `Debit Note ${dn.dn_number}`,
        currency: dn.currency,
        amount: totalCharged || dn.total_amount,
        due_date: dn.due_date ?? new Date().toISOString().slice(0, 10),
        status: 'aberto',
        created_by: user?.id,
      });
      if (apErr) throw apErr;

      toast.success('DN aprovada e conta a pagar gerada');
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error('Erro ao aprovar', { description: e.message });
    } finally {
      setApproving(false);
    }
  }

  const partner = partners.find((p) => p.id === dn.partner_id);
  const readonly = dn.status === 'aprovada' || dn.status === 'paga';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Debit Note {dn.dn_number} — {partner?.name ?? '—'}
            <Badge className={STATUS_COLOR[dn.status]} variant="secondary">{STATUS_LABEL[dn.status]}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground grid grid-cols-4 gap-2">
          <div>Emissão: {dn.issue_date ? format(parseISO(dn.issue_date), 'dd/MM/yyyy') : '—'}</div>
          <div>Vencimento: {dn.due_date ? format(parseISO(dn.due_date), 'dd/MM/yyyy') : '—'}</div>
          <div>Moeda: {dn.currency}</div>
          <div>Câmbio: {dn.exchange_rate ?? 1}</div>
        </div>

        {dn.file_url && (
          <button
            type="button"
            onClick={() => openSignedDoc(dn.file_url).catch((e) => toast.error(e.message))}
            className="text-xs text-primary underline text-left"
          >
            Abrir arquivo original
          </button>
        )}

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-64">Taxa (Cotado)</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right w-28">Cotado</TableHead>
                <TableHead className="text-right w-28">Cobrado</TableHead>
                <TableHead className="text-right w-24">Δ</TableHead>
                <TableHead className="w-56">Motivo</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-sm py-4">Carregando…</TableCell></TableRow>
              ) : items.filter((i) => !i.id.startsWith('delete-')).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-sm py-4 text-muted-foreground">Sem itens — adicione linhas para conferir.</TableCell></TableRow>
              ) : (
                items.filter((i) => !i.id.startsWith('delete-')).map((i) => {
                  const variance = (Number(i.charged_amount) || 0) - (Number(i.quoted_amount) || 0);
                  const hasVar = Math.abs(variance) > 0.01;
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Select
                          value={i.quote_charge_id ?? ''}
                          onValueChange={(v) => linkCharge(i.id, v)}
                          disabled={readonly}
                        >
                          <SelectTrigger className="h-8"><SelectValue placeholder="Vincular…" /></SelectTrigger>
                          <SelectContent>
                            {buyCharges.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.description} ({c.currency} {c.amount.toFixed(2)})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8"
                          value={i.description}
                          onChange={(e) => updateItem(i.id, { description: e.target.value })}
                          disabled={readonly}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {i.quoted_amount != null ? `${i.currency} ${Number(i.quoted_amount).toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 text-right tabular-nums"
                          value={i.charged_amount}
                          onChange={(e) => updateItem(i.id, { charged_amount: Number(e.target.value) })}
                          disabled={readonly}
                        />
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-xs font-medium ${hasVar ? (variance > 0 ? 'text-red-400' : 'text-emerald-400') : ''}`}>
                        {hasVar ? `${variance > 0 ? '+' : ''}${variance.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8"
                          placeholder={hasVar ? 'Obrigatório' : ''}
                          value={i.reason ?? ''}
                          onChange={(e) => updateItem(i.id, { reason: e.target.value })}
                          disabled={readonly}
                        />
                      </TableCell>
                      <TableCell>
                        {!readonly && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              setItems((prev) =>
                                prev.map((x) => (x.id === i.id ? { ...x, id: i.id.startsWith('new-') ? '' : `delete-${i.id}` } : x)).filter((x) => x.id !== ''),
                              )
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            {!readonly && (
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar item
              </Button>
            )}
            {hasUnjustifiedVariance && (
              <span className="flex items-center gap-1 text-amber-400 text-xs">
                <AlertTriangle className="w-3.5 h-3.5" /> Existem divergências sem justificativa
              </span>
            )}
          </div>
          <div className="tabular-nums text-right">
            <div className="text-xs text-muted-foreground">Cotado: {dn.currency} {totalQuoted.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Cobrado: {dn.currency} {totalCharged.toFixed(2)}</div>
            <div className={`font-semibold ${Math.abs(totalVariance) > 0.01 ? (totalVariance > 0 ? 'text-red-400' : 'text-emerald-400') : ''}`}>
              Δ {dn.currency} {totalVariance.toFixed(2)}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          {!readonly && (
            <>
              <Button variant="outline" onClick={saveItems} disabled={saving}>Salvar itens</Button>
              <Button onClick={approve} disabled={saving || approving || hasUnjustifiedVariance}>
                <CheckCircle className="w-4 h-4 mr-1" /> Aprovar & gerar conta a pagar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Popup de "Enviar DN" acionado a partir do cabeçalho de cada fornecedor na
 * aba Taxas (lado Compra), depois que todas as taxas daquele fornecedor já
 * foram conferidas. Sobe o arquivo real da DN pro storage do processo, cria
 * o registro em `documents` (categoria DN Fornecedor, aparece em Documentos),
 * a Debit Note já como aprovada (a conferência já aconteceu antes, na aba
 * Taxas — não faz sentido pedir aprovação de novo aqui) e a conta a pagar no
 * financeiro, tudo de uma vez. As taxas incluídas ficam marcadas com esta DN
 * e travadas assim que a conta a pagar for quitada. Nº da DN, moeda e valor
 * já vêm prontos — o usuário só anexa o arquivo e diz o vencimento.
 */
export function SendSupplierDnDialog({
  open,
  onOpenChange,
  quoteId,
  companyId,
  partnerId,
  partnerName,
  suggestedAmount,
  suggestedCurrency,
  chargeIds,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  quoteId: string;
  companyId: string;
  partnerId: string;
  partnerName: string;
  /** Soma das taxas já conferidas desse fornecedor — vira o valor da DN. */
  suggestedAmount: number;
  suggestedCurrency: string;
  /** IDs das taxas (quote_charges) incluídas nesta DN — ficam marcadas e,
   *  quando a conta a pagar for paga, travadas contra reabertura/edição. */
  chargeIds: string[];
  onSent?: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { usdBrl, eurBrl } = useExchangeRate();
  const [dueDate, setDueDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [exchangeRate, setExchangeRate] = useState('1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDueDate('');
      setFile(null);
      // Pré-preenche com a cotação atual pra moeda da DN — o usuário ainda
      // pode ajustar pra taxa realmente usada na conversão, se for diferente.
      const cur = (suggestedCurrency || '').toUpperCase();
      const liveRate = cur === 'USD' ? usdBrl : cur === 'EUR' ? eurBrl : null;
      setExchangeRate(cur === 'BRL' ? '1' : liveRate ? String(liveRate) : '1');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    if (!file) {
      toast.error('Anexe o arquivo da DN');
      return;
    }
    setSaving(true);
    try {
      // Recupera o embarque vinculado (via base_reference da cotação), se houver —
      // movido pra ANTES do upload/insert pra poder gravar shipment_id junto do
      // quote_id no documento da DN. Antes só gravava quote_id: funcionava pra
      // quem abria o processo pela lista de Cotações, mas o documento não batia
      // com o padrão usado no resto da aba Documentos (que sempre grava os dois
      // quando disponíveis), então dependia só do OR por quote_id pra aparecer.
      const { data: qRef } = await supabase.from('quotes').select('base_reference').eq('id', quoteId).maybeSingle();
      let shipmentId: string | null = null;
      if (qRef?.base_reference) {
        const { data: sh } = await supabase.from('shipments').select('id').eq('reference_number', qRef.base_reference).maybeSingle();
        shipmentId = sh?.id ?? null;
      }

      const path = `${companyId}/${quoteId}/${Date.now()}_${sanitizeStorageFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from('shipment-documents').upload(path, file);
      if (upErr) throw upErr;

      // IMPORTANTE: o erro deste insert precisa ser checado — antes ele era
      // ignorado silenciosamente, então se falhasse (RLS, rede, etc.) o fluxo
      // seguia em frente e criava a Debit Note e a conta a pagar normalmente,
      // como se tivesse dado tudo certo, só que sem o documento salvo em
      // Documentos. Se falhar agora, para aqui e avisa o usuário.
      const { error: docErr } = await supabase.from('documents').insert({
        quote_id: quoteId,
        shipment_id: shipmentId,
        company_id: companyId,
        name: file.name,
        file_url: path,
        file_size: file.size,
        uploaded_by: user?.id,
        document_type: 'debit_note_supplier' as any,
      } as any);
      if (docErr) throw docErr;

      const { data: numData, error: nErr } = await supabase.rpc('next_dn_number' as any, { p_company_id: companyId });
      if (nErr) throw nErr;
      const dn_number = numData as unknown as string;

      // Já nasce aprovada — a conferência das taxas já aconteceu na aba Taxas
      // antes de liberar o botão "Enviar DN".
      const { data: dnRow, error: dnErr } = await supabase.from('debit_notes' as any).insert({
        company_id: companyId,
        quote_id: quoteId,
        partner_id: partnerId,
        dn_number,
        issue_date: format(new Date(), 'yyyy-MM-dd'),
        due_date: dueDate || null,
        currency: suggestedCurrency,
        exchange_rate: Number(exchangeRate) || 1,
        total_amount: suggestedAmount,
        file_url: path,
        created_by: user?.id,
        status: 'aprovada',
        approved_by: user?.id,
        approved_at: new Date().toISOString(),
      }).select('id').single();
      if (dnErr) throw dnErr;
      const dnId = (dnRow as any).id;

      const { error: apErr } = await supabase.from('accounts_payable' as any).insert({
        company_id: companyId,
        source: 'debit_note',
        debit_note_id: dnId,
        quote_id: quoteId,
        shipment_id: shipmentId,
        partner_id: partnerId,
        description: `Debit Note ${dn_number}`,
        currency: suggestedCurrency,
        amount: suggestedAmount,
        due_date: dueDate || new Date().toISOString().slice(0, 10),
        status: 'aberto',
        created_by: user?.id,
      });
      if (apErr) throw apErr;

      // Marca as taxas incluídas com esta DN, pra travar depois que a conta a pagar for quitada.
      if (chargeIds.length > 0) {
        await supabase.from('quote_charges' as any).update({ sent_in_debit_note_id: dnId }).in('id', chargeIds);
        await removeChargeExpense(chargeIds);
      }

      qc.invalidateQueries({ queryKey: ['debit_notes', quoteId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      toast.success('DN enviada e conta a pagar criada');
      onOpenChange(false);
      onSent?.();
    } catch (e: any) {
      toast.error('Erro ao enviar DN', { description: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar DN — {partnerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Arquivo da DN *</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label>Vencimento</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          {suggestedCurrency.toUpperCase() !== 'BRL' && (
            <div>
              <Label>Taxa de câmbio ({suggestedCurrency} → BRL)</Label>
              <Input type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">
                Câmbio usado na conversão do fornecedor — ajuste se for diferente da cotação do dia.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Valor: {suggestedCurrency} {suggestedAmount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (soma das taxas conferidas)
            {suggestedCurrency.toUpperCase() !== 'BRL' && (Number(exchangeRate) > 0) && (
              <> · ≈ R$ {(suggestedAmount * Number(exchangeRate)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            <Upload className="w-4 h-4 mr-1" /> {saving ? 'Enviando…' : 'Enviar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
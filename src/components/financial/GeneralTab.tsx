import { useEffect, useMemo, useState } from 'react';
import { MonthSelect } from './MonthSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash2, Pencil, CheckCircle2, Paperclip, TrendingUp, TrendingDown, Repeat, Zap } from 'lucide-react';
import { useOverheadCategories, useOverheadEntries, useOverheadExpenses, OverheadExpense } from '@/hooks/useOverhead';
import { TransactionModal } from '@/components/overhead/TransactionModal';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DOCS_BUCKET, openSignedDoc } from '@/lib/storage';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';
import { toast } from 'sonner';

// "Geral" — despesas e receitas da empresa sem vínculo com processo/cotação
// (ex-"Despesas Fixas"). Lista única: avulsos e recorrentes, despesa e
// receita, tudo junto — cada linha carrega um selo de tipo e de recorrência.
function currentMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function fmt(n: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}
function fmtDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR');
}

export default function GeneralTab() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const [referenceMonth, setReferenceMonth] = useState(currentMonthISO());
  const categories = useOverheadCategories();
  const expenses = useOverheadExpenses();
  const entries = useOverheadEntries(referenceMonth);

  const [addOpen, setAddOpen] = useState<'despesa' | 'receita' | null>(null);
  const [editing, setEditing] = useState<OverheadExpense | null>(null);
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [payFile, setPayFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const expensesById = useMemo(() => new Map((expenses.data || []).map((e) => [e.id, e])), [expenses.data]);
  const categoriesById = useMemo(() => new Map((categories.data || []).map((c) => [c.id, c])), [categories.data]);

  // Regra: uma vez marcado como recorrente, o lançamento tem que aparecer
  // sozinho nos meses seguintes, sem o usuário precisar clicar em nada. Isso
  // já roda automaticamente no servidor todo dia 1 (cron), mas também
  // garante aqui, no cliente, que o mês sendo visualizado (inclusive se o
  // usuário navegar pra um mês futuro antes do cron rodar, ou logo após
  // cadastrar uma recorrência nova) já tenha os lançamentos gerados —
  // idempotente, então rodar de novo não duplica nada.
  useEffect(() => {
    if (referenceMonth) entries.generate.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceMonth]);

  // Lista única — não separa mais avulso de recorrente nem despesa de
  // receita, só ordena por vencimento e sinaliza cada linha com selos.
  const allEntries = useMemo(
    () => [...(entries.data || [])].sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [entries.data],
  );

  return (
    <div className="space-y-4">
      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CardTitle>Lançamentos do mês</CardTitle>
            <MonthSelect
              value={referenceMonth.slice(0, 7)}
              onChange={(v) => setReferenceMonth(v + '-01')}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setAddOpen('despesa')}>
              <TrendingDown className="w-4 h-4 mr-1" /> Adicionar Despesa
            </Button>
            <Button variant="outline" onClick={() => setAddOpen('receita')}>
              <TrendingUp className="w-4 h-4 mr-1" /> Adicionar Receita
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {entries.isLoading ? (
            <div className="py-10 text-center text-muted-foreground">Carregando...</div>
          ) : allEntries.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              Nenhum lançamento neste mês. Use "Adicionar Despesa"/"Adicionar Receita" acima — lançamentos recorrentes já cadastrados aparecem aqui automaticamente.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border/50">
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Descrição</th>
                    <th className="py-2 pr-3">Categoria</th>
                    <th className="py-2 pr-3">Recorrência</th>
                    <th className="py-2 pr-3">Vencimento</th>
                    <th className="py-2 pr-3 text-right">Valor</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {allEntries.map((e) => {
                    const exp = expensesById.get(e.overhead_expense_id);
                    const isRecurring = exp?.active !== false;
                    const cat = exp?.category_id ? categoriesById.get(exp.category_id) : null;
                    const overdue = e.status === 'pending' && new Date(e.due_date) < new Date();
                    return (
                      <tr key={e.id} className="border-b border-border/30">
                        <td className="py-2 pr-3"><KindBadge kind={e.kind} /></td>
                        <td className="py-2 pr-3">{(exp?.name || '—').replace(/^\[Avulso\]\s*/, '')}</td>
                        <td className="py-2 pr-3">
                          {cat ? <Badge variant="secondary" style={{ borderColor: cat.color || undefined }}>{cat.name}</Badge> : '—'}
                        </td>
                        <td className="py-2 pr-3">
                          {isRecurring ? (
                            <Badge variant="outline" className="gap-1"><Repeat className="w-3 h-3" /> {exp?.recurrence === 'monthly' ? 'Mensal' : exp?.recurrence === 'bimonthly' ? 'Bimestral' : exp?.recurrence === 'quarterly' ? 'Trimestral' : exp?.recurrence === 'yearly' ? 'Anual' : 'Recorrente'}</Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-muted-foreground"><Zap className="w-3 h-3" /> Avulso</Badge>
                          )}
                        </td>
                        <td className={`py-2 pr-3 ${overdue ? 'text-destructive font-medium' : ''}`}>{fmtDate(e.due_date)}</td>
                        <td className="py-2 pr-3 text-right">
                          <EditableAmountCell
                            value={Number(e.amount)}
                            currency={e.currency}
                            disabled={e.status === 'paid'}
                            onSave={(v) => entries.update.mutate({ id: e.id, patch: { amount: v } })}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={overdue ? 'late' : e.status} />
                        </td>
                        <td className="py-2 pr-3 text-right space-x-1 whitespace-nowrap">
                          {e.payment_proof_url && (
                            <Button size="icon" variant="ghost" title="Ver comprovante"
                              onClick={() => openSignedDoc(e.payment_proof_url!).catch((err: any) => toast.error(err.message))}>
                              <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                            </Button>
                          )}
                          {isRecurring && exp && (
                            <Button size="icon" variant="ghost" title="Editar recorrência" onClick={() => setEditing(exp)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {e.status !== 'paid' ? (
                            <Button size="sm" variant="outline"
                              onClick={() => {
                                setPayTarget(e);
                                setPayDate(new Date().toISOString().slice(0, 10));
                                setPayFile(null);
                              }}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> {e.kind === 'receita' ? 'Receber' : 'Pagar'}
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost"
                              onClick={() => entries.update.mutate({ id: e.id, patch: { status: 'pending', paid_at: null } })}>
                              Desfazer
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => entries.remove.mutate(e.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <TransactionModal
        open={!!addOpen}
        onOpenChange={(o) => { if (!o) setAddOpen(null); }}
        kind={addOpen || 'despesa'}
        expense={null}
        referenceMonth={referenceMonth}
        categories={categories.data || []}
      />

      <TransactionModal
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        kind={editing?.kind || 'despesa'}
        expense={editing}
        referenceMonth={referenceMonth}
        categories={categories.data || []}
      />

      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{payTarget?.kind === 'receita' ? 'Registrar recebimento' : 'Registrar pagamento'}</DialogTitle>
            {payTarget && (
              <DialogDescription>
                {expensesById.get(payTarget.overhead_expense_id)?.name || 'Lançamento'} — {fmt(Number(payTarget.amount), payTarget.currency)}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={payDate} onChange={(ev) => setPayDate(ev.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Comprovante (opcional)</Label>
              <Input type="file" accept="application/pdf,image/*" onChange={(ev) => setPayFile(ev.target.files?.[0] ?? null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayTarget(null)} disabled={uploadingReceipt}>Cancelar</Button>
            <Button
              disabled={uploadingReceipt}
              onClick={async () => {
                if (!payTarget || !payDate) return;
                let payment_proof_url: string | null = null;
                if (payFile) {
                  setUploadingReceipt(true);
                  const path = `${companyId}/receipts/overhead/${payTarget.id}/${Date.now()}_${sanitizeStorageFileName(payFile.name)}`;
                  const { error: upErr } = await supabase.storage.from(DOCS_BUCKET).upload(path, payFile);
                  setUploadingReceipt(false);
                  if (upErr) return toast.error('Erro ao anexar comprovante', { description: upErr.message });
                  payment_proof_url = path;
                }
                entries.update.mutate(
                  {
                    id: payTarget.id,
                    patch: {
                      status: 'paid',
                      paid_at: new Date(payDate + 'T12:00:00').toISOString(),
                      ...(payment_proof_url ? { payment_proof_url } : {}),
                    },
                  },
                  { onSuccess: () => { setPayTarget(null); setPayFile(null); } },
                );
              }}
            >
              {uploadingReceipt ? 'Enviando…' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditableAmountCell({ value, currency, disabled, onSave }: { value: number; currency: string; disabled?: boolean; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  if (disabled) {
    return <span className="tabular-nums">{fmt(value, currency)}</span>;
  }

  return (
    <Input
      type="number"
      step="0.01"
      className="w-28 h-8 text-right ml-auto tabular-nums"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        if (isFinite(n) && n >= 0 && n !== value) onSave(n);
        else setDraft(String(value));
      }}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pendente', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    paid: { label: 'Pago', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    late: { label: 'Atrasado', className: 'bg-destructive/10 text-destructive border-destructive/20' },
    cancelled: { label: 'Cancelado', className: 'bg-muted text-muted-foreground border-border' },
  };
  const m = map[status] || map.pending;
  return <Badge variant="outline" className={m.className}>{m.label}</Badge>;
}

function KindBadge({ kind }: { kind: 'despesa' | 'receita' }) {
  return kind === 'receita' ? (
    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1">
      <TrendingUp className="w-3 h-3" /> Receita
    </Badge>
  ) : (
    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1">
      <TrendingDown className="w-3 h-3" /> Despesa
    </Badge>
  );
}

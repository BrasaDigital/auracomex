import { formatMoney } from '@/lib/money';
import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Wallet, TrendingUp, TrendingDown, PiggyBank, Plus, Trash2, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

type Expense = {
  id: string;
  description: string;
  category: string;
  amount_cents: number;
  currency: string;
  expense_date: string;
  is_recurring: boolean;
  recurring_frequency: string | null;
  notes: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  infraestrutura: 'Infraestrutura (Supabase, Vercel, domínio...)',
  ferramentas: 'Ferramentas / Software',
  marketing: 'Marketing',
  contabilidade: 'Contabilidade / Jurídico',
  equipe: 'Equipe / Freelancer',
  taxas: 'Taxas / Impostos',
  outros: 'Outros',
};

const emptyForm = {
  description: '',
  category: 'infraestrutura',
  amount: '',
  currency: 'BRL',
  expense_date: format(new Date(), 'yyyy-MM-dd'),
  is_recurring: false,
  recurring_frequency: 'mensal',
  notes: '',
};

function fmtBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function AuraFinanceTab() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const { data: expenses = [], refetch } = useQuery({
    queryKey: ['platform-expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_expenses' as any)
        .select('*')
        .order('expense_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Expense[];
    },
  });

  const { data: subs = [] } = useQuery({
    queryKey: ['platform-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_subscriptions' as any)
        .select('status, mrr_cents');
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const mrrCents = useMemo(
    () => subs.filter((s) => ['active', 'past_due'].includes(s.status)).reduce((sum, s) => sum + (s.mrr_cents || 0), 0),
    [subs]
  );

  const totals = useMemo(() => {
    const totalInvestido = expenses.reduce((sum, e) => sum + e.amount_cents, 0);
    const custoMensalRecorrente = expenses
      .filter((e) => e.is_recurring)
      .reduce((sum, e) => sum + (e.recurring_frequency === 'anual' ? e.amount_cents / 12 : e.amount_cents), 0);
    const byCategory: Record<string, number> = {};
    for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount_cents;
    return { totalInvestido, custoMensalRecorrente, byCategory };
  }, [expenses]);

  const resultado = mrrCents - totals.custoMensalRecorrente;

  const filtered = categoryFilter === 'todos' ? expenses : expenses.filter((e) => e.category === categoryFilter);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(e: Expense) {
    setEditing(e);
    setForm({
      description: e.description,
      category: e.category,
      amount: (e.amount_cents / 100).toString(),
      currency: e.currency,
      expense_date: e.expense_date,
      is_recurring: e.is_recurring,
      recurring_frequency: e.recurring_frequency || 'mensal',
      notes: e.notes || '',
    });
    setFormOpen(true);
  }

  async function handleSave() {
    const amountCents = Math.round(parseFloat(form.amount.replace(',', '.')) * 100);
    if (!form.description.trim() || !amountCents || amountCents <= 0) {
      toast.error('Preencha descrição e valor corretamente');
      return;
    }
    const payload = {
      description: form.description.trim(),
      category: form.category,
      amount_cents: amountCents,
      currency: form.currency,
      expense_date: form.expense_date,
      is_recurring: form.is_recurring,
      recurring_frequency: form.is_recurring ? form.recurring_frequency : null,
      notes: form.notes.trim() || null,
    };
    const { error } = editing
      ? await supabase.from('platform_expenses' as any).update(payload).eq('id', editing.id)
      : await supabase.from('platform_expenses' as any).insert(payload);
    if (error) return toast.error('Erro ao salvar', { description: error.message });
    toast.success(editing ? 'Custo atualizado' : 'Custo registrado');
    setFormOpen(false);
    refetch();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from('platform_expenses' as any).delete().eq('id', deleteTarget.id);
    if (error) return toast.error('Erro ao excluir', { description: error.message });
    toast.success('Custo removido');
    setDeleteTarget(null);
    refetch();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Financeiro do Aura</h2>
        <p className="text-muted-foreground text-sm">Controle de investimento e custos do próprio negócio, do início até hoje.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="glass">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <PiggyBank className="w-3 h-3" />Total investido (histórico)
            </p>
            <p className="text-xl font-bold">{fmtBRL(totals.totalInvestido)}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <Wallet className="w-3 h-3" />Custo recorrente / mês
            </p>
            <p className="text-xl font-bold">{fmtBRL(totals.custoMensalRecorrente)}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />MRR atual
            </p>
            <p className="text-xl font-bold">{fmtBRL(mrrCents)}</p>
          </CardContent>
        </Card>
        <Card className={resultado >= 0 ? 'glass border-emerald-500/40' : 'glass border-red-500/40'}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              {resultado >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}Resultado / mês
            </p>
            <p className={`text-xl font-bold ${resultado >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtBRL(resultado)}</p>
          </CardContent>
        </Card>
      </div>

      {Object.keys(totals.byCategory).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Por categoria:</span>
          {Object.entries(totals.byCategory).map(([cat, cents]) => (
            <Badge key={cat} variant="outline" className="gap-1">
              {CATEGORY_LABEL[cat] || cat}: {fmtBRL(cents)}
            </Badge>
          ))}
        </div>
      )}

      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Custos lançados</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as categorias</SelectItem>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={openNew}>
              <Plus className="w-4 h-4 mr-1" />Novo custo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum custo lançado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Recorrência</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{format(new Date(e.expense_date + 'T00:00:00'), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>
                      {e.description}
                      {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                    </TableCell>
                    <TableCell className="text-xs">{CATEGORY_LABEL[e.category] || e.category}</TableCell>
                    <TableCell>
                      {e.is_recurring ? (
                        <Badge variant="secondary" className="bg-blue-500/20 text-blue-300">
                          {e.recurring_frequency === 'anual' ? 'Anual' : 'Mensal'}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">Pontual</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(e.amount_cents / 100, e.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(e)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(e)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar custo' : 'Novo custo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Descrição</Label>
              <Input placeholder="Ex: Assinatura Supabase Pro" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data</Label>
                <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor</Label>
                <Input type="text" inputMode="decimal" placeholder="0,00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>Moeda</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRL">BRL</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between border rounded-md p-3">
              <div>
                <Label className="text-sm">Custo recorrente</Label>
                <p className="text-xs text-muted-foreground">Repete todo mês ou ano (ex: assinaturas)</p>
              </div>
              <Switch checked={form.is_recurring} onCheckedChange={(v) => setForm({ ...form, is_recurring: v })} />
            </div>
            {form.is_recurring && (
              <div>
                <Label>Frequência</Label>
                <Select value={form.recurring_frequency} onValueChange={(v) => setForm({ ...form, recurring_frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mensal">Mensal</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Notas (opcional)</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editing ? 'Salvar alterações' : 'Registrar custo'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir custo?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteTarget?.description}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAccountability } from '@/hooks/useAccountability';
import { DateField } from '@/components/shared/DateField';
import { AccountabilityTab } from './AccountabilityTab';

interface Props {
  quoteId: string;
  quote: any;
  companyId?: string;
  /** Processo Finalizado — trava lançamento de valores adicionais. */
  isFinalized?: boolean;
  /** Exportação: Prestação de Contas direta, sem Numerário. */
  isExport?: boolean;
  /** Soma de TODAS as taxas de compra da aba Taxas, em R$ (calculada no QuoteDetail). */
  custosProcessoBrl?: number;
}

function fmtBRL(n: number) {
  return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Aba "Financeiro" do processo: o "caixa" do cliente. No topo, o saldo dos
// depósitos; logo abaixo, os depósitos; e embaixo a Prestação de Contas, que
// vai abatendo do saldo à medida que cada item é confirmado como pago.
export function FinanceiroTab({ quoteId, quote, companyId, isFinalized, isExport, custosProcessoBrl = 0 }: Props) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const locked = !!isFinalized;
  const { data: accData } = useAccountability(quoteId, companyId);

  // O valor depositado vem das Movimentações: Receita do Numerário (e complementos lançados
  // aqui no "+") já confirmada como recebida pelo usuário.
  const accountabilityId = accData?.accountability?.id;
  // Também entram as NDs ao cliente já recebidas (Contas a Receber) — o PIX da ND conta
  // como dinheiro do cliente no processo mesmo antes de o Numerário ser aprovado.
  const { data: recebimentos = [] } = useQuery({
    queryKey: ['accounts_receivable', 'numerario', quoteId, accountabilityId],
    enabled: !!quoteId,
    queryFn: async () => {
      const ndFilter = `and(quote_id.eq.${quoteId},source.eq.debit_note)`;
      const { data, error } = await (supabase as any)
        .from('accounts_receivable')
        .select('id, amount, received_amount')
        .eq('status', 'recebido')
        .or(accountabilityId ? `accountability_id.eq.${accountabilityId},${ndFilter}` : ndFilter);
      if (error) throw error;
      return (data || []) as Array<{ id: string; amount: number; received_amount: number | null }>;
    },
  });
  const totalDepositado = recebimentos.reduce((s, r) => s + Number(r.received_amount ?? r.amount ?? 0), 0);
  // Custos do processo = soma de todas as taxas de compra da aba Taxas. Saldo = Depositado − Custos.
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 || 0;
  const custos = r2(custosProcessoBrl);
  const saldo = r2(totalDepositado - custos);

  // "+" ao lado do saldo: lançamento adicional do cliente. Entra em Movimentações
  // (Receita por Processo, já recebida) e passa a compor o "Depositado".
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<Date | undefined>(new Date());
  const [addAmount, setAddAmount] = useState('');
  const [addNote, setAddNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (locked) { toast.error('Processo finalizado — não é possível lançar valores.'); return; }
    if (!companyId || !accountabilityId) { toast.error('Aprove o Numerário antes de lançar valores adicionais.'); return; }
    const amount = parseFloat(addAmount.replace(/\./g, '').replace(',', '.'));
    if (!addDate) { toast.error('Informe a data.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Informe um valor maior que zero.'); return; }
    setSaving(true);
    try {
      const iso = format(addDate, 'yyyy-MM-dd');
      const note = addNote.trim();
      const { error } = await (supabase as any).from('accounts_receivable').insert({
        company_id: companyId,
        source: 'manual',
        quote_id: quoteId,
        shipment_id: quote?.shipment_id || null,
        client_id: quote?.client_id || null,
        description: note ? `Complemento de Numerário — ${note}` : 'Complemento de Numerário',
        currency: 'BRL',
        amount,
        due_date: iso,
        status: 'recebido',
        received_at: iso,
        received_amount: amount,
        accountability_id: accountabilityId,
        created_by: profile?.user_id || null,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      setAddOpen(false);
      setAddAmount('');
      setAddNote('');
      setAddDate(new Date());
      toast.success('Valor lançado — já consta em Movimentações.');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao lançar valor.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Saldo do cliente */}
      <Card className="glass">
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Depositado pelo cliente</p>
              <p className="text-lg font-semibold font-mono">R$ {fmtBRL(totalDepositado)}</p>
              <p className="text-[11px] text-muted-foreground">Numerário + NDs recebidos (Contas a Receber / Movimentações)</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Custos do processo</p>
              <p className="text-lg font-semibold font-mono">R$ {fmtBRL(custos)}</p>
              <p className="text-[11px] text-muted-foreground">Soma de todas as taxas de compra da aba Taxas</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saldo (Depositado − Custos)</p>
              <div className="flex items-center gap-2">
                <p className={`text-2xl font-bold font-mono ${saldo < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {saldo < 0 ? '− ' : ''}R$ {fmtBRL(Math.abs(saldo))}
                </p>
                {!locked && (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    title={accountabilityId ? 'Lançar valor adicional do cliente' : 'Aprove o Numerário para poder lançar valores adicionais'}
                    disabled={!accountabilityId}
                    onClick={() => setAddOpen(true)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar valor adicional</DialogTitle>
            <DialogDescription>
              Entra em Movimentações como Receita do processo, já recebida, e soma ao valor depositado pelo cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Data do recebimento</Label>
              <DateField value={addDate} onChange={setAddDate} allowClear={false} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valor (R$)</Label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                className="h-10 text-right font-mono"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Observação (opcional)</Label>
              <Input
                className="h-10"
                placeholder="Ex: complemento de impostos..."
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prestação de Contas (já existente) */}
      <AccountabilityTab quoteId={quoteId} quote={quote} companyId={companyId} isFinalized={isFinalized} isExport={isExport} />
    </div>
  );
}

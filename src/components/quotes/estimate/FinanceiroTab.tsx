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
import { useExchangeRate } from '@/hooks/useExchangeRate';
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
}

function fmtBRL(n: number) {
  return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Aba "Financeiro" do processo: o "caixa" do cliente. No topo, o saldo dos
// depósitos; logo abaixo, os depósitos; e embaixo a Prestação de Contas, que
// vai abatendo do saldo à medida que cada item é confirmado como pago.
export function FinanceiroTab({ quoteId, quote, companyId, isFinalized, isExport }: Props) {
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
  // Custos do processo = soma das despesas do processo em Financeiro → Despesa por Processo (contas a pagar
  // ligadas à referência do processo — cotação e/ou embarque —, abertas e pagas; canceladas ficam de fora).
  // Saldo = Depositado − Custos.
  const shipmentId: string | null = quote?.shipment_id || null;
  const { usdBrl, eurBrl } = useExchangeRate();
  const { data: despesas = [] } = useQuery({
    queryKey: ['accounts_payable', 'processo-custos', quoteId, shipmentId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounts_payable')
        .select('id, amount, currency, exchange_rate, debit_note_id, status')
        .or(shipmentId ? `quote_id.eq.${quoteId},shipment_id.eq.${shipmentId}` : `quote_id.eq.${quoteId}`)
        .neq('status', 'cancelado');
      if (error) throw error;
      return (data || []) as Array<{ id: string; amount: number; currency: string | null; exchange_rate: number | null; debit_note_id: string | null; status: string }>;
    },
  });
  const debitNoteIds = Array.from(new Set(despesas.map(d => d.debit_note_id).filter(Boolean))) as string[];
  const { data: dnRates = [] } = useQuery({
    queryKey: ['debit_notes', 'rates', debitNoteIds.join(',')],
    enabled: debitNoteIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any).from('debit_notes').select('id, exchange_rate').in('id', debitNoteIds);
      return (data || []) as Array<{ id: string; exchange_rate: number | null }>;
    },
  });
  // Mesmo critério de câmbio do Contas a Pagar: o da própria despesa (pagamento) ou o digitado na DN; só na falta
  // dos dois cai para a cotação do dia.
  const dnRateMap = new Map(dnRates.map(d => [d.id, d.exchange_rate]));
  const despesaBrl = (d: { amount: number; currency: string | null; exchange_rate: number | null; debit_note_id: string | null }) => {
    const cur = (d.currency || 'BRL').toUpperCase();
    let rate = 1;
    if (cur !== 'BRL') {
      const stored = d.debit_note_id ? dnRateMap.get(d.debit_note_id) : null;
      if (d.exchange_rate != null && Number(d.exchange_rate) > 0) rate = Number(d.exchange_rate);
      else if (stored != null && Number(stored) > 0) rate = Number(stored);
      else if (cur === 'USD') rate = usdBrl || 0;
      else if (cur === 'EUR') rate = eurBrl || 0;
    }
    return Number(d.amount || 0) * rate;
  };
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 || 0;
  const custos = r2(despesas.reduce((s, d) => s + despesaBrl(d), 0));
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
              <p className="text-[11px] text-muted-foreground">Despesas do processo (Financeiro → Despesa por Processo)</p>
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

import { useMemo, useState } from 'react';
import { MonthSelect } from './MonthSelect';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TrendingUp, TrendingDown, DollarSign, Receipt, Target, Percent, Wallet } from 'lucide-react';
import { useExchangeRate } from '@/hooks/useExchangeRate';

function fmtBRL(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function currentMonthISO() {
  // Mesmo bug do FixedAccountsTab.tsx: montar a data local e depois usar
  // toISOString() converte pra UTC, e em fusos atrás de UTC (Brasil, UTC-3)
  // isso pode empurrar o dia 1 pro dia 2 dependendo da hora local. Monta a
  // string direto do ano/mês locais pra evitar o desvio.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function OverviewTab() {
  const [referenceMonth, setReferenceMonth] = useState(currentMonthISO());
  const monthStart = referenceMonth;
  const monthEnd = useMemo(() => {
    const d = new Date(referenceMonth + 'T00:00:00');
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }, [referenceMonth]);

  const { usdBrl, eurBrl, loading: ratesLoading } = useExchangeRate();

  // "Resultado do mês" é regime de caixa: soma tudo que foi de fato recebido
  // dentro do mês (accounts_receivable.received_at) e deduz tudo que foi de
  // fato pago dentro do mês (accounts_payable.paid_at + despesas fixas
  // pagas) — não o que foi lançado/competência do processo.
  // A Visão Geral costumava ficar com dado velho até o usuário dar F5: as
  // queries seguiam o staleTime global (3 min) e nada em Contas a Pagar/
  // Receber ou na aba Geral invalidava essas chaves específicas ao lançar
  // ou pagar/receber algo. `refetchOnMount: 'always'` força buscar de novo
  // do servidor toda vez que a página é (re)aberta, sem depender de cache.
  const { data: cashIn = [] } = useQuery({
    queryKey: ['financial-overview-cash-in', monthStart, monthEnd],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts_receivable' as any)
        .select('amount, received_amount, currency, received_at, debit_note_id')
        .eq('status', 'recebido')
        .gte('received_at', monthStart)
        .lt('received_at', monthEnd);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const { data: cashOutAp = [] } = useQuery({
    queryKey: ['financial-overview-cash-out-ap', monthStart, monthEnd],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts_payable' as any)
        .select('amount, currency, paid_at, debit_note_id')
        .eq('status', 'pago')
        .gte('paid_at', monthStart)
        .lt('paid_at', monthEnd);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const { data: cashOutOverhead = [] } = useQuery({
    queryKey: ['financial-overview-cash-out-overhead', monthStart, monthEnd],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('overhead_entries')
        .select('amount, currency, paid_at')
        .eq('status', 'paid')
        .eq('kind', 'despesa')
        .gte('paid_at', monthStart)
        .lt('paid_at', monthEnd);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  // Receita da empresa lançada em "Geral" (kind='receita', ex.: serviços,
  // comissões) recebida dentro do mês — soma no total junto com o recebido
  // dos processos, já que a regra agora é "TUDO que entrou menos TUDO que
  // saiu", sem distinguir origem.
  const { data: cashInOverhead = [] } = useQuery({
    queryKey: ['financial-overview-cash-in-overhead', monthStart, monthEnd],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('overhead_entries')
        .select('amount, currency, paid_at')
        .eq('status', 'paid')
        .eq('kind', 'receita')
        .gte('paid_at', monthStart)
        .lt('paid_at', monthEnd);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Câmbio de cada linha tem que ser o digitado pelo usuário na hora de
  // criar a DN/ND vinculada (mesma correção já feita em Contas a Pagar/Receber),
  // não a cotação do dia — senão o resultado do mês passado muda todo dia.
  const debitNoteIds = Array.from(new Set([
    ...cashIn.map((r: any) => r.debit_note_id),
    ...cashOutAp.map((r: any) => r.debit_note_id),
  ].filter(Boolean))) as string[];
  const { data: dnRates = [] } = useQuery({
    queryKey: ['financial-overview-dn-rates', debitNoteIds.join(',')],
    enabled: debitNoteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('debit_notes' as any).select('id, exchange_rate').in('id', debitNoteIds);
      if (error) throw error;
      return (data || []) as unknown as Array<{ id: string; exchange_rate: number | null }>;
    },
  });
  const dnRateMap = new Map(dnRates.map((d) => [d.id, d.exchange_rate]));

  function toBRL(amount: number, currency?: string | null, debitNoteId?: string | null) {
    const v = Number(amount || 0);
    const c = (currency || 'BRL').toUpperCase();
    if (c === 'BRL') return v;
    const stored = debitNoteId ? dnRateMap.get(debitNoteId) : null;
    const rate = stored != null ? Number(stored) : c === 'USD' ? (usdBrl || 0) : c === 'EUR' ? (eurBrl || 0) : 0;
    return v * rate;
  }

  // Fluxo previsto 30 dias
  const next30End = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const { data: upcomingPayables = [] } = useQuery({
    queryKey: ['financial-upcoming-payables', today, next30End],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts_payable' as any)
        .select('amount, currency, due_date, status')
        .eq('status', 'aberto')
        .gte('due_date', today)
        .lte('due_date', next30End);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const totals = useMemo(() => {
    const receitaProcessos = cashIn.reduce((s: number, r: any) => s + toBRL(r.received_amount ?? r.amount, r.currency, r.debit_note_id), 0);
    const receitaGeral = cashInOverhead.reduce((s: number, r: any) => s + toBRL(r.amount, r.currency), 0);
    const receita = receitaProcessos + receitaGeral;
    const custoVar = cashOutAp.reduce((s: number, r: any) => s + toBRL(r.amount, r.currency, r.debit_note_id), 0);
    const fixas = cashOutOverhead.reduce((s: number, r: any) => s + toBRL(r.amount, r.currency), 0);
    const lucroBruto = receita - custoVar;
    const lucroLiquido = lucroBruto - fixas;
    const margemBruta = receita > 0 ? (lucroBruto / receita) * 100 : 0;
    const margemLiquida = receita > 0 ? (lucroLiquido / receita) * 100 : 0;
    const pontoEquilibrio = margemBruta > 0 ? (fixas / (margemBruta / 100)) : 0;
    const fluxo30 = upcomingPayables.reduce((s: number, p: any) => s + toBRL(p.amount, p.currency), 0);
    const totalPago = custoVar + fixas;
    return { receita, receitaProcessos, receitaGeral, custoVar, fixas, totalPago, lucroBruto, lucroLiquido, margemBruta, margemLiquida, pontoEquilibrio, fluxo30 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashIn, cashInOverhead, cashOutAp, cashOutOverhead, upcomingPayables, dnRateMap, usdBrl, eurBrl]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Valores convertidos para BRL {usdBrl ? `(USD ${usdBrl.toFixed(4)} · EUR ${(eurBrl || 0).toFixed(4)})` : ''}. Regime de caixa: todo valor recebido no mês (processos + Geral), menos todo valor pago no mês (processos + Geral).
          {ratesLoading && ' · atualizando cotações...'}
        </p>
        <MonthSelect
          value={referenceMonth.slice(0, 7)}
          onChange={(v) => setReferenceMonth(v + '-01')}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Receita Bruta" value={fmtBRL(totals.receita)} icon={<TrendingUp className="w-5 h-5" />} tone="emerald" hint="Recebido no mês: processos + Geral" />
        <KPI label="Custo Variável" value={fmtBRL(totals.custoVar)} icon={<TrendingDown className="w-5 h-5" />} tone="destructive" hint="Pago dentro do mês (processos)" />
        <KPI label="Despesas Fixas" value={fmtBRL(totals.fixas)} icon={<Receipt className="w-5 h-5" />} tone="amber" hint="Pago dentro do mês (Geral)" />
        <KPI label="Lucro Líquido" value={fmtBRL(totals.lucroLiquido)} icon={<DollarSign className="w-5 h-5" />} tone={totals.lucroLiquido >= 0 ? 'emerald' : 'destructive'} highlight />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Lucro Bruto" value={fmtBRL(totals.lucroBruto)} icon={<DollarSign className="w-5 h-5" />} tone={totals.lucroBruto >= 0 ? 'emerald' : 'destructive'} />
        <KPI label="Margem Bruta" value={`${totals.margemBruta.toFixed(1)}%`} icon={<Percent className="w-5 h-5" />} tone="blue" />
        <KPI label="Margem Líquida" value={`${totals.margemLiquida.toFixed(1)}%`} icon={<Percent className="w-5 h-5" />} tone="blue" />
        <KPI label="Ponto de Equilíbrio" value={fmtBRL(totals.pontoEquilibrio)} icon={<Target className="w-5 h-5" />} tone="blue" hint="Receita necessária para cobrir os custos fixos" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI
          label="A Pagar (30 dias)"
          value={fmtBRL(totals.fluxo30)}
          icon={<Wallet className="w-5 h-5" />}
          tone="amber"
          hint="Soma das contas em aberto com vencimento nos próximos 30 dias"
        />
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">Resultado do mês</CardTitle>
          <p className="text-xs text-muted-foreground">Todo valor recebido no mês, deduzido de todo valor pago no mês.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <Row label="Recebido — processos" value={fmtBRL(totals.receitaProcessos)} />
            <Row label="Recebido — Geral" value={fmtBRL(totals.receitaGeral)} />
            <Row label="= Total Recebido" value={fmtBRL(totals.receita)} bold />
            <div className="h-px bg-border my-2" />
            <Row label="(-) Pago — processos" value={fmtBRL(totals.custoVar)} negative />
            <Row label="(-) Pago — Geral" value={fmtBRL(totals.fixas)} negative />
            <Row label="= Total Pago" value={fmtBRL(totals.totalPago)} bold negative />
            <div className="h-px bg-border my-2" />
            <Row label="= Saldo do mês" value={fmtBRL(totals.lucroLiquido)} bold highlight={totals.lucroLiquido >= 0 ? 'emerald' : 'destructive'} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({ label, value, icon, tone, highlight, hint }: { label: string; value: string; icon: React.ReactNode; tone?: string; highlight?: boolean; hint?: string }) {
  const toneMap: Record<string, string> = {
    emerald: 'text-emerald-500',
    destructive: 'text-destructive',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
  };
  const color = toneMap[tone || ''] || 'text-foreground';
  return (
    <Card className={`glass ${highlight ? 'ring-1 ring-primary/40' : ''}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</p>
            {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
          </div>
          <div className={`p-3 rounded-xl bg-secondary ${color}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold, negative, highlight }: { label: string; value: string; bold?: boolean; negative?: boolean; highlight?: 'emerald' | 'destructive' }) {
  const cls = highlight === 'emerald' ? 'text-emerald-500' : highlight === 'destructive' ? 'text-destructive' : negative ? 'text-destructive' : '';
  return (
    <div className="flex justify-between items-center">
      <span className={bold ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-semibold' : ''} ${cls}`}>{value}</span>
    </div>
  );
}
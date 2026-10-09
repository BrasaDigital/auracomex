import { lazy, Suspense } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useSalespersonClients } from '@/hooks/useSalespersonClients';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  Ship, CheckCircle,
  Plus, ArrowRight,
  CalendarClock, Wallet, PackageSearch, PackageCheck, FolderOpen, Route,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useTemaPorto } from '@/hooks/useTemaPorto';
import { DashboardPorto } from '@/components/dashboard/DashboardPorto';

// recharts é pesado (~100kB+ gzip) — lazy pra não entrar no bundle principal,
// carregado em toda página (Index não passa por Suspense de rota, é crítico).
const DashboardCharts = lazy(() => import('@/components/dashboard/DashboardCharts'));

const MODE_LABELS: Record<string, string> = {
  ocean_fcl: 'Marítimo FCL',
  ocean_lcl: 'Marítimo LCL',
  air: 'Aéreo',
  road: 'Rodoviário',
  multimodal: 'Multimodal',
};

const MODE_COLORS: Record<string, string> = {
  ocean_fcl: '#2563eb',
  ocean_lcl: '#60a5fa',
  air: '#f59e0b',
  road: '#16a34a',
  multimodal: '#a855f7',
};

export default function Index() {
  const { t } = useLanguage();
  const { ativo: porto } = useTemaPorto();
  const { profile, user } = useAuth();
  const { canAccessQuotes, canAccessShipments, canAccessFinancial, isScopedToOwnProcesses } = usePermissions();
  const { clientIds } = useSalespersonClients();

  // Build a client filter for salesperson scoping
  const scopeFilter = isScopedToOwnProcesses && clientIds ? clientIds : null;

  const now = new Date();
  const firstOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const todayIso = now.toISOString().slice(0, 10);

  // Opções de status de embarque da empresa (posição define a ordem do pipeline).
  // Usamos isso pra descobrir dinamicamente qual é o status final/terminal (o de maior
  // posição) e qual é o de "cancelado", já que cada empresa pode customizar os nomes.
  const { data: statusOptions = [] } = useQuery({
    queryKey: ['dashboard-status-options', profile?.company_id],
    enabled: canAccessShipments && !!profile?.company_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('shipment_status_options')
        .select('value, position')
        .eq('company_id', profile!.company_id)
        .order('position', { ascending: true });
      return (data || []) as { value: string; position: number }[];
    },
  });

  const finalStatusValue = statusOptions.length > 0 ? statusOptions[statusOptions.length - 1].value : null;
  const cancelledStatusValue = statusOptions.find((o) => o.value === 'cancelled')?.value ?? 'cancelled';

  const { data: pipelineShipments = [] } = useQuery({
    queryKey: ['dashboard-pipeline-shipments', scopeFilter],
    enabled: canAccessShipments,
    queryFn: async () => {
      let query = supabase
        .from('shipments')
        .select('id, status, transport_mode, created_at, updated_at');
      if (scopeFilter && scopeFilter.length > 0) {
        query = query.in('client_id', scopeFilter);
      } else if (scopeFilter && scopeFilter.length === 0) {
        return [];
      }
      const { data } = await query;
      return (data || []) as { id: string; status: string; transport_mode: string; created_at: string; updated_at: string }[];
    },
  });

  const { data: quoteStats } = useQuery({
    queryKey: ['dashboard-quotes', scopeFilter],
    enabled: canAccessQuotes,
    queryFn: async () => {
      let query = supabase
        .from('quotes')
        .select('id, status, created_by, created_at');
      if (scopeFilter && scopeFilter.length > 0) {
        query = query.in('client_id', scopeFilter);
      } else if (isScopedToOwnProcesses && user) {
        query = query.eq('created_by', user.id);
      }
      const { data } = await query;
      // Referências (cotações) criadas dentro do mês atual
      const createdThisMonth = (data || []).filter((q: any) => q.created_at >= firstOfMonthIso).length;
      return { createdThisMonth };
    },
  });

  // Fechamentos do mês: cotações convertidas em embarque dentro do mês atual
  // (a data de criação do embarque é a própria data da conversão).
  const closedThisMonth = pipelineShipments.filter((s) => s.created_at >= firstOfMonthIso).length;

  // Embarques em andamento: referências já convertidas em embarque, menos as canceladas
  // e as já finalizadas.
  const shipmentsInProgress = pipelineShipments.filter(
    (s) => s.status !== finalStatusValue && s.status !== cancelledStatusValue
  );

  const modeDistribution = Object.entries(
    shipmentsInProgress.reduce((acc: Record<string, number>, s) => {
      const mode = s.transport_mode || 'multimodal';
      acc[mode] = (acc[mode] || 0) + 1;
      return acc;
    }, {})
  ).map(([mode, count]) => ({ mode, label: MODE_LABELS[mode] || mode, count, fill: MODE_COLORS[mode] || '#94a3b8' }));

  const modeChartConfig = Object.fromEntries(
    Object.entries(MODE_LABELS).map(([mode, label]) => [mode, { label, color: MODE_COLORS[mode] }])
  );

  // Evolução: número de embarques criados por mês (últimos 6 meses, incluindo o atual)
  const monthlyEvolution = (() => {
    const months: { key: string; label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      months.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1), count: 0 });
    }
    pipelineShipments.forEach((s) => {
      const d = new Date(s.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = months.find((m) => m.key === key);
      if (bucket) bucket.count += 1;
    });
    return months;
  })();

  const evolutionChartConfig = { count: { label: 'Embarques', color: '#2563eb' } };

  // --- "Requer atenção" queries ---

  // Cotações atrasadas: enviadas ao cliente e com validade já vencida
  const { data: quotesOverdue = [] } = useQuery({
    queryKey: ['dashboard-quotes-overdue', scopeFilter],
    enabled: canAccessQuotes,
    queryFn: async () => {
      let query = supabase
        .from('quotes')
        .select('id, quote_number, valid_until, clients(name)')
        .eq('status', 'sent')
        .not('valid_until', 'is', null)
        .lte('valid_until', now.toISOString());
      if (scopeFilter && scopeFilter.length > 0) {
        query = query.in('client_id', scopeFilter);
      } else if (isScopedToOwnProcesses && user) {
        query = query.eq('created_by', user.id);
      }
      const { data } = await query.order('valid_until', { ascending: true }).limit(5);
      return data || [];
    },
  });

  // Embarques em atenção: next_update igual ou anterior ao dia de acesso
  const { data: shipmentAlerts = [] } = useQuery({
    queryKey: ['dashboard-shipment-alerts', scopeFilter],
    enabled: canAccessShipments,
    queryFn: async () => {
      let query = supabase
        .from('shipments')
        .select('id, reference_number, status, next_update, clients(name)')
        .in('status', ['booked', 'in_transit', 'arrived'])
        .not('next_update', 'is', null)
        .lte('next_update', now.toISOString());
      if (scopeFilter && scopeFilter.length > 0) {
        query = query.in('client_id', scopeFilter);
      } else if (scopeFilter && scopeFilter.length === 0) {
        return [];
      }
      const { data } = await query.order('next_update', { ascending: true }).limit(5);
      return data || [];
    },
  });

  // Financeiro em atenção: pagáveis/recebíveis com vencimento igual ou anterior ao dia de acesso
  const { data: overdueFinancial } = useQuery({
    queryKey: ['dashboard-overdue-financial'],
    enabled: canAccessFinancial,
    queryFn: async () => {
      const [{ data: ar }, { data: ap }] = await Promise.all([
        supabase
          .from('accounts_receivable')
          .select('id, description, amount, currency, due_date')
          .in('status', ['aberto', 'atrasado'])
          .lte('due_date', todayIso)
          .order('due_date', { ascending: true }),
        supabase
          .from('accounts_payable')
          .select('id, description, amount, currency, due_date')
          .in('status', ['aberto', 'atrasado'])
          .lte('due_date', todayIso)
          .order('due_date', { ascending: true }),
      ]);
      return { receivable: ar || [], payable: ap || [] };
    },
  });

  const overdueReceivableTotal = (overdueFinancial?.receivable || []).reduce((acc: Record<string, number>, r: any) => {
    const cur = r.currency || 'USD';
    acc[cur] = (acc[cur] || 0) + Number(r.amount);
    return acc;
  }, {} as Record<string, number>);
  const overduePayableTotal = (overdueFinancial?.payable || []).reduce((acc: Record<string, number>, r: any) => {
    const cur = r.currency || 'USD';
    acc[cur] = (acc[cur] || 0) + Number(r.amount);
    return acc;
  }, {} as Record<string, number>);

  const fmtMoney = (amount: number, currency: string) =>
    `${currency} ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');

  // Só mostra a seção "Requer atenção" se o usuário tiver acesso a pelo menos uma das áreas
  const showAttentionSection = canAccessShipments || canAccessQuotes || canAccessFinancial;

  if (porto) {
    return (
      <DashboardPorto
        fechamentos={closedThisMonth}
        referencias={quoteStats?.createdThisMonth ?? 0}
        emAndamento={shipmentsInProgress.length}
        podeCotacoes={canAccessQuotes}
        podeEmbarques={canAccessShipments}
        podeFinanceiro={canAccessFinancial}
        cotacoesAtrasadas={quotesOverdue as any}
        embarquesAtencao={shipmentAlerts as any}
        aReceber={overdueReceivableTotal}
        aPagar={overduePayableTotal}
        graficos={
          <Suspense fallback={<div className="h-64 bg-card border border-border animate-pulse" />}>
            <DashboardCharts
              stacked
              noDataLabel={t('common.no_data')}
              modeDistribution={modeDistribution}
              modeChartConfig={modeChartConfig}
              monthlyEvolution={monthlyEvolution}
              evolutionChartConfig={evolutionChartConfig}
            />
          </Suspense>
        }
      />
    );
  }

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Fechamentos, Referências e Embarques em andamento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="glass hover:shadow-lg transition-shadow">
          <CardContent className="p-5 relative">
            <div className="absolute top-5 left-5 p-3.5 rounded-xl bg-secondary text-status-completed">
              <PackageCheck className="w-7 h-7" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Fechamentos
              </p>
              <p className="text-3xl font-bold mt-1">{closedThisMonth}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass hover:shadow-lg transition-shadow">
          <CardContent className="p-5 relative">
            <div className="absolute top-5 left-5 p-3.5 rounded-xl bg-secondary text-status-attention">
              <FolderOpen className="w-7 h-7" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Referências
              </p>
              <p className="text-3xl font-bold mt-1">{quoteStats?.createdThisMonth ?? 0}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass hover:shadow-lg transition-shadow">
          <CardContent className="p-5 relative">
            <div className="absolute top-5 left-5 p-3.5 rounded-xl bg-secondary text-status-transit">
              <Route className="w-7 h-7" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Embarques em andamento
              </p>
              <p className="text-3xl font-bold mt-1">{shipmentsInProgress.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Requer atenção */}
      {showAttentionSection && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {canAccessQuotes && (
            <Card className="glass">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4 text-status-attention" />
                  Cotações Atrasadas
                </CardTitle>
                <Link to="/quotes" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  Ver todas <ArrowRight className="w-3 h-3" />
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {quotesOverdue.length === 0 ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-status-completed" /> Nenhuma cotação atrasada
                  </p>
                ) : (
                  quotesOverdue.map((q: any) => (
                    <Link
                      key={q.id}
                      to="/quotes"
                      className="block text-xs border-l-2 border-status-attention pl-2.5 py-0.5 hover:bg-secondary/50 rounded-r"
                    >
                      <p className="font-medium">{q.quote_number || '—'} · {q.clients?.name || '-'}</p>
                      <p className="text-muted-foreground">Venceu em {fmtDate(q.valid_until)}</p>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {canAccessShipments && (
            <Card className="glass">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <PackageSearch className="w-4 h-4 text-status-attention" />
                  Embarques em Atenção
                </CardTitle>
                <Link to="/shipments" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  Ver todos <ArrowRight className="w-3 h-3" />
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {shipmentAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-status-completed" /> Tudo em dia
                  </p>
                ) : (
                  shipmentAlerts.map((s: any) => (
                    <Link
                      key={s.id}
                      to="/shipments"
                      className="block text-xs border-l-2 border-status-attention pl-2.5 py-0.5 hover:bg-secondary/50 rounded-r"
                    >
                      <p className="font-medium">{s.reference_number || '—'} · {s.clients?.name || '-'}</p>
                      <p className="text-muted-foreground">Sem atualização: {fmtDate(s.next_update)}</p>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {canAccessFinancial && (
            <Card className="glass">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-status-attention" />
                  Financeiro em Atenção
                </CardTitle>
                <Link to="/financial/processo" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  Ver tudo <ArrowRight className="w-3 h-3" />
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {(overdueFinancial?.receivable?.length ?? 0) === 0 && (overdueFinancial?.payable?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-status-completed" /> Nada vencido
                  </p>
                ) : (
                  <>
                    {Object.keys(overdueReceivableTotal).length > 0 && (
                      <div className="text-xs">
                        <p className="font-medium text-status-completed">A receber vencido</p>
                        {Object.entries(overdueReceivableTotal).map(([cur, val]) => (
                          <p key={cur} className="text-muted-foreground">{fmtMoney(val, cur)}</p>
                        ))}
                      </div>
                    )}
                    {Object.keys(overduePayableTotal).length > 0 && (
                      <div className="text-xs">
                        <p className="font-medium text-destructive">A pagar vencido</p>
                        {Object.entries(overduePayableTotal).map(([cur, val]) => (
                          <p key={cur} className="text-muted-foreground">{fmtMoney(val, cur)}</p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Gráfico de pizza (modais) + gráfico de linha (evolução mensal) */}
      {canAccessShipments && (
        <Suspense
          fallback={
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="glass"><CardContent className="h-64 animate-pulse" /></Card>
              <Card className="glass"><CardContent className="h-64 animate-pulse" /></Card>
            </div>
          }
        >
          <DashboardCharts
            noDataLabel={t('common.no_data')}
            modeDistribution={modeDistribution}
            modeChartConfig={modeChartConfig}
            monthlyEvolution={monthlyEvolution}
            evolutionChartConfig={evolutionChartConfig}
          />
        </Suspense>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSalespersonClients } from '@/hooks/useSalespersonClients';
import { groupByCurrency } from '@/lib/utils';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { calcItemCbm, calcItemWeight, calcChargeableWeight, getEffectiveVolume, effectiveCalcItems, type CargoVolume } from '@/components/quotes/ModeFields';
import { Plus, Copy, CircleCheck, XCircle, FileText, Clock, Ship, Sparkles } from 'lucide-react';
import { QuoteCreateModal } from '@/components/quotes/QuoteCreateModal';
import { QuoteDetail } from '@/components/quotes/QuoteDetail';
import { DuplicateQuoteDialog } from '@/components/quotes/DuplicateQuoteDialog';
import { RejectQuoteDialog } from '@/components/quotes/RejectQuoteDialog';
import { AiImportQuoteModal } from '@/components/quotes/AiImportQuoteModal';
import { useAddonGate } from '@/components/billing/ModuleGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ModeIcon } from '@/components/shared/ModeIcon';
import { format, startOfMonth } from 'date-fns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useTableSort } from '@/hooks/useTableSort';
import { SortableHeader } from '@/components/shared/SortableHeader';
import { ColumnSearch } from '@/components/shared/ColumnSearch';

function getSentIconColor(quote: any): string {
  if (quote.sent_at) return 'text-status-completed';
  const created = new Date(quote.created_at).getTime();
  const now = Date.now();
  const hours24 = 24 * 60 * 60 * 1000;
  if (now - created > hours24) return 'text-orange-500';
  return 'text-muted-foreground';
}

function getSentTooltip(quote: any, t: (key: string) => string): string {
  if (quote.sent_at) return `${t('quotes.sent_at')}: ${format(new Date(quote.sent_at), 'dd/MM/yy HH:mm')}`;
  const created = new Date(quote.created_at).getTime();
  const now = Date.now();
  const hours24 = 24 * 60 * 60 * 1000;
  if (now - created > hours24) return t('quotes.not_sent_warning');
  return t('quotes.mark_sent');
}

function computeQuoteProfitBrl(q: any, usdBrl: number, eurBrl: number): number {
  const qCharges = q.quote_charges || [];
  const qItems = (q.quote_items || []).map((item: any) => ({
    container_type: item.container_type || '20GP',
    container_qty: item.container_qty || 1,
    weight_kg: String(item.weight_kg || ''),
    volume_cbm: String(item.volume_cbm || ''),
    chargeable_weight: String(item.chargeable_weight || ''),
    length_cm: String(item.length_cm || ''),
    width_cm: String(item.width_cm || ''),
    height_cm: String(item.height_cm || ''),
    packages: String(item.packages || ''),
    ncm_code: item.ncm_code || '',
    commodity: item.commodity || '',
    dangerous_goods: item.dangerous_goods || false,
    vehicle_type: item.vehicle_type || '',
  }));
  // Linhas de volume do embarque mandam no peso/cubagem; sem elas, vale o formato antigo (medidas no item).
  const qVolumes: CargoVolume[] = (q.quote_cargo_volumes || []).map((v: any) => ({
    qty: String(v.qty ?? ''), package_type: v.package_type || '',
    length_cm: String(v.length_cm ?? ''), width_cm: String(v.width_cm ?? ''), height_cm: String(v.height_cm ?? ''),
    weight_kg: String(v.weight_kg ?? ''), volume_cbm: String(v.volume_cbm ?? ''),
  }));
  const calcItems = effectiveCalcItems(q.transport_mode, qItems, qVolumes);
  const totalWeight = calcItems.reduce((s: number, i: any) => s + calcItemWeight(i), 0);
  const totalCbm = calcItems.reduce((s: number, i: any) => s + getEffectiveVolume(i), 0);
  const totalChargeable = calcChargeableWeight(calcItems, q.transport_mode);
  const totalContainers = qItems.reduce((s: number, i: any) => s + (i.container_qty || 1), 0);
  const totalContainers20 = qItems.reduce((s: number, i: any) => s + ((i.container_type || '').startsWith('20') ? (i.container_qty || 1) : 0), 0);
  const totalContainers40 = qItems.reduce((s: number, i: any) => s + ((i.container_type || '').startsWith('40') ? (i.container_qty || 1) : 0), 0);
  const mult = (unit: string) => {
    switch (unit) {
      case 'per_cw': return totalChargeable;
      case 'per_ton': return totalWeight / 1000;
      case 'per_cbm': return totalCbm;
      case 'per_wm': return Math.max(totalWeight / 1000, totalCbm);
      case 'per_container': return totalContainers;
      case 'per_container_20': return totalContainers20;
      case 'per_container_40': return totalContainers40;
      case 'per_bl': return 1;
      default: return 1;
    }
  };
  // Taxas prepaid (já pagas na origem) não entram no Lucro Estimado — mesma
  // regra que já exclui prepaid do Numerário em estimateSync.ts. Filtra aqui
  // antes de somar, pra não duplicar essa checagem em cada lugar que soma
  // quote_charges.
  const profitCharges = qCharges.filter((c: any) => c.payment_term !== 'prepaid');
  const sellMap = groupByCurrency(profitCharges, (c: any) => c.currency || 'USD', (c: any) => (c.sell_amount || 0) * mult(c.billing_unit || 'fixed'));
  const buyMap = groupByCurrency(profitCharges, (c: any) => c.currency || 'USD', (c: any) => (c.buy_amount || 0) * mult(c.billing_unit || 'fixed'));
  const allCurs = [...new Set([...Object.keys(sellMap), ...Object.keys(buyMap)])];
  let totalBrl = 0;
  allCurs.forEach((cur) => {
    const val = (sellMap[cur] || 0) - (buyMap[cur] || 0);
    if (cur === 'BRL') totalBrl += val;
    else if (cur === 'USD') totalBrl += val * (usdBrl || 0);
    else if (cur === 'EUR') totalBrl += val * (eurBrl || 0);
    else totalBrl += val * (usdBrl || 0);
  });
  return totalBrl;
}

export default function Quotes() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { usdBrl, eurBrl } = useExchangeRate();
  const { isSalesperson, clientIds } = useSalespersonClients();
  const { profile } = useAuth();
  const aiImportGate = useAddonGate('ai_import');
  const [searchNumber, setSearchNumber] = useState('');
  const [searchClient, setSearchClient] = useState('');
  const [searchOrigin, setSearchOrigin] = useState('');
  const [searchDestination, setSearchDestination] = useState('');
  const [searchNumberOpen, setSearchNumberOpen] = useState(false);
  const [searchClientOpen, setSearchClientOpen] = useState(false);
  const [searchOriginOpen, setSearchOriginOpen] = useState(false);
  const [searchDestinationOpen, setSearchDestinationOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [aiImportOpen, setAiImportOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [duplicateQuote, setDuplicateQuote] = useState<any>(null);
  const [rejectQuote, setRejectQuote] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'rejected'>('active');

  // Mesmo ajuste do Shipments.tsx: clicar em "Cotações" no menu enquanto já
  // se está em /quotes não muda de rota, então sem isso a cotação aberta
  // ficava presa na tela.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    // Links externos (ex: financeiro) abrem uma cotação específica via
    // ?open=<id>, já que /quotes/:id não é uma rota de verdade — a cotação
    // é sempre exibida por estado local dentro desta página.
    const openId = new URLSearchParams(location.search).get('open');
    setSelectedQuoteId(openId || null);
    // A query da lista continua "montada" o tempo todo (só fica escondida
    // enquanto uma cotação está aberta), então só resetar o id não busca
    // dados novos — precisa invalidar/forçar refetch aqui.
    queryClient.invalidateQueries({ queryKey: ['quotes'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // All quotes for the list (excluding approved/converted always; rejeitadas
  // ficam de fora da aba principal pra não "sujar" a lista, e só aparecem
  // na aba Rejeitadas).
  const { data: quotes = [] } = useQuery({
    queryKey: ['quotes', isSalesperson, clientIds, activeTab],
    queryFn: async () => {
      let query = supabase
        .from('quotes')
        .select('id, quote_number, status, transport_mode, origin, destination, valid_until, created_at, sent_at, client_id, currency, clients(name), quote_charges(id, sell_amount, buy_amount, currency, billing_unit, payment_term), quote_items(container_type, container_qty, weight_kg, volume_cbm, chargeable_weight, length_cm, width_cm, height_cm, packages, commodity, dangerous_goods, vehicle_type), quote_cargo_volumes(qty, package_type, length_cm, width_cm, height_cm, weight_kg, volume_cbm)')
        .order('created_at', { ascending: false });

      if (activeTab === 'rejected') {
        query = query.eq('status', 'rejected');
      } else {
        query = query.not('status', 'in', '("approved","converted","rejected")');
      }

      if (isSalesperson && clientIds && clientIds.length > 0) {
        query = query.in('client_id', clientIds);
      } else if (isSalesperson) {
        return [];
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Contagem de rejeitadas pra mostrar na aba, sem precisar trocar de aba pra saber
  const { data: rejectedCount = 0 } = useQuery({
    queryKey: ['quotes-rejected-count', isSalesperson, clientIds],
    queryFn: async () => {
      let query = supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'rejected');
      if (isSalesperson && clientIds && clientIds.length > 0) {
        query = query.in('client_id', clientIds);
      } else if (isSalesperson) return 0;
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
  });

  // Stats: quotes this month (all statuses)
  const monthStart = startOfMonth(new Date()).toISOString();
  const { data: monthTotal = 0 } = useQuery({
    queryKey: ['quotes-month-total', isSalesperson, clientIds],
    queryFn: async () => {
      let query = supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart);
      if (isSalesperson && clientIds && clientIds.length > 0) {
        query = query.in('client_id', clientIds);
      } else if (isSalesperson) return 0;
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
  });

  // Stats: pending response — sent but no approval/rejection (all months)
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['quotes-pending', isSalesperson, clientIds],
    queryFn: async () => {
      let query = supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .in('status', ['quoting', 'draft', 'sent']);
      if (isSalesperson && clientIds && clientIds.length > 0) {
        query = query.in('client_id', clientIds);
      } else if (isSalesperson) return 0;
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
  });

  // Stats: converted to shipment (this month only)
  const { data: convertedCount = 0 } = useQuery({
    queryKey: ['quotes-converted', isSalesperson, clientIds],
    queryFn: async () => {
      let query = supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .in('status', ['approved', 'converted'])
        .gte('updated_at', monthStart);
      if (isSalesperson && clientIds && clientIds.length > 0) {
        query = query.in('client_id', clientIds);
      } else if (isSalesperson) return 0;
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
  });

  const filtered = quotes.filter((q: any) => {
    const matchesNumber = !searchNumber || q.quote_number?.toLowerCase().includes(searchNumber.toLowerCase());
    const matchesClient = !searchClient || (q.clients as any)?.name?.toLowerCase().includes(searchClient.toLowerCase());
    const matchesOrigin = !searchOrigin || q.origin?.toLowerCase().includes(searchOrigin.toLowerCase());
    const matchesDestination = !searchDestination || q.destination?.toLowerCase().includes(searchDestination.toLowerCase());
    return matchesNumber && matchesClient && matchesOrigin && matchesDestination;
  });

  const { sorted, sortState, toggleSort } = useTableSort<any>(filtered, {
    quote_number: (r) => r.quote_number,
    client: (r) => r.clients?.name,
    origin: (r) => r.origin,
    destination: (r) => r.destination,
    profit: (r) => computeQuoteProfitBrl(r, usdBrl, eurBrl),
    valid_until: (r) => r.valid_until,
    status: (r) => r.status,
  }, { storageKey: profile?.user_id ? `aura:sort:${profile.user_id}:quotes` : undefined });

  async function handleMarkSent(e: React.MouseEvent, quote: any) {
    e.stopPropagation();
    if (quote.sent_at) return; // Already sent
    try {
      const { error } = await (supabase.from('quotes') as any)
        .update({ sent_at: new Date().toISOString(), status: 'sent' })
        .eq('id', quote.id);
      if (error) throw error;
      toast.success(t('quotes.marked_sent_success'));
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (selectedQuoteId) {
    return (
      <QuoteDetail
        quoteId={selectedQuoteId}
        onBack={() => {
          setSelectedQuoteId(null);
          navigate('/quotes', { replace: true });
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
        }}
      />
    );
  }

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass hover:shadow-lg transition-shadow">
          <CardContent className="p-5 relative">
            <div className="absolute top-5 left-5 p-3.5 rounded-xl bg-secondary text-primary">
              <FileText className="w-7 h-7" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t('quotes.month_total')}
              </p>
              <p className="text-3xl font-bold mt-1">{monthTotal}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass hover:shadow-lg transition-shadow">
          <CardContent className="p-5 relative">
            <div className="absolute top-5 left-5 p-3.5 rounded-xl bg-secondary text-status-attention">
              <Clock className="w-7 h-7" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t('quotes.pending_response')}
              </p>
              <p className="text-3xl font-bold mt-1">{pendingCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass hover:shadow-lg transition-shadow">
          <CardContent className="p-5 relative">
            <div className="absolute top-5 left-5 p-3.5 rounded-xl bg-secondary text-status-completed">
              <Ship className="w-7 h-7" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t('quotes.converted_count')}
              </p>
              <p className="text-3xl font-bold mt-1">{convertedCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'active' | 'rejected')}>
          <TabsList>
            <TabsTrigger value="active">Ativas</TabsTrigger>
            <TabsTrigger value="rejected">Rejeitadas{rejectedCount > 0 ? ` (${rejectedCount})` : ''}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          {/* Importar com IA — escondido por hora enquanto a integração de IA está sendo ajustada.
              Pra reativar: descomenta este bloco. */}
          {false && (
            <Button
              variant="outline"
              onClick={() => {
                if (!aiImportGate.hasAccess) {
                  toast.info('Este recurso é um add-on. Ative em Assinatura.');
                  return;
                }
                setAiImportOpen(true);
              }}
              title={aiImportGate.lockedTitle}
              className={!aiImportGate.hasAccess ? 'opacity-60' : ''}
            >
              <Sparkles className="w-4 h-4 mr-2" />Importar com IA
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" />{t('quotes.new')}</Button>
        </div>
      </div>

      <Card className="glass">
        <CardContent className="p-0">
          <Table className="text-[15px]">
            <TableHeader>
              <TableRow>
                <SortableHeader
                  label={t('quotes.number')}
                  sortKey="quote_number"
                  state={sortState}
                  onToggle={toggleSort}
                  className="h-8 px-4 text-sm"
                  right={<ColumnSearch value={searchNumber} onChange={setSearchNumber} open={searchNumberOpen} onOpenChange={setSearchNumberOpen} />}
                />
                <SortableHeader
                  label={t('shipments.client')}
                  sortKey="client"
                  state={sortState}
                  onToggle={toggleSort}
                  className="h-8 px-4 text-sm"
                  right={<ColumnSearch value={searchClient} onChange={setSearchClient} open={searchClientOpen} onOpenChange={setSearchClientOpen} />}
                />
                <SortableHeader
                  label={t('shipments.origin')}
                  sortKey="origin"
                  state={sortState}
                  onToggle={toggleSort}
                  className="h-8 px-4 text-sm"
                  right={<ColumnSearch value={searchOrigin} onChange={setSearchOrigin} open={searchOriginOpen} onOpenChange={setSearchOriginOpen} />}
                />
                <SortableHeader
                  label={t('shipments.destination')}
                  sortKey="destination"
                  state={sortState}
                  onToggle={toggleSort}
                  className="h-8 px-4 text-sm"
                  right={<ColumnSearch value={searchDestination} onChange={setSearchDestination} open={searchDestinationOpen} onOpenChange={setSearchDestinationOpen} />}
                />
                <SortableHeader label="Lucro Estimado" sortKey="profit" state={sortState} onToggle={toggleSort} className="h-8 px-4 text-sm text-right" align="right" />
                <SortableHeader label={t('quotes.valid_until')} sortKey="valid_until" state={sortState} onToggle={toggleSort} className="h-8 px-4 text-sm" />
                <SortableHeader label={t('shipments.status')} sortKey="status" state={sortState} onToggle={toggleSort} className="h-8 px-4 text-sm" />
                <TableHead className="w-28 h-8 px-4"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">{t('common.no_data')}</TableCell></TableRow>
              ) : (
                sorted.map((q: any) => (
                  <TableRow
                    key={q.id}
                    className="cursor-pointer hover:bg-secondary/50 whitespace-nowrap"
                    onClick={() => setSelectedQuoteId(q.id)}
                  >
                    <TableCell className="py-0.5 px-4 font-mono font-medium">{q.quote_number}</TableCell>
                    <TableCell className="py-0.5 px-4 max-w-[180px] truncate">{(q.clients as any)?.name || '-'}</TableCell>
                    <TableCell className="py-0.5 px-4">{q.origin || '-'}</TableCell>
                    <TableCell className="py-0.5 px-4">{q.destination || '-'}</TableCell>
                    <TableCell className="py-0.5 px-4 text-right font-mono text-[15px] font-semibold">
                      {(() => {
                        // Reaproveita a mesma função usada pra ordenação (computeQuoteProfitBrl),
                        // em vez de uma segunda cópia da conta aqui — as duas tinham divergido
                        // (esta versão inline não tratava a unidade de cobrança per_wm).
                        const totalBrl = computeQuoteProfitBrl(q as any, usdBrl, eurBrl);
                        return (
                          <span className={totalBrl >= 0 ? 'text-status-completed' : 'text-status-urgent'}>
                            R$ {totalBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="py-0.5 px-4">{q.valid_until ? format(new Date(q.valid_until), 'dd/MM/yy') : '-'}</TableCell>
                    <TableCell className="py-0.5 px-4"><StatusBadge status={q.status} /></TableCell>
                    <TableCell className="py-0.5 px-3">
                        <div className="flex items-center gap-1.5">
                        {/* Mark as sent */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-4 w-4"
                              onClick={(e) => handleMarkSent(e, q)}
                            >
                              <CircleCheck className={`w-3 h-3 ${getSentIconColor(q)}`} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{getSentTooltip(q, t)}</TooltipContent>
                        </Tooltip>

                        {/* Reject */}
                        {q.status !== 'rejected' && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRejectQuote(q);
                                }}
                              >
                                <XCircle className="w-3 h-3 text-destructive" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('quotes.reject')}</TooltipContent>
                          </Tooltip>
                        )}

                        {/* Duplicate */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-4 w-4"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDuplicateQuote(q);
                              }}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('quotes.duplicate')}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <QuoteCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['quotes'] })}
      />

      <AiImportQuoteModal
        open={aiImportOpen}
        onClose={() => setAiImportOpen(false)}
        onCreated={(quoteId) => {
          setAiImportOpen(false);
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
          setSelectedQuoteId(quoteId);
        }}
      />

      <DuplicateQuoteDialog
        quote={duplicateQuote}
        onClose={() => setDuplicateQuote(null)}
        onDuplicated={() => {
          setDuplicateQuote(null);
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
        }}
      />

      <RejectQuoteDialog
        quote={rejectQuote}
        onClose={() => setRejectQuote(null)}
        onRejected={() => {
          setRejectQuote(null);
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
          queryClient.invalidateQueries({ queryKey: ['quotes-rejected-count'] });
        }}
      />
    </div>
  );
}

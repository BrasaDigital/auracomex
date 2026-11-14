import { formatMoney } from '@/lib/money';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { Plus, TrendingUp, TrendingDown, Receipt, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck, Lock, Trash2, Users, X } from 'lucide-react';
import { BenchmarkCard } from '@/components/shared/BenchmarkCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';

interface Props {
  shipmentId: string;
  companyId: string;
  clientId?: string | null;
  transportMode?: string;
  originPort?: string | null;
  destinationPort?: string | null;
  createdBy?: string | null;
  /** Processo Finalizado (categoria 'delivered') — trava toda a aba pra
   * somente leitura. Espelha o bloqueio já aplicado no banco. */
  isFinalized?: boolean;
}

type Direction = 'payable' | 'receivable';

interface AddForm {
  direction: Direction;
  partner_id: string;
  charge_type: string;
  description: string;
  amount: string;
  currency: string;
  exchange_rate: string;
  tax_rate: string;
}

const EMPTY_FORM: AddForm = {
  direction: 'payable',
  partner_id: '',
  charge_type: 'freight',
  description: '',
  amount: '',
  currency: 'USD',
  exchange_rate: '1',
  tax_rate: '0',
};

const CHARGE_TYPES = ['freight', 'handling', 'customs', 'insurance', 'documentation', 'storage', 'other'];
const CURRENCIES = ['USD', 'BRL', 'EUR'];

const CHARGE_TYPE_LABELS: Record<string, string> = {
  freight: 'Frete',
  handling: 'Handling',
  customs: 'Customs',
  insurance: 'Seguro',
  documentation: 'Doc',
  storage: 'Storage',
  other: 'Outros',
};

export function FinancialTab({ shipmentId, companyId, clientId, transportMode, originPort, destinationPort, createdBy, isFinalized }: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { canVerifyCharges, canProcessPayments, isFullAccess } = usePermissions();
  const isProcessOwner = user?.id === createdBy;
  const canSeeFinancials = isFullAccess || isProcessOwner;
  const locked = !!isFinalized;
  const canEditChargesHere = (isFullAccess || isProcessOwner) && !locked;
  const queryClient = useQueryClient();
  const { usdBrl, eurBrl } = useExchangeRate();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [descSearch, setDescSearch] = useState('');
  const [showDescSuggestions, setShowDescSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState('charges');
  const [partnerSearch, setPartnerSearch] = useState('');
  const [showPartnerPicker, setShowPartnerPicker] = useState(false);

  // Diferente da aba Logística, as ações financeiras (add/excluir/verificar
  // taxa etc.) não tocavam o updated_at do embarque — por isso a lista de
  // Embarques não refletia essas mudanças como "atividade". Chamado no
  // onSuccess de cada mutation financeira relevante.
  async function touchShipmentActivity() {
    await supabase.from('shipments').update({
      updated_at: new Date().toISOString(),
      next_update: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    } as any).eq('id', shipmentId);
    queryClient.invalidateQueries({ queryKey: ['shipments'] });
    queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] });
  }

  // Fetch shipment flags
  const { data: shipment } = useQuery({
    queryKey: ['shipment-flags', shipmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('charges_verified, financial_released')
        .eq('id', shipmentId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch charge_lines
  const { data: lines = [] } = useQuery({
    queryKey: ['charge-lines', shipmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('charge_lines')
        .select('*, clients(name)')
        .eq('shipment_id', shipmentId)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });

  // Fetch client name (used to suggest the client as partner on Venda charges)
  const { data: clientInfo } = useQuery({
    queryKey: ['shipment-client', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, type')
        .eq('id', clientId as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch shipment partners (related companies)
  const { data: shipmentPartners = [] } = useQuery({
    queryKey: ['shipment-partners', shipmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipment_partners' as any)
        .select('*, clients(id, name, type)')
        .eq('shipment_id', shipmentId)
        .order('created_at');
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch all clients for adding partners
  const { data: allClients = [] } = useQuery({
    queryKey: ['all-clients-for-partners', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, type')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch charge catalog for autocomplete
  const { data: chargeCatalog = [] } = useQuery({
    queryKey: ['charge-catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('charge_catalog' as any)
        .select('*')
        .order('name');
      if (error) throw error;
      return data as any[];
    },
  });

  // Filtered catalog suggestions
  const catalogSuggestions = useMemo(() => {
    if (!descSearch || descSearch.length < 1) return [];
    return chargeCatalog.filter((c: any) =>
      c.name.toLowerCase().includes(descSearch.toLowerCase())
    ).slice(0, 8);
  }, [descSearch, chargeCatalog]);

  // Partners already added to this shipment
  const partnerIds = new Set(shipmentPartners.map((sp: any) => sp.clients?.id || sp.client_id));
  
  // Available clients to add (not yet added)
  const availableClients = useMemo(() => {
    if (partnerSearch.length < 2) return [];
    return allClients.filter((c: any) => 
      !partnerIds.has(c.id) && 
      c.name.toLowerCase().includes(partnerSearch.toLowerCase())
    ).slice(0, 10);
  }, [allClients, partnerIds, partnerSearch]);

  const addPartner = useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase.from('shipment_partners' as any).insert({
        shipment_id: shipmentId,
        client_id: clientId,
        company_id: companyId,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment-partners', shipmentId] });
      // A aba Logística tem sua própria query (cache separado) pra montar as
      // opções de Shipper/Armador/Notify/Consignee — sem invalidar aqui
      // também, uma empresa recém-adicionada não aparecia lá (nem disparava
      // o auto-preenchimento do Armador) até a página ser recarregada.
      queryClient.invalidateQueries({ queryKey: ['shipment-partners-logistics', shipmentId] });
      setPartnerSearch('');
      toast.success(t('financial.add_partner'));
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removePartner = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('shipment_partners' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment-partners', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['shipment-partners-logistics', shipmentId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const addLine = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('charge_lines').insert({
        shipment_id: shipmentId,
        company_id: companyId,
        direction: form.direction as any,
        partner_id: form.partner_id || null,
        charge_type: form.charge_type as any,
        description: form.description,
        amount: parseFloat(form.amount) || 0,
        currency: form.currency,
        exchange_rate: parseFloat(form.exchange_rate) || 1,
        tax_rate: parseFloat(form.tax_rate) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charge-lines', shipmentId] });
      touchShipmentActivity();
      setShowAdd(false);
      setForm(EMPTY_FORM);
      setDescSearch('');
      toast.success(t('financial.charge_added'));
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteLine = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('charge_lines').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charge-lines', shipmentId] });
      touchShipmentActivity();
      toast.success(t('common.delete'));
    },
  });

  const verifyCharge = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await supabase.from('charge_lines').update({
        verified: true,
        verified_by: user?.id || null,
        verified_at: new Date().toISOString(),
      } as any).eq('id', lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charge-lines', shipmentId] });
      touchShipmentActivity();
      toast.success(t('financial.charge_verified'));
    },
  });

  const updateSupplierAmount = useMutation({
    mutationFn: async ({ lineId, amount }: { lineId: string; amount: number }) => {
      const { error } = await supabase.from('charge_lines').update({
        supplier_amount: amount,
      } as any).eq('id', lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charge-lines', shipmentId] });
    },
  });

  const releaseToFinancial = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('shipments').update({
        charges_verified: true,
        financial_released: true,
      } as any).eq('id', shipmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment-flags', shipmentId] });
      touchShipmentActivity();
      toast.success(t('financial.released_success'));
    },
  });

  const updateInvoiceStatus = useMutation({
    mutationFn: async ({ lineId, status, invoiceNumber }: { lineId: string; status: string; invoiceNumber?: string }) => {
      const update: any = { invoice_status: status };
      if (invoiceNumber !== undefined) update.invoice_number = invoiceNumber;
      const { error } = await supabase.from('charge_lines').update(update).eq('id', lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charge-lines', shipmentId] });
      touchShipmentActivity();
      toast.success(t('financial.status_updated'));
    },
  });

  const payables = lines.filter((l: any) => l.direction === 'payable');
  const receivables = lines.filter((l: any) => l.direction === 'receivable');

  const allPayablesVerified = payables.length > 0 && payables.every((l: any) => l.verified);
  const allChargesPaid = lines.length > 0 && lines.every((l: any) => l.invoice_status === 'paid');
  const isReleased = shipment?.financial_released || false;

  const groupByPartner = (items: any[]) => {
    const groups: Record<string, { partner: string; currency: string; items: any[] }> = {};
    items.forEach((item) => {
      const partnerId = item.partner_id || 'no-partner';
      const partnerName = (item.clients as any)?.name || t('financial.no_partner');
      const key = `${partnerId}-${item.currency}`;
      if (!groups[key]) {
        groups[key] = { partner: partnerName, currency: item.currency, items: [] };
      }
      groups[key].items.push(item);
    });
    return Object.values(groups);
  };

  const totalsByCurrency = (items: any[]) => {
    const totals: Record<string, number> = {};
    items.forEach((item) => {
      totals[item.currency] = (totals[item.currency] || 0) + Number(item.amount || 0);
    });
    return totals;
  };

  const payableTotals = totalsByCurrency(payables);
  const receivableTotals = totalsByCurrency(receivables);
  const allCurrencies = [...new Set([...Object.keys(payableTotals), ...Object.keys(receivableTotals)])];

  const openAdd = (direction: Direction) => {
    // Na Venda, já sugere o cliente do embarque como parceiro padrão da taxa.
    const defaultPartnerId = direction === 'receivable' && clientId ? clientId : '';
    setForm({ ...EMPTY_FORM, direction, partner_id: defaultPartnerId });
    setDescSearch('');
    setShowAdd(true);
  };

  const invoiceStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';
      case 'invoiced': return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const renderChargeRow = (item: any, showVerification: boolean) => {
    const supplierAmt = (item as any).supplier_amount;
    const isVerified = (item as any).verified;
    const hasDivergence = supplierAmt != null && Number(supplierAmt) !== Number(item.amount);

    return (
      <TableRow key={item.id}>
        <TableCell className="capitalize text-xs py-2">{item.charge_type}</TableCell>
        <TableCell className="text-xs py-2">{item.description}</TableCell>
        <TableCell className="text-right font-mono text-xs py-2">
          {Number(item.amount).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </TableCell>
        {showVerification && (
          <>
            <TableCell className="py-2 w-28">
              {isVerified ? (
                <span className="font-mono text-xs">
                  {supplierAmt != null ? Number(supplierAmt).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                </span>
              ) : (
                <Input
                  type="number"
                  className="h-7 text-xs w-24 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="0.00"
                  defaultValue={supplierAmt ?? ''}
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      updateSupplierAmount.mutate({ lineId: item.id, amount: val });
                    }
                  }}
                />
              )}
            </TableCell>
            <TableCell className="py-2 w-10">
              {isVerified ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : hasDivergence ? (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              ) : null}
            </TableCell>
            <TableCell className="py-2 w-20">
              {!isVerified && canVerifyCharges && supplierAmt != null && (
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => verifyCharge.mutate(item.id)}>
                  {t('financial.verify')}
                </Button>
              )}
            </TableCell>
          </>
        )}
        <TableCell className="py-2 w-20">
          {(canProcessPayments || isFullAccess) && isReleased ? (
            <Select
              value={item.invoice_status}
              onValueChange={(v) => updateInvoiceStatus.mutate({ lineId: item.id, status: v })}
            >
              <SelectTrigger className="h-6 text-[10px] w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">{t('financial.status_pending')}</SelectItem>
                <SelectItem value="invoiced">{t('financial.status_invoiced')}</SelectItem>
                <SelectItem value="paid">{t('financial.status_paid')}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline" className={`text-[10px] ${invoiceStatusColor(item.invoice_status)}`}>
              {t(`financial.status_${item.invoice_status}`)}
            </Badge>
          )}
        </TableCell>
      </TableRow>
    );
  };

  const showVerificationCols = canVerifyCharges || isFullAccess;

  // Partners for the charge form: parceiros do processo + o cliente do embarque
  // (o cliente sempre pode ser escolhido, mesmo que ainda não tenha sido
  // adicionado explicitamente em "Parceiros do Processo").
  const chargePartners = (() => {
    const fromShipmentPartners = shipmentPartners.map((sp: any) => ({
      id: sp.clients?.id || sp.client_id,
      name: sp.clients?.name || 'Unknown',
      type: sp.clients?.type || 'client',
    }));
    if (clientInfo && !fromShipmentPartners.some((p: any) => p.id === clientInfo.id)) {
      return [{ id: clientInfo.id, name: clientInfo.name, type: clientInfo.type || 'client' }, ...fromShipmentPartners];
    }
    return fromShipmentPartners;
  })();

  const clientTypeLabel = (type: string) => {
    switch (type) {
      case 'client': return 'Cliente';
      case 'supplier': return 'Fornecedor';
      case 'carrier': return 'Armador';
      case 'agent': return 'Agente';
      default: return type;
    }
  };

  return (
    <fieldset disabled={locked} className="contents">
    <div className="space-y-4">
      {locked && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Processo finalizado — somente leitura. Para editar, reabra o processo em Admin &gt; Reabrir Processos.
        </div>
      )}
      {/* Tabs: Charges | Parceiros */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="charges" className="gap-2">
            <Receipt className="w-4 h-4" />
            Compra / Venda
          </TabsTrigger>
          <TabsTrigger value="partners" className="gap-2">
            <Users className="w-4 h-4" />
            {t('financial.partners_tab')}
            {shipmentPartners.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                {shipmentPartners.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* PARTNERS TAB */}
        <TabsContent value="partners">
          <Card className="glass">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('financial.partners_tab')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search and add partner */}
              <div className="relative">
                <Input
                  placeholder={t('financial.search_partner')}
                  value={partnerSearch}
                  onChange={(e) => setPartnerSearch(e.target.value)}
                  className="w-full"
                />
                {availableClients.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {availableClients.map((c: any) => (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center justify-between"
                        onClick={() => {
                          addPartner.mutate(c.id);
                        }}
                      >
                        <span>{c.name}</span>
                        <Badge variant="outline" className="text-[10px]">{clientTypeLabel(c.type)}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Current partners list */}
              {shipmentPartners.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {t('financial.no_partners_msg')}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shipmentPartners.map((sp: any) => (
                      <TableRow key={sp.id}>
                        <TableCell className="font-medium text-sm">{sp.clients?.name || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{clientTypeLabel(sp.clients?.type || '')}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removePartner.mutate(sp.id)}>
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CHARGES TAB */}
        <TabsContent value="charges">
          <div className="space-y-4">
            {/* Verification status banner */}
            {!isReleased && lines.length > 0 && (
              <Alert className="border-amber-500/30 bg-amber-500/5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <AlertDescription className="text-sm">
                  {t('financial.pending_verification_msg')}
                </AlertDescription>
              </Alert>
            )}
            {isReleased && !allChargesPaid && (
              <Alert className="border-primary/30 bg-primary/5">
                <Lock className="w-4 h-4 text-primary" />
                <AlertDescription className="text-sm">
                  {t('financial.pending_payment_msg')}
                </AlertDescription>
              </Alert>
            )}
            {isReleased && allChargesPaid && lines.length > 0 && (
              <Alert className="border-emerald-500/30 bg-emerald-500/5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <AlertDescription className="text-sm">
                  {t('financial.all_paid_msg')}
                </AlertDescription>
              </Alert>
            )}

            {/* KPI Summary - only visible to process owner or admin */}
            {canSeeFinancials && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="glass">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground uppercase">{t('financial.payables')}</p>
                  <div className="mt-1">
                    {Object.entries(payableTotals).map(([cur, val]) => (
                      <p key={cur} className="text-lg font-bold text-destructive">{formatMoney(val, cur)}</p>
                    ))}
                    {Object.keys(payableTotals).length === 0 && <p className="text-lg font-bold text-muted-foreground">-</p>}
                  </div>
                </CardContent>
              </Card>
              <Card className="glass">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground uppercase">{t('financial.receivables')}</p>
                  <div className="mt-1">
                    {Object.entries(receivableTotals).map(([cur, val]) => (
                      <p key={cur} className="text-lg font-bold text-emerald-500">{formatMoney(val, cur)}</p>
                    ))}
                    {Object.keys(receivableTotals).length === 0 && <p className="text-lg font-bold text-muted-foreground">-</p>}
                  </div>
                </CardContent>
              </Card>
              <Card className="glass col-span-2">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground uppercase">{t('financial.profit_by_currency')}</p>
                  <div className="mt-1 flex gap-6">
                    {allCurrencies.map((cur) => {
                      const profit = (receivableTotals[cur] || 0) - (payableTotals[cur] || 0);
                      return (
                        <div key={cur}>
                          <p className={`text-lg font-bold ${profit >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                            {formatMoney(profit, cur)}
                          </p>
                        </div>
                      );
                    })}
                    {allCurrencies.length === 0 && <p className="text-lg font-bold text-muted-foreground">-</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
            )}
            
            {!canSeeFinancials && (
              <Card className="glass">
                <CardContent className="py-8 text-center text-muted-foreground">
                  <p className="text-sm">Informações financeiras restritas ao vendedor do processo.</p>
                </CardContent>
              </Card>
            )}

            {/* Benchmarks removed from shipments - now only in quotes */}

            {/* Release to Financial button */}
            {(canVerifyCharges || isFullAccess) && !isReleased && payables.length > 0 && (
              <div className="flex justify-end">
                <Button
                  onClick={() => releaseToFinancial.mutate()}
                  disabled={!allPayablesVerified}
                  className="gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {t('financial.release_to_financial')}
                </Button>
              </div>
            )}

            {/* Split View: Compras | Vendas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* COMPRAS (left) */}
              <Card className="glass">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingDown className="w-4 h-4 text-destructive" />
                    {t('financial.payables')}
                  </CardTitle>
                   <Button size="sm" variant="outline" onClick={() => openAdd('payable')} disabled={!canEditChargesHere}>
                     <Plus className="w-4 h-4" />
                     {t('financial.add_cost')}
                   </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {groupByPartner(payables).length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground text-sm">{t('common.no_data')}</p>
                  ) : (
                    groupByPartner(payables).map((group, gi) => (
                      <div key={gi} className="border-b border-border last:border-b-0">
                        <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
                          <span className="text-sm font-medium">{group.partner}</span>
                          <Badge variant="outline" className="font-mono text-xs">{group.currency}</Badge>
                        </div>
                        <Table>
                          <TableBody>
                            {group.items.map((item: any) => renderChargeRow(item, showVerificationCols))}
                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={2} className="text-xs font-semibold py-2">{t('financial.subtotal')}</TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold py-2">
                                {group.items.reduce((s: number, i: any) => s + Number(i.amount), 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              {showVerificationCols && <><TableCell /><TableCell /><TableCell /></>}
                              <TableCell />
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* VENDAS (right) */}
              <Card className="glass">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                    {t('financial.receivables')}
                  </CardTitle>
                   <Button size="sm" variant="outline" onClick={() => openAdd('receivable')} disabled={!canEditChargesHere}>
                     <Plus className="w-4 h-4" />
                     {t('financial.add_revenue')}
                   </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {groupByPartner(receivables).length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground text-sm">{t('common.no_data')}</p>
                  ) : (
                    groupByPartner(receivables).map((group, gi) => (
                      <div key={gi} className="border-b border-border last:border-b-0">
                        <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
                          <span className="text-sm font-medium">{group.partner}</span>
                          <Badge variant="outline" className="font-mono text-xs">{group.currency}</Badge>
                        </div>
                        <Table>
                          <TableBody>
                            {group.items.map((item: any) => renderChargeRow(item, false))}
                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={2} className="text-xs font-semibold py-2">{t('financial.subtotal')}</TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold py-2">
                                {group.items.reduce((s: number, i: any) => s + Number(i.amount), 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell />
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Summary by currency */}
            {allCurrencies.length > 0 && (
              <Card className="glass">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Receipt className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">{t('financial.summary_by_currency')}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('financial.currency')}</TableHead>
                        <TableHead className="text-right">{t('financial.payables')}</TableHead>
                        <TableHead className="text-right">{t('financial.receivables')}</TableHead>
                        <TableHead className="text-right">{t('financial.profit')}</TableHead>
                        <TableHead className="text-right">{t('financial.margin')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allCurrencies.map((cur) => {
                        const pay = payableTotals[cur] || 0;
                        const rec = receivableTotals[cur] || 0;
                        const profit = rec - pay;
                        const margin = rec > 0 ? (profit / rec) * 100 : 0;
                        return (
                          <TableRow key={cur}>
                            <TableCell className="font-mono font-medium">{cur}</TableCell>
                            <TableCell className="text-right font-mono text-destructive">{pay.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-right font-mono text-emerald-500">{rec.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                            <TableCell className={`text-right font-mono font-semibold ${profit >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                              {profit.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Add charge line dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form.direction === 'payable' ? t('financial.add_cost') : t('financial.add_revenue')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Partner - only from shipment partners */}
            <div className="space-y-2">
              <Label>{t('financial.partner')}</Label>
              {chargePartners.length === 0 ? (
                <p className="text-xs text-muted-foreground border rounded-md p-3">
                  Nenhum parceiro adicionado. Vá na aba <button className="text-primary underline" onClick={() => { setShowAdd(false); setActiveTab('partners'); }}>Parceiros do Processo</button> para adicionar.
                </p>
              ) : (
                <Select value={form.partner_id} onValueChange={(v) => setForm({ ...form, partner_id: v })}>
                  <SelectTrigger><SelectValue placeholder={t('financial.select_partner')} /></SelectTrigger>
                  <SelectContent>
                    {chargePartners.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Charge type as buttons */}
            <div className="space-y-2">
              <Label>{t('financial.charge_type')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {CHARGE_TYPES.map((ct) => (
                  <Button
                    key={ct}
                    type="button"
                    size="sm"
                    variant={form.charge_type === ct ? 'default' : 'outline'}
                    className="h-7 text-xs px-3"
                    onClick={() => setForm({ ...form, charge_type: ct })}
                  >
                    {CHARGE_TYPE_LABELS[ct] || ct}
                  </Button>
                ))}
              </div>
            </div>

            {/* Description with autocomplete */}
            <div className="space-y-2">
              <Label>{t('financial.description')}</Label>
              <div className="relative">
                <Input
                  value={form.description}
                  onChange={(e) => {
                    setForm({ ...form, description: e.target.value });
                    setDescSearch(e.target.value);
                    setShowDescSuggestions(true);
                  }}
                  onFocus={() => setShowDescSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowDescSuggestions(false), 200)}
                  placeholder="THC, BL Fee, Ocean Freight..."
                />
                {showDescSuggestions && catalogSuggestions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-36 overflow-y-auto">
                    {catalogSuggestions.map((s: any) => (
                      <button
                        key={s.id}
                        className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center justify-between"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setForm({ ...form, description: s.name, charge_type: s.charge_type || form.charge_type });
                          setDescSearch('');
                          setShowDescSuggestions(false);
                        }}
                      >
                        <span>{s.name}</span>
                        <Badge variant="outline" className="text-[10px]">{s.charge_type}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Amount + Currency */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('financial.amount')}</Label>
                <Input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('financial.currency')}</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Exchange rate + Tax */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  {t('financial.exchange_rate')}
                  <button
                    type="button"
                    className="text-[10px] text-primary hover:underline flex items-center gap-1"
                    onClick={() => {
                      const rate = form.currency === 'EUR' ? eurBrl : usdBrl;
                      if (rate) setForm({ ...form, exchange_rate: rate.toFixed(4) });
                    }}
                  >
                    <RefreshCw className="w-3 h-3" /> {t('financial.update_rate')}
                  </button>
                </Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.exchange_rate}
                  onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                {form.currency !== 'BRL' && usdBrl && (
                  <p className="text-[10px] text-muted-foreground">
                    {t('financial.current_rate')}: R$ {(form.currency === 'EUR' ? eurBrl : usdBrl)?.toFixed(4)}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t('financial.tax')} %</Label>
                <Input
                  type="number"
                  value={form.tax_rate}
                  onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAdd(false)}>{t('common.cancel')}</Button>
              <Button onClick={() => addLine.mutate()} disabled={!form.description}>{t('common.create')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </fieldset>
  );
}

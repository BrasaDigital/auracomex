import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { ArrowLeft, MapPin, DollarSign, FileText, History, AlertTriangle, Package, Info, Users, ShoppingCart, Undo2, Copy, NotebookPen, Truck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ModeIcon } from '@/components/shared/ModeIcon';
import { FinancialTab } from './FinancialTab';
import { LogisticsTab } from './LogisticsTab';
import { ShipmentPartnersCard } from './ShipmentPartnersCard';
import { DocumentsTab } from './DocumentsTab';
import { ShipmentEventsTab } from './ShipmentEventsTab';
import { OrdemColetaTab } from '@/components/coleta/OrdemColetaTab';
import { HistoryPanel } from '@/components/quotes/HistoryPanel';
import { QuoteDetail } from '@/components/quotes/QuoteDetail';
import { DuplicateShipmentDialog } from './DuplicateShipmentDialog';
import { countryCodeToName } from '@/lib/countries';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { calcItemCbm, calcChargeableWeight, getEffectiveVolume } from '@/components/quotes/ModeFields';
import type { CargoItem } from '@/components/quotes/ModeFields';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { groupByCurrency } from '@/lib/utils';
import { getTradeDirection, TRADE_DIRECTION_LABEL } from '@/lib/tradeDirection';

interface Props {
  id: string;
  onBack: () => void;
}

const MODE_LABELS: Record<string, string> = {
  ocean_fcl: 'Marítimo FCL',
  ocean_lcl: 'Marítimo LCL',
  air: 'Aéreo',
  road: 'Rodoviário',
  multimodal: 'Multimodal',
};

const LEG_LABELS: Record<string, Record<string, string>> = {
  origin: { pt: 'Origem', en: 'Origin' },
  freight: { pt: 'Frete', en: 'Freight' },
  destination: { pt: 'Destino', en: 'Destination' },
};

export function ShipmentDetail({ id, onBack }: Props) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();

  // Mark shipment as accessed
  useEffect(() => {
    supabase
      .from('shipments')
      .update({ last_accessed_at: new Date().toISOString() } as any)
      .eq('id', id)
      .then();
  }, [id]);

  // Find the linked quote
  const { data: linkedQuote, isLoading: linkedQuoteLoading } = useQuery({
    queryKey: ['shipment-linked-quote', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select('id')
        .eq('shipment_id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // If there's a linked quote, delegate entirely to QuoteDetail in shipment mode
  if (linkedQuoteLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">{t('common.loading')}</div>;
  }

  if (linkedQuote) {
    return <QuoteDetail quoteId={linkedQuote.id} shipmentId={id} onBack={onBack} />;
  }

  // Standalone shipment (no linked quote) - show read-only view
  return <StandaloneShipmentDetail id={id} onBack={onBack} />;
}

/** Read-only detail for shipments created without a quote (e.g. quick create) */
function StandaloneShipmentDetail({ id, onBack }: Props) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const { usdBrl, eurBrl } = useExchangeRate();
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: shipment } = useQuery({
    queryKey: ['shipment', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('*, clients(name)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Shipment partners
  const { data: shipmentPartners = [] } = useQuery({
    queryKey: ['shipment-partners', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipment_partners')
        .select('*, clients(name, type, email, phone)')
        .eq('shipment_id', id);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  if (!shipment) return <div className="text-center py-12 text-muted-foreground">{t('common.loading')}</div>;

  const mode = shipment.transport_mode;
  const isFinalized = !!(shipment as any).is_finalized;

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono">{shipment.reference_number}</h1>
            <StatusBadge status={shipment.status} />
            <ModeIcon mode={shipment.transport_mode} showLabel />
            {(() => {
              const dir = getTradeDirection(shipment.origin_port || shipment.origin_country, shipment.destination_port || shipment.destination_country);
              return (
                <span className={`inline-flex items-center rounded-full text-xs px-2 py-0.5 font-medium ${dir === 'EXP' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-sky-500/10 text-sky-700 dark:text-sky-400'}`}>
                  {TRADE_DIRECTION_LABEL[dir]}
                </span>
              );
            })()}
            {isFinalized && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs px-2 py-0.5 font-medium">
                Finalizado — somente leitura
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {(shipment as any).clients?.name && <span className="font-medium">{(shipment as any).clients.name} · </span>}
            {shipment.origin_city}, {countryCodeToName(shipment.origin_country)} → {shipment.destination_city}, {countryCodeToName(shipment.destination_country)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          title="Histórico de alterações"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDuplicateOpen(true)}>
          <Copy className="w-4 h-4 mr-2" />
          {t('shipments.duplicate')}
        </Button>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('shipments.etd'), value: shipment.etd ? format(new Date(shipment.etd), 'dd/MM/yyyy') : '-' },
          { label: t('shipments.eta'), value: shipment.eta ? format(new Date(shipment.eta), 'dd/MM/yyyy') : '-' },
          { label: t('shipments.carrier'), value: shipment.carrier || '-' },
          { label: t('shipments.incoterm'), value: shipment.incoterm || '-' },
        ].map((item) => (
          <Card key={item.label} className="glass">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase">{item.label}</p>
              <p className="text-lg font-semibold mt-1">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="logistics" className="space-y-4">
        <TabsList className="bg-secondary/50 flex-wrap">
          <TabsTrigger value="general" className="gap-1.5">
            <Info className="w-4 h-4" /> {t('quotes.general')}
          </TabsTrigger>
          <TabsTrigger value="partners" className="gap-1.5">
            <Users className="w-4 h-4" /> {t('quotes.partners_tab')}
          </TabsTrigger>
          <TabsTrigger value="logistics" className="gap-1.5">
            <MapPin className="w-4 h-4" /> {t('shipments.logistics')}
          </TabsTrigger>
          <TabsTrigger value="events" className="gap-1.5">
            <NotebookPen className="w-4 h-4" /> Diário
          </TabsTrigger>
          <TabsTrigger value="financial" className="gap-1.5">
            <DollarSign className="w-4 h-4" /> {t('charges.tab')}
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5">
            <FileText className="w-4 h-4" /> {t('shipments.documents')}
          </TabsTrigger>
          <TabsTrigger value="coleta" className="gap-1.5">
            <Truck className="w-4 h-4" /> Coleta
          </TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-sm">{t('quotes.general')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoField label={t('shipments.client')} value={(shipment as any).clients?.name || '-'} />
                <InfoField label={t('shipments.mode')} value={MODE_LABELS[mode] || mode} />
                <InfoField label={t('shipments.status')} value={<StatusBadge status={shipment.status} />} />
                <InfoField label={t('shipments.origin')} value={`${shipment.origin_port || ''} ${shipment.origin_city ? `(${shipment.origin_city})` : ''}`} />
                <InfoField label={t('shipments.destination')} value={`${shipment.destination_port || ''} ${shipment.destination_city ? `(${shipment.destination_city})` : ''}`} />
                <InfoField label={t('shipments.incoterm')} value={shipment.incoterm || '-'} />
              </div>
              {shipment.notes && (
                <div className="pt-4 border-t">
                  <p className="text-xs text-muted-foreground mb-1">{t('quotes.notes')}</p>
                  <p className="text-sm whitespace-pre-wrap">{shipment.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Partners Tab */}
        <TabsContent value="partners" className="space-y-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-sm">{t('quotes.partners_tab')}</CardTitle>
            </CardHeader>
            <CardContent>
              {shipmentPartners.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{t('common.no_data')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common.name')}</TableHead>
                      <TableHead>{t('clients.type')}</TableHead>
                      <TableHead>{t('clients.email')}</TableHead>
                      <TableHead>{t('clients.phone')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shipmentPartners.map((sp: any) => (
                      <TableRow key={sp.id}>
                        <TableCell className="font-medium">{sp.clients?.name || '-'}</TableCell>
                        <TableCell className="text-sm capitalize">{sp.clients?.type || '-'}</TableCell>
                        <TableCell className="text-sm">{sp.clients?.email || '-'}</TableCell>
                        <TableCell className="text-sm">{sp.clients?.phone || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Shipper/Armador/Notify/Consignee do embarque avulso (sem
              cotação vinculada) — mesmo componente usado no fluxo normal. */}
          <ShipmentPartnersCard
            shipment={shipment}
            onUpdate={() => queryClient.invalidateQueries({ queryKey: ['shipment', id] })}
          />
        </TabsContent>

        <TabsContent value="logistics">
          <LogisticsTab shipment={shipment} onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ['shipment', id] });
            // Também invalida a lista de embarques, pra "Última Atividade" refletir
            // a mudança na hora, mesmo sem passar pelo botão "Voltar".
            queryClient.invalidateQueries({ queryKey: ['shipments'] });
          }} />
        </TabsContent>
        <TabsContent value="events">
          <ShipmentEventsTab shipmentId={id} companyId={shipment.company_id} isFinalized={isFinalized} />
        </TabsContent>

        <TabsContent value="financial">
          <FinancialTab
            shipmentId={id}
            companyId={shipment.company_id}
            clientId={shipment.client_id}
            transportMode={shipment.transport_mode}
            originPort={shipment.origin_port}
            destinationPort={shipment.destination_port}
            createdBy={shipment.created_by}
            isFinalized={isFinalized}
          />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab shipmentId={id} companyId={shipment.company_id} isFinalized={isFinalized} />
        </TabsContent>
        <TabsContent value="coleta">
          <OrdemColetaTab
            shipmentId={id}
            companyId={shipment.company_id}
            clientId={shipment.client_id ?? null}
            shipment={{
              reference_number: shipment.reference_number,
              container_number: (shipment as any).container_number ?? null,
              master_bl: (shipment as any).master_bl ?? null,
              house_bl: (shipment as any).house_bl ?? null,
              duimp_number: (shipment as any).duimp_number ?? null,
            }}
          />
        </TabsContent>
      </Tabs>

      <HistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        shipmentId={id}
      />

      <DuplicateShipmentDialog
        shipment={duplicateOpen ? shipment : null}
        onClose={() => setDuplicateOpen(false)}
        onDuplicated={() => {
          setDuplicateOpen(false);
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
        }}
      />
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value || '-'}</div>
    </div>
  );
}

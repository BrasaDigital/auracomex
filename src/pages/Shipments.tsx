import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSalespersonClients } from '@/hooks/useSalespersonClients';
import { Search, Filter, FileText, CalendarIcon, Truck, Copy } from 'lucide-react';
import { getCourierTrackingUrl } from '@/lib/courierTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DuplicateShipmentDialog } from '@/components/shipments/DuplicateShipmentDialog';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ModeIcon } from '@/components/shared/ModeIcon';
import { ShipmentDetail } from '@/components/shipments/ShipmentDetail';
import { Badge } from '@/components/ui/badge';
import { format, isToday, addDays } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTableSort } from '@/hooks/useTableSort';
import { SortableHeader } from '@/components/shared/SortableHeader';
import { ColumnSearch } from '@/components/shared/ColumnSearch';
import { ColumnFilter } from '@/components/shared/ColumnFilter';
import { countryCodeToName } from '@/lib/countries';
import { FlagIcon } from '@/components/shared/FlagIcon';


const MODES = ['ocean_fcl', 'ocean_lcl', 'air', 'road', 'multimodal'];

export default function Shipments() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { isSalesperson, clientIds } = useSalespersonClients();
  // Busca por coluna (REF, Cliente, Origem, Destino): uma lupa no cabeçalho de
  // cada uma abre um popover com o campo de busca daquela coluna só.
  const [searchRef, setSearchRef] = useState('');
  const [searchClient, setSearchClient] = useState('');
  const [searchOrigin, setSearchOrigin] = useState('');
  const [searchDestination, setSearchDestination] = useState('');
  const [searchRefOpen, setSearchRefOpen] = useState(false);
  const [searchClientOpen, setSearchClientOpen] = useState(false);
  const [searchOriginOpen, setSearchOriginOpen] = useState(false);
  const [searchDestinationOpen, setSearchDestinationOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [modeFilter, setModeFilter] = useState<string[]>([]);
  // Filtros de Status e Modal viraram popovers no próprio cabeçalho da coluna.
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [modeFilterOpen, setModeFilterOpen] = useState(false);
  const [duplicateShipment, setDuplicateShipment] = useState<any>(null);
  const filtersLoadedRef = useRef(false);
  // null = ainda não sabemos: já existe preferência salva desse usuário para essa lista?
  const [hasSavedPrefs, setHasSavedPrefs] = useState<boolean | null>(null);

  // Filtros persistidos por usuário (localStorage), pra não zerar toda vez
  // que ele sai da tela de Embarques e volta.
  // Versão "v2" da chave: reseta de uma vez só as preferências salvas antes
  // da mudança de comportamento (agora tudo vem marcado por padrão), pra
  // quem já tinha filtro salvo também passar a ver o novo padrão. Dali em
  // diante volta a lembrar normalmente a última escolha de cada um.
  const filtersStorageKey = profile?.user_id ? `aura:filters:v2:${profile.user_id}:shipments` : null;

  useEffect(() => {
    if (!filtersStorageKey || filtersLoadedRef.current) return;
    filtersLoadedRef.current = true;
    try {
      const raw = localStorage.getItem(filtersStorageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.statusFilter)) setStatusFilter(saved.statusFilter);
        if (Array.isArray(saved.modeFilter)) setModeFilter(saved.modeFilter);
        setHasSavedPrefs(true);
      } else {
        // Sem preferência salva ainda: os filtros vêm todos marcados por
        // padrão (mostrando tudo, igual antes) e o usuário desmarca o que
        // não fizer sentido. O modal já sabemos de antemão; o status
        // depende dos status customizados da empresa (preenchido no efeito
        // abaixo assim que carregarem).
        setHasSavedPrefs(false);
        setModeFilter(MODES);
      }
    } catch {
      setHasSavedPrefs(false);
    }
  }, [filtersStorageKey]);

  // Clicar em "Embarques" no menu enquanto já se está em /shipments não muda
  // de rota (mesmo path), então sem isso o processo aberto ficava preso na
  // tela. O React Router cria uma location.key nova a cada clique no link,
  // mesmo pro mesmo path — usamos isso pra voltar sempre pra lista.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    // Links externos (ex: financeiro) abrem um embarque específico via
    // ?open=<id>, já que /shipments/:id não é uma rota de verdade — o
    // processo é sempre exibido por estado local dentro desta página.
    const openId = new URLSearchParams(location.search).get('open');
    setSelectedId(openId || null);
    // A query da lista continua "montada" o tempo todo (só fica escondida
    // enquanto um processo está aberto), então só resetar o selectedId não
    // busca dados novos — precisa forçar o refetch aqui.
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // Fetch custom status options for label mapping
  const { data: statusOptions = [] } = useQuery({
    queryKey: ['shipment-status-options', profile?.company_id],
    queryFn: async () => {
      const { data, error } = await (supabase.from('shipment_status_options') as any)
        .select('*')
        .eq('company_id', profile?.company_id)
        .order('position');
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.company_id,
  });

  const statusLabelMap = new Map<string, string>(
    statusOptions.map((o: any) => [o.value, o.label])
  );

  // Preenche o Status com "tudo selecionado" assim que os status customizados
  // da empresa chegarem — só quando não havia preferência salva pra esse
  // usuário (senão sobrescreveria a última escolha dele).
  useEffect(() => {
    if (hasSavedPrefs === false && statusOptions.length > 0 && statusFilter.length === 0) {
      setStatusFilter(statusOptions.map((o: any) => o.value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSavedPrefs, statusOptions]);

  useEffect(() => {
    if (!filtersStorageKey || !filtersLoadedRef.current || hasSavedPrefs === null) return;
    // Se ainda não havia preferência salva, espera os status customizados
    // carregarem antes de persistir — senão gravaria um Status vazio antes
    // da hora.
    if (hasSavedPrefs === false && statusOptions.length === 0) return;
    localStorage.setItem(filtersStorageKey, JSON.stringify({ statusFilter, modeFilter }));
  }, [filtersStorageKey, statusFilter, modeFilter, hasSavedPrefs, statusOptions]);

  const { data: shipments = [], refetch } = useQuery({
    queryKey: ['shipments', isSalesperson, clientIds],
    queryFn: async () => {
      let query = supabase
        .from('shipments')
        .select('id, reference_number, status, transport_mode, origin_city, origin_country, origin_port, destination_city, destination_country, destination_port, incoterm, notes, weight_kg, volume_cbm, packages, cargo_description, etd, eta, atd, ata, client_id, updated_at, last_accessed_at, next_update, courier_provider, courier_tracking_number, clients(name)')
        .order('created_at', { ascending: false });

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

  // Origem/Destino às vezes só têm o porto preenchido (sem cidade nem país
  // digitados manualmente — comum quando o processo veio de uma cotação
  // onde só o porto foi escolhido). Sem isso, a coluna ficava em branco
  // mesmo com o porto certinho selecionado no processo.
  const portCodes = [...new Set(
    shipments.flatMap((s: any) => [s.origin_port, s.destination_port]).filter(Boolean)
  )];
  const { data: portsInfo = [] } = useQuery({
    queryKey: ['shipments-list-ports', portCodes.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ports')
        .select('code, name, city, country_code')
        .in('code', portCodes);
      if (error) throw error;
      return data;
    },
    enabled: portCodes.length > 0,
  });
  const portMap = new Map<string, { code: string; name: string; city: string | null; country_code: string }>(
    portsInfo.map((p: any) => [p.code, p])
  );
  function locationLabel(city: string | null, country: string | null, portCode: string | null) {
    if (city) return city;
    const port = portCode ? portMap.get(portCode) : undefined;
    if (port?.city) return port.city;
    if (port?.name) return port.name;
    const countryName = countryCodeToName(country);
    if (countryName) return countryName;
    return portCode || '-';
  }

  const filtered = shipments.filter((s: any) => {
    const matchesRef = !searchRef || s.reference_number?.toLowerCase().includes(searchRef.toLowerCase());
    const matchesClient = !searchClient || (s.clients as any)?.name?.toLowerCase().includes(searchClient.toLowerCase());
    const matchesOrigin = !searchOrigin || locationLabel(s.origin_city, s.origin_country, s.origin_port).toLowerCase().includes(searchOrigin.toLowerCase());
    const matchesDestination = !searchDestination || locationLabel(s.destination_city, s.destination_country, s.destination_port).toLowerCase().includes(searchDestination.toLowerCase());
    const matchesStatus = statusFilter.length === 0 || statusFilter.includes(s.status);
    const matchesMode = modeFilter.length === 0 || modeFilter.includes(s.transport_mode);
    return matchesRef && matchesClient && matchesOrigin && matchesDestination && matchesStatus && matchesMode;
  });

  // "Ativo" só quando o usuário desmarcou algo (não no estado inicial, onde
  // tudo já vem marcado e equivale a "sem filtro").
  const statusFilterActive = statusFilter.length > 0 && statusFilter.length < statusOptions.length;
  const modeFilterActive = modeFilter.length > 0 && modeFilter.length < MODES.length;

  function toggleStatusFilter(value: string) {
    setStatusFilter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  }
  function toggleModeFilter(value: string) {
    setModeFilter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  }
  function clearStatusFilter() {
    setStatusFilter([]);
  }
  function clearModeFilter() {
    setModeFilter([]);
  }

  const { sorted, sortState, toggleSort } = useTableSort<any>(filtered, {
    reference_number: (r) => r.reference_number,
    client: (r) => r.clients?.name,
    origin: (r) => locationLabel(r.origin_city, r.origin_country, r.origin_port),
    destination: (r) => locationLabel(r.destination_city, r.destination_country, r.destination_port),
    transport_mode: (r) => r.transport_mode,
    etd: (r) => r.atd || r.etd,
    eta: (r) => r.ata || r.eta,
    status: (r) => statusLabelMap.get(r.status) || r.status,
    next_update: (r) => r.next_update,
    updated_at: (r) => r.updated_at,
  }, { storageKey: profile?.user_id ? `aura:sort:${profile.user_id}:shipments` : undefined });

  async function updateShipmentField(id: string, field: string, value: any) {
    try {
      // Setar updated_at explicitamente conta essa edição (ETD/ETA/Next Update)
      // como atividade no processo, refletindo no indicador da lista.
      const payload: Record<string, any> = { [field]: value, updated_at: new Date().toISOString() };
      // Qualquer alteração no processo (exceto no próprio Next Update, que já é
      // o que o usuário está definindo manualmente) empurra o Next Update pro
      // dia seguinte, como lembrete automático de acompanhamento.
      if (field !== 'next_update') {
        payload.next_update = addDays(new Date(), 1).toISOString();
      }
      const { error } = await (supabase.from('shipments') as any)
        .update(payload)
        .eq('id', id);
      if (error) throw error;
      toast.success(t('quotes.changes_saved'));
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (selectedId) {
    return <ShipmentDetail id={selectedId} onBack={() => { refetch(); setSelectedId(null); navigate('/shipments', { replace: true }); }} />;
  }

  return (
    <div className="space-y-6 animate-slide-in">
      <Card className="glass">
        <CardContent className="p-0">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <SortableHeader
                  label="REF" sortKey="reference_number" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs"
                  right={<ColumnSearch value={searchRef} onChange={setSearchRef} open={searchRefOpen} onOpenChange={setSearchRefOpen} />}
                />
                <SortableHeader
                  label="Modal" sortKey="transport_mode" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs"
                  right={
                    <ColumnFilter open={modeFilterOpen} onOpenChange={setModeFilterOpen} active={modeFilterActive} title="Modal" onClear={clearModeFilter}>
                      {MODES.map((m) => (
                        <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox checked={modeFilter.includes(m)} onCheckedChange={() => toggleModeFilter(m)} />
                          <span className="truncate">{t(`mode.${m}`)}</span>
                        </label>
                      ))}
                    </ColumnFilter>
                  }
                />
                <SortableHeader
                  label={t('shipments.client')} sortKey="client" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs"
                  right={<ColumnSearch value={searchClient} onChange={setSearchClient} open={searchClientOpen} onOpenChange={setSearchClientOpen} />}
                />
                <SortableHeader
                  label={t('shipments.origin')} sortKey="origin" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs"
                  right={<ColumnSearch value={searchOrigin} onChange={setSearchOrigin} open={searchOriginOpen} onOpenChange={setSearchOriginOpen} />}
                />
                <SortableHeader
                  label={t('shipments.destination')} sortKey="destination" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs"
                  right={<ColumnSearch value={searchDestination} onChange={setSearchDestination} open={searchDestinationOpen} onOpenChange={setSearchDestinationOpen} />}
                />
                <SortableHeader label={t('shipments.etd')} sortKey="etd" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs" />
                <SortableHeader label={t('shipments.eta')} sortKey="eta" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs" />
                <SortableHeader
                  label="Status" sortKey="status" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs"
                  right={
                    <ColumnFilter open={statusFilterOpen} onOpenChange={setStatusFilterOpen} active={statusFilterActive} title="Status" onClear={clearStatusFilter} contentClassName="w-[min(90vw,420px)]">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {statusOptions.map((o: any) => (
                          <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox checked={statusFilter.includes(o.value)} onCheckedChange={() => toggleStatusFilter(o.value)} />
                            <span className="truncate">{o.label}</span>
                          </label>
                        ))}
                      </div>
                    </ColumnFilter>
                  }
                />
                <SortableHeader label="Next Update" sortKey="next_update" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs" />
                <SortableHeader label="Atividade" sortKey="updated_at" state={sortState} onToggle={toggleSort} className="h-8 px-3 text-xs" />
                <TableHead className="h-8 px-3 text-xs text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    {t('common.no_data')}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((s: any) => {
                  const updatedToday = s.updated_at ? isToday(new Date(s.updated_at)) : false;
                  const accessedToday = s.last_accessed_at ? isToday(new Date(s.last_accessed_at)) : false;
                  const rowBg = updatedToday
                    ? 'bg-emerald-500/10'
                    : accessedToday
                      ? 'bg-yellow-500/10'
                      : 'bg-red-500/5';
                  const trackingUrl = getCourierTrackingUrl(s.courier_provider, s.courier_tracking_number);
                  return (
                  <TableRow key={s.id} className={`group whitespace-nowrap ${rowBg}`}>
                    <TableCell
                      className="py-0.5 px-3 font-mono font-medium cursor-pointer hover:underline"
                      onClick={() => setSelectedId(s.id)}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {s.reference_number}
                        {trackingUrl && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-muted-foreground hover:text-primary"
                              >
                                <Truck className="w-3.5 h-3.5" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>Rastrear {s.courier_provider}</TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="py-0.5 px-3 cursor-pointer" onClick={() => setSelectedId(s.id)}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span><ModeIcon mode={s.transport_mode} /></span>
                        </TooltipTrigger>
                        <TooltipContent>{t(`mode.${s.transport_mode}`)}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="py-0.5 px-3 cursor-pointer" onClick={() => setSelectedId(s.id)}>
                      {(s.clients as any)?.name || '-'}
                    </TableCell>
                    <TableCell className="py-0.5 px-3 cursor-pointer" onClick={() => setSelectedId(s.id)}>
                      <span className="inline-flex items-center gap-1.5">
                        <FlagIcon country={s.origin_country || portMap.get(s.origin_port)?.country_code} />
                        <span>{locationLabel(s.origin_city, s.origin_country, s.origin_port)}</span>
                      </span>
                    </TableCell>
                    <TableCell className="py-0.5 px-3 cursor-pointer" onClick={() => setSelectedId(s.id)}>
                      <span className="inline-flex items-center gap-1.5">
                        <FlagIcon country={s.destination_country || portMap.get(s.destination_port)?.country_code} />
                        <span>{locationLabel(s.destination_city, s.destination_country, s.destination_port)}</span>
                      </span>
                    </TableCell>
                    <TableCell className="py-0.5 px-1.5" onClick={(e) => e.stopPropagation()}>
                      <InlineDate
                        value={s.etd}
                        actualValue={s.atd}
                        onChange={(d) => updateShipmentField(s.id, 'etd', d)}
                      />
                    </TableCell>
                    <TableCell className="py-0.5 px-1.5" onClick={(e) => e.stopPropagation()}>
                      <InlineDate
                        value={s.eta}
                        actualValue={s.ata}
                        onChange={(d) => updateShipmentField(s.id, 'eta', d)}
                      />
                    </TableCell>
                    {/* Read-only Status from Logistics */}
                    <TableCell className="py-0.5 px-3 cursor-pointer" onClick={() => setSelectedId(s.id)}>
                      {statusLabelMap.has(s.status) ? (
                        <StatusBadge status={s.status} label={statusLabelMap.get(s.status)} />
                      ) : (
                        <StatusBadge status={s.status} />
                      )}
                    </TableCell>
                    {/* Inline-editable Next Update */}
                    <TableCell className="py-0.5 px-1.5" onClick={(e) => e.stopPropagation()}>
                      <InlineNextUpdate
                        value={s.next_update}
                        onChange={(d) => updateShipmentField(s.id, 'next_update', d)}
                      />
                    </TableCell>
                    {/* Activity indicator */}
                    <TableCell className="py-0.5 px-3">
                      <ActivityIndicator updatedAt={s.updated_at} lastAccessedAt={(s as any).last_accessed_at} />
                    </TableCell>
                    {/* Actions */}
                    <TableCell className="py-0.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => setDuplicateShipment(s)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('shipments.duplicate')}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DuplicateShipmentDialog
        shipment={duplicateShipment}
        onClose={() => setDuplicateShipment(null)}
        onDuplicated={() => {
          setDuplicateShipment(null);
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
        }}
      />
    </div>
  );
}

function ActivityIndicator({ updatedAt, lastAccessedAt }: { updatedAt: string; lastAccessedAt: string | null }) {
  const updatedToday = isToday(new Date(updatedAt));
  const accessedToday = lastAccessedAt ? isToday(new Date(lastAccessedAt)) : false;

  let color: string;
  let label: string;

  if (updatedToday) {
    color = 'bg-emerald-500';
    label = 'Atualizado hoje';
  } else if (accessedToday) {
    color = 'bg-yellow-500';
    label = 'Acessado hoje, sem atualização';
  } else {
    color = 'bg-red-500';
    label = 'Não acessado hoje';
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", color)} />
          <span className="text-xs text-muted-foreground">
            {format(new Date(updatedAt), 'dd/MM/yy')}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function InlineNextUpdate({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  // Estado local otimista: reflete a data escolhida na hora, sem esperar o
  // refetch da lista terminar (evita o botão continuar mostrando "Definir..."
  // por um instante ou em caso de a query pai não re-renderizar a tempo).
  const [localValue, setLocalValue] = useState(value);
  useEffect(() => { setLocalValue(value); }, [value]);
  const [open, setOpen] = useState(false);

  const dateValue = localValue ? new Date(localValue) : undefined;

  function handleSelect(d: Date | undefined) {
    const iso = d ? d.toISOString() : null;
    setLocalValue(iso);
    onChange(iso);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-5 text-xs px-2 font-normal justify-start w-[100px]",
            !dateValue && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-1 h-3 w-3 shrink-0" />
          {dateValue ? format(dateValue, 'dd/MM/yy') : 'Definir...'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleSelect}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

// Campo de data editável inline (usado em ETD/ETA), no mesmo padrão do "Next Update".
// Se `actualValue` (ATD/ATA) estiver preenchido, ele é exibido no lugar da estimativa,
// já que a data real substitui a previsão. A edição continua sendo do campo estimado.
function InlineDate({ value, actualValue, onChange }: { value: string | null; actualValue?: string | null; onChange: (v: string | null) => void }) {
  // Mesmo padrão otimista do InlineNextUpdate: atualiza a exibição na hora,
  // sem depender do refetch da lista terminar antes de mostrar a data escolhida.
  const [localValue, setLocalValue] = useState(value);
  useEffect(() => { setLocalValue(value); }, [value]);
  const [open, setOpen] = useState(false);

  const displaySource = actualValue || localValue;
  const dateValue = displaySource ? new Date(displaySource) : undefined;
  const isActual = !!actualValue;

  function handleSelect(d: Date | undefined) {
    const iso = d ? d.toISOString() : null;
    setLocalValue(iso);
    onChange(iso);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          title={isActual ? 'Data real' : 'Estimativa'}
          className={cn(
            "h-5 text-xs px-2 font-normal justify-start w-[86px]",
            !dateValue && "text-muted-foreground",
            isActual && "font-semibold text-emerald-600"
          )}
        >
          {dateValue ? format(dateValue, 'dd/MM/yy') : '-'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleSelect}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

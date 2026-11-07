import { useState, useEffect, useMemo } from 'react';
import { CollapsibleCard } from '@/components/shared/CollapsibleCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PortSelect } from '@/components/shared/PortSelect';
import { CalendarIcon, Settings, Plus, Trash2, GripVertical, ExternalLink, ArrowDownAZ, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays, differenceInCalendarDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { getCourierTrackingUrl } from '@/lib/courierTracking';
import { STATUS_CATEGORY_OPTIONS, DEFAULT_STATUS_OPTIONS, type StatusCategory } from '@/lib/shipmentStatusCategory';
import { parseContainerNumbers, parseContainerDates } from '@/lib/containerNumbers';
import { DateField as TypedDateField } from '@/components/shared/DateField';

interface Props {
  shipment: any;
  quoteId?: string;
  onUpdate?: () => void;
  /** Lista de clientes pra edição do campo Cliente (Card 1). Sem isso, o
   * campo fica só leitura (usado no fallback de embarque avulso sem
   * cotação, onde a tela que chama ainda não busca essa lista). */
  clientOptions?: { id: string; name: string }[];
  /** Quando fornecido (fluxo normal, vindo de QuoteDetail em modo embarque),
   * delega a troca de cliente pro pai — que checa taxas/DN/AR já lançados
   * no cliente antigo antes de trocar. Sem isso, salva direto aqui. */
  onClientChange?: (newClientId: string) => void;
  /** Valor "otimista" do cliente, reaproveitando o form do pai enquanto o
   * refetch do embarque não chega — quando ausente, usa shipment.client_id. */
  clientIdOverride?: string;
}

const INCOTERMS_BY_MODE: Record<string, string[]> = {
  ocean_fcl: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  ocean_lcl: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  air: ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  road: ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  multimodal: ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
};

// Campos de data: comparados por instante (getTime), não por string — o
// Supabase devolve timestamps num formato diferente de Date.toISOString()
// (ex: "+00:00" em vez de "Z"), então comparar como texto detecta uma
// "mudança" que não existe e trava o auto-save num loop infinito.
const DATE_FIELDS = new Set([
  'etd', 'eta', 'atd', 'ata',
  'customs_registration_date',
  'cargo_delivered_at', 'invoice_sent_at',
]);

const CUSTOMS_CHANNEL_OPTIONS: { value: string; label: string; badgeClass: string }[] = [
  { value: 'green', label: 'Verde', badgeClass: 'bg-green-500/10 text-green-600' },
  { value: 'yellow', label: 'Amarelo', badgeClass: 'bg-amber-500/10 text-amber-600' },
  { value: 'red', label: 'Vermelho', badgeClass: 'bg-red-500/10 text-red-600' },
  { value: 'gray', label: 'Cinza', badgeClass: 'bg-gray-500/10 text-gray-600' },
];

// Ordem alfabética por padrão (pedido do usuário) — o usuário ainda pode
// reordenar arrastando na tela de Gerenciar Status, ou clicar em "Ordenar
// A-Z" pra voltar pra essa ordem a qualquer momento.
// Category (booking/origin/transit/customs/delivered/cancelled) orienta a
// linha do tempo genérica do tracking do cliente — ver lib/shipmentStatusCategory.ts.
const DEFAULT_STATUSES = DEFAULT_STATUS_OPTIONS;

export function LogisticsTab({ shipment, quoteId, onUpdate, clientOptions, onClientChange, clientIdOverride }: Props) {
  const { t } = useLanguage();
  const { user, profile } = useAuth();
  const { isFullAccess } = usePermissions();
  const queryClient = useQueryClient();

  // Processo Finalizado (categoria 'delivered' em Gerenciar Status) não pode
  // mais ser editado — é a trava de UI que acompanha a trava já aplicada no
  // banco (trigger shipments_guard_finalized). Reabertura só pela tela de
  // Admin (full access), via RPC reopen_shipment.
  const locked = !!(shipment as any).is_finalized;
  function warnLocked() {
    toast.error('Processo finalizado — não é possível mais editar.');
  }

  // Fetch custom status options from DB
  const { data: dbStatusOptions = [] } = useQuery({
    queryKey: ['shipment-status-options', profile?.company_id],
    queryFn: async () => {
      const { data, error } = await (supabase.from('shipment_status_options') as any)
        .select('*')
        .eq('company_id', profile?.company_id)
        .order('position');
      if (error) throw error;
      return data as { id: string; label: string; value: string; position: number; category: string }[];
    },
    enabled: !!profile?.company_id,
  });

  // Merge: use DB options if available, otherwise defaults
  const statusOptions = dbStatusOptions.length > 0 ? dbStatusOptions : DEFAULT_STATUSES;

  const [showStatusManager, setShowStatusManager] = useState(false);
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [newStatusValue, setNewStatusValue] = useState('');
  const [newStatusCategory, setNewStatusCategory] = useState<StatusCategory>('transit');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  async function seedDefaults() {
    if (!profile?.company_id || dbStatusOptions.length > 0) return;
    await (supabase.from('shipment_status_options') as any).insert(
      DEFAULT_STATUSES.map(s => ({
        company_id: profile.company_id,
        label: s.label,
        value: s.value,
        position: s.position,
        category: s.category,
      }))
    );
    queryClient.invalidateQueries({ queryKey: ['shipment-status-options'] });
  }

  async function handleAddStatus() {
    if (!newStatusLabel.trim() || !profile?.company_id) return;
    const value = newStatusValue.trim() || newStatusLabel.trim().toLowerCase().replace(/\s+/g, '_');

    // Check for duplicate value
    const existingValues = statusOptions.map(s => s.value);
    if (existingValues.includes(value)) {
      toast.error('Esse status já existe');
      return;
    }

    // Seed defaults first if needed
    if (dbStatusOptions.length === 0) {
      await seedDefaults();
    }

    // Re-fetch to get correct position after potential seed
    const { data: current } = await (supabase.from('shipment_status_options') as any)
      .select('position')
      .eq('company_id', profile.company_id)
      .order('position', { ascending: false })
      .limit(1);
    const nextPosition = current && current.length > 0 ? current[0].position + 1 : DEFAULT_STATUSES.length;

    const { error } = await (supabase.from('shipment_status_options') as any).insert({
      company_id: profile.company_id,
      label: newStatusLabel.trim(),
      value,
      position: nextPosition,
      category: newStatusCategory,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Status adicionado');
    setNewStatusLabel('');
    setNewStatusValue('');
    setNewStatusCategory('transit');
    queryClient.invalidateQueries({ queryKey: ['shipment-status-options'] });
  }

  // Categoria orienta em qual marco da linha do tempo (Reservado/Origem/
  // Trânsito/Desembaraço/Entregue) o status cai no tracking do cliente.
  async function handleUpdateCategory(id: string, category: StatusCategory) {
    const { error } = await (supabase.from('shipment_status_options') as any)
      .update({ category })
      .eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['shipment-status-options'] });
  }

  async function handleDeleteStatus(id: string) {
    const { error } = await (supabase.from('shipment_status_options') as any).delete().eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Status removido');
    queryClient.invalidateQueries({ queryKey: ['shipment-status-options'] });
  }

  async function handleReorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || dbStatusOptions.length === 0) return;
    const reordered = [...statusOptions];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    // Update positions in DB
    const updates = reordered.map((s, i) => {
      if ('id' in s) {
        return (supabase.from('shipment_status_options') as any)
          .update({ position: i })
          .eq('id', (s as any).id);
      }
      return null;
    }).filter(Boolean);

    try {
      await Promise.all(updates);
      queryClient.invalidateQueries({ queryKey: ['shipment-status-options'] });
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleSortAlphabetically() {
    if (dbStatusOptions.length === 0) return;
    const sorted = [...dbStatusOptions].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    try {
      await Promise.all(sorted.map((s, i) =>
        (supabase.from('shipment_status_options') as any).update({ position: i }).eq('id', s.id)
      ));
      queryClient.invalidateQueries({ queryKey: ['shipment-status-options'] });
      toast.success('Status ordenados de A a Z');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  // Cotação vinculada ao embarque — fonte de "espelho" pra Ref. Cliente,
  // FreeTime, Transit Time e Validade, que já existem lá (preenchidos na
  // Comercial/Proposta) antes de existirem aqui. Também usada pra achar os
  // itens (containers) da FCL.
  const { data: linkedQuote, isLoading: linkedQuoteLoading } = useQuery({
    queryKey: ['logistics-linked-quote', shipment.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select('id, client_reference, free_time, transit_time, valid_until')
        .eq('shipment_id', shipment.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; client_reference: string | null; free_time: number | null; transit_time: number | null; valid_until: string | null } | null;
    },
  });

  // Fetch quote_items to know container count for FCL
  const { data: quoteItems = [], isLoading: quoteItemsLoading } = useQuery({
    queryKey: ['logistics-quote-items', linkedQuote?.id],
    enabled: !!linkedQuote?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_items')
        .select('*')
        .eq('quote_id', linkedQuote!.id)
        .order('created_at');
      if (error) throw error;
      return data || [];
    },
  });

  const isFCL = shipment.transport_mode === 'ocean_fcl' || shipment.transport_mode === 'multimodal';
  // Só considera a contagem de containers "definitiva" depois que a query da
  // cotação vinculada E a de itens da carga terminarem de carregar — sem
  // isso, o card piscava com uma contagem errada (ou desatualizada) por uma
  // fração de segundo enquanto os dados ainda vinham do banco.
  const containerDataReady = !linkedQuoteLoading && (!linkedQuote?.id || !quoteItemsLoading);
  // Quantidade de containers vem sempre da aba Resumo da Carga (soma de
  // container_qty de cada item — um item pode representar "3x 40HC", por
  // exemplo, não é 1 container por linha), e SEMPRE acompanha o que está lá
  // agora — inclusive pra menos, se um container for removido na Carga.
  const containerCount = isFCL && containerDataReady
    ? Math.max(quoteItems.reduce((sum: number, it: any) => sum + (Number(it.container_qty) || 1), 0), 1)
    : 0;

  const [form, setForm] = useState({
    client_reference: (shipment as any).client_reference || '',
    invoice_number: (shipment as any).invoice_number || '',
    free_time: (shipment as any).free_time != null ? String((shipment as any).free_time) : '',
    transit_time: '',
    valid_until: '',
    origin_city: shipment.origin_city || '',
    origin_country: shipment.origin_country || '',
    origin_port: shipment.origin_port || '',
    transshipment: (shipment as any).transshipment || '',
    destination_city: shipment.destination_city || '',
    destination_country: shipment.destination_country || '',
    destination_port: shipment.destination_port || '',
    vessel_flight: shipment.vessel_flight || '',
    booking_number: shipment.booking_number || '',
    master_bl: shipment.master_bl || '',
    house_bl: shipment.house_bl || '',
    ce_mercante_manifest: shipment.ce_mercante_manifest || '',
    ce_mercante_master: shipment.ce_mercante_master || '',
    ce_mercante_house: shipment.ce_mercante_house || '',
    dta_number: (shipment as any).dta_number || '',
    other_info: (shipment as any).other_info || '',
    etd: shipment.etd || '',
    eta: shipment.eta || '',
    atd: shipment.atd || '',
    ata: shipment.ata || '',
    status: shipment.status || 'draft',
    incoterm: (shipment as any).incoterm || '',
    transport_mode: shipment.transport_mode || 'ocean_fcl',
    courier_provider: (shipment as any).courier_provider || '',
    courier_tracking_number: (shipment as any).courier_tracking_number || '',
    customs_channel: (shipment as any).customs_channel || '',
    duimp_number: (shipment as any).duimp_number || '',
    physical_location: (shipment as any).physical_location || '',
    customs_registration_date: (shipment as any).customs_registration_date || '',
    cargo_delivered_at: (shipment as any).cargo_delivered_at || '',
    invoice_sent_at: (shipment as any).invoice_sent_at || '',
  });

  // Números/prazos de demurrage salvos no embarque — guarda só o que já
  // existe no banco, sem "pré-encher" pra containerCount aqui. containerCount
  // só fica correto depois que a query de quote_items (Resumo da Carga)
  // carrega (é assíncrona), então prender o tamanho do array a esse valor
  // logo na montagem do componente cortava containers ainda não numerados —
  // a quantidade de campos exibidos é sempre recalculada no render (ver
  // containerSlotCount abaixo), não depende de um efeito rodar a tempo.
  const [containerNumbers, setContainerNumbers] = useState<string[]>(() => parseContainerNumbers(shipment.container_number));

  // Lacre POR container — array paralelo ao de números (mesmo índice).
  const [containerSeals, setContainerSeals] = useState<string[]>(() => parseContainerNumbers((shipment as any).container_seals));

  // Entrada no terminal POR container — início da contagem do FreeTime
  // daquele container (fim = data de devolução, abaixo). Cada container pode
  // entrar no terminal em dias diferentes, então é um array por índice, não
  // um campo único do embarque.
  const [containerTerminalEntry, setContainerTerminalEntry] = useState<string[]>(() => parseContainerDates((shipment as any).container_terminal_entry_dates));

  // Data de devolução do container vazio — também por container (mesmo
  // índice dos arrays acima). Fim da contagem do FreeTime; usada pro
  // tracking do cliente saber quais containers já foram devolvidos e não
  // mostrar mais o alerta de limite de devolução vencido pra eles.
  const [containerReturnDates, setContainerReturnDates] = useState<string[]>(() => parseContainerDates((shipment as any).container_return_dates));

  // Quantidade de campos de container exibidos: acompanha exatamente a
  // Resumo da Carga (containerCount) uma vez que os dados terminaram de
  // carregar — inclusive encolhendo se um container for removido lá. Antes
  // disso (containerDataReady ainda false), usa o que já está salvo, só pra
  // não piscar "1 container" por uma fração de segundo enquanto carrega.
  const containerSlotCount = containerDataReady
    ? containerCount
    : Math.max(containerNumbers.length, containerSeals.length, containerTerminalEntry.length, containerReturnDates.length);

  // Se a Resumo da Carga encolheu (ex: um container foi removido), corta os
  // números/prazos que sobraram além da nova quantidade — sem isso, o
  // container removido lá continuava aparecendo aqui (só a Carga refletia a
  // remoção, a Logística ficava presa na quantidade antiga).
  useEffect(() => {
    if (!isFCL || !containerDataReady) return;
    setContainerNumbers(prev => (prev.length > containerCount ? prev.slice(0, containerCount) : prev));
    setContainerSeals(prev => (prev.length > containerCount ? prev.slice(0, containerCount) : prev));
    setContainerTerminalEntry(prev => (prev.length > containerCount ? prev.slice(0, containerCount) : prev));
    setContainerReturnDates(prev => (prev.length > containerCount ? prev.slice(0, containerCount) : prev));
  }, [isFCL, containerDataReady, containerCount]);

  // "Achata" os itens da Resumo da Carga em uma lista de 1 tipo por
  // container (um item com container_qty=3 vira 3 entradas) — usada só pra
  // mostrar o tipo (ex: "40HC") ao lado de cada container aqui, alinhado
  // pelo índice.
  const containerTypesFlat = useMemo(() => {
    const flat: string[] = [];
    for (const it of quoteItems as any[]) {
      const qty = Number(it.container_qty) || 1;
      for (let i = 0; i < qty; i++) flat.push(it.container_type);
    }
    return flat;
  }, [quoteItems]);

  function setContainerNumberAt(idx: number, value: string) {
    setContainerNumbers(prev => {
      const arr = [...prev];
      while (arr.length <= idx) arr.push('');
      arr[idx] = value;
      return arr;
    });
  }

  function setContainerSealAt(idx: number, value: string) {
    setContainerSeals(prev => {
      const arr = [...prev];
      while (arr.length <= idx) arr.push('');
      arr[idx] = value;
      return arr;
    });
  }

  function setContainerTerminalEntryAt(idx: number, value: string) {
    setContainerTerminalEntry(prev => {
      const arr = [...prev];
      while (arr.length <= idx) arr.push('');
      arr[idx] = value;
      return arr;
    });
  }

  function setContainerReturnDateAt(idx: number, value: string) {
    setContainerReturnDates(prev => {
      const arr = [...prev];
      while (arr.length <= idx) arr.push('');
      arr[idx] = value;
      return arr;
    });
  }

  const [saving, setSaving] = useState(false);

  // Espelha Ref. Cliente/FreeTime/Transit Time/Validade da cotação vinculada
  // na primeira vez que o embarque ainda não tem valor próprio salvo — depois
  // disso os campos aqui viram independentes (podem ser ajustados sem afetar
  // a origem retroativamente).
  useEffect(() => {
    if (!linkedQuote) return;
    if (!form.client_reference && linkedQuote.client_reference) {
      updateField('client_reference', linkedQuote.client_reference);
    }
    if (!form.free_time && linkedQuote.free_time != null) {
      updateField('free_time', String(linkedQuote.free_time));
    }
    if (!form.transit_time && linkedQuote.transit_time != null) {
      updateField('transit_time', String(linkedQuote.transit_time));
    }
    if (!form.valid_until && linkedQuote.valid_until) {
      updateField('valid_until', linkedQuote.valid_until);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedQuote]);

  // Trânsito (dias) calculado sozinho como ETA - ETD assim que as duas datas
  // estiverem preenchidas — só entra quando o campo ainda está vazio, pra não
  // sobrescrever um valor que o usuário já digitou manualmente (ex: uma
  // estimativa antes de ETD/ETA reais existirem).
  useEffect(() => {
    if (form.transit_time || !form.etd || !form.eta) return;
    const days = differenceInCalendarDays(new Date(form.eta), new Date(form.etd));
    if (days >= 0) updateField('transit_time', String(days));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.etd, form.eta]);

  // País não tem mais campo próprio na tela — já fica implícito no porto
  // escolhido. Preenche origin_country/destination_country sozinho em
  // segundo plano (usado em outros lugares, ex: bandeira na lista de
  // Embarques), buscando o country_code do porto selecionado.
  useEffect(() => {
    if (!form.origin_port) return;
    let cancelled = false;
    supabase.from('ports').select('country_code').eq('code', form.origin_port).maybeSingle().then(({ data }) => {
      if (!cancelled && data?.country_code) updateField('origin_country', data.country_code);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.origin_port]);

  useEffect(() => {
    if (!form.destination_port) return;
    let cancelled = false;
    supabase.from('ports').select('country_code').eq('code', form.destination_port).maybeSingle().then(({ data }) => {
      if (!cancelled && data?.country_code) updateField('destination_country', data.country_code);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.destination_port]);

  // Detecta alterações pendentes (contra o que já está salvo no embarque/
  // cotação vinculada) pra disparar o auto-save — Logística não tem mais
  // botão "Salvar" próprio.
  const hasChanges = useMemo(() => {
    const fieldsToCheck: (keyof typeof form)[] = [
      'client_reference', 'invoice_number', 'free_time',
      'origin_city', 'origin_country', 'origin_port', 'transshipment',
      'destination_city', 'destination_country', 'destination_port',
      'vessel_flight', 'booking_number',
      'master_bl', 'house_bl', 'ce_mercante_manifest', 'ce_mercante_master', 'ce_mercante_house',
      'dta_number', 'other_info',
      'etd', 'eta', 'atd', 'ata', 'incoterm', 'transport_mode',
      'courier_provider', 'courier_tracking_number',
      'customs_channel', 'duimp_number', 'physical_location', 'customs_registration_date',
      'cargo_delivered_at', 'invoice_sent_at',
    ];
    for (const key of fieldsToCheck) {
      const newVal = (form as any)[key] ?? '';
      const oldVal = (shipment as any)[key] ?? '';
      if (DATE_FIELDS.has(key)) {
        // Datas voltam do banco com formatação diferente de Date.toISOString()
        // (ex: "+00:00" em vez de "Z"), mesmo sendo o mesmo instante — comparar
        // como string aqui fazia o auto-save entrar em loop infinito.
        const newTime = newVal ? new Date(newVal).getTime() : null;
        const oldTime = oldVal ? new Date(oldVal).getTime() : null;
        if (newTime !== oldTime) return true;
        continue;
      }
      if (String(newVal) !== String(oldVal)) return true;
    }
    if (isFCL && containerCount !== ((shipment as any).container_quantity ?? null) && containerCount > 0) return true;
    const existingContainers = parseContainerNumbers(shipment.container_number);
    const currentContainers = containerNumbers.filter(Boolean);
    if (existingContainers.length !== currentContainers.length) return true;
    for (let i = 0; i < currentContainers.length; i++) {
      if ((existingContainers[i] || '') !== (currentContainers[i] || '')) return true;
    }
    const existingSeals = parseContainerNumbers((shipment as any).container_seals);
    const currentSeals = containerSeals.filter(Boolean);
    if (existingSeals.length !== currentSeals.length) return true;
    for (let i = 0; i < currentSeals.length; i++) {
      if ((existingSeals[i] || '') !== (currentSeals[i] || '')) return true;
    }
    const existingTerminalEntry = parseContainerDates((shipment as any).container_terminal_entry_dates);
    for (let i = 0; i < Math.max(existingTerminalEntry.length, containerTerminalEntry.length); i++) {
      const newT = containerTerminalEntry[i] ? new Date(containerTerminalEntry[i]).getTime() : null;
      const oldT = existingTerminalEntry[i] ? new Date(existingTerminalEntry[i]).getTime() : null;
      if (newT !== oldT) return true;
    }
    const existingReturnDates = parseContainerDates((shipment as any).container_return_dates);
    for (let i = 0; i < Math.max(existingReturnDates.length, containerReturnDates.length); i++) {
      const newT = containerReturnDates[i] ? new Date(containerReturnDates[i]).getTime() : null;
      const oldT = existingReturnDates[i] ? new Date(existingReturnDates[i]).getTime() : null;
      if (newT !== oldT) return true;
    }
    if (linkedQuote) {
      if ((form.transit_time || '') !== (linkedQuote.transit_time != null ? String(linkedQuote.transit_time) : '')) return true;
      const newValidUntilT = form.valid_until ? new Date(form.valid_until).getTime() : null;
      const oldValidUntilT = linkedQuote.valid_until ? new Date(linkedQuote.valid_until).getTime() : null;
      if (newValidUntilT !== oldValidUntilT) return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, containerNumbers, containerSeals, containerTerminalEntry, containerReturnDates, shipment, isFCL, containerCount, linkedQuote]);

  // Auto-save: nenhum botão "Salvar" próprio. Antes disparava sozinho 900ms
  // depois de qualquer tecla digitada — o que salvava no meio da digitação
  // se o usuário parasse de pensar por menos de um segundo. Agora só salva
  // quando o usuário sai do campo (onBlur, anexado no container que envolve
  // todos os cards — o blur do React borbulha, então cobre qualquer input
  // dentro dele, mesmo em cards diferentes). Status continua salvando na
  // hora, como já era, pelo próprio Select de status.
  function handleAutoSaveBlur() {
    if (locked) return;
    if (!hasChanges || saving) return;
    handleSave();
  }

  async function handleSave() {
    if (locked) { warnLocked(); return; }
    setSaving(true);
    try {
      // Número, lacre, entrada no terminal e devolução são arrays paralelos
      // (mesmo índice = mesmo container) — alinha todos no mesmo tamanho
      // antes de salvar, pra nunca desalinhar o dado do container #2 com o
      // número do #1.
      const alignedLength = Math.max(containerNumbers.length, containerSeals.length, containerTerminalEntry.length, containerReturnDates.length);
      const containerNumberValue = containerNumbers.filter(Boolean).length > 0
        ? JSON.stringify(Array.from({ length: alignedLength }, (_, i) => (containerNumbers[i] || '').trim()))
        : null;
      const containerSealsValue = containerSeals.some(Boolean)
        ? JSON.stringify(Array.from({ length: alignedLength }, (_, i) => (containerSeals[i] || '').trim()))
        : null;
      const containerTerminalEntryValue = containerTerminalEntry.some(Boolean)
        ? JSON.stringify(Array.from({ length: alignedLength }, (_, i) => containerTerminalEntry[i] || ''))
        : null;
      const containerReturnDatesValue = containerReturnDates.some(Boolean)
        ? JSON.stringify(Array.from({ length: alignedLength }, (_, i) => containerReturnDates[i] || ''))
        : null;

      const updates: Record<string, any> = {
        client_reference: form.client_reference || null,
        invoice_number: form.invoice_number || null,
        // Qtd. Container não é mais digitada aqui — vem sempre da soma dos
        // itens da Resumo da Carga (FCL/multimodal); fora disso, preserva o
        // que já estava salvo.
        container_quantity: isFCL ? containerCount : ((shipment as any).container_quantity ?? null),
        free_time: form.free_time ? parseInt(form.free_time, 10) : null,
        origin_city: form.origin_city || null,
        origin_country: form.origin_country || null,
        origin_port: form.origin_port || null,
        transshipment: form.transshipment || null,
        destination_city: form.destination_city || null,
        destination_country: form.destination_country || null,
        destination_port: form.destination_port || null,
        vessel_flight: form.vessel_flight || null,
        booking_number: form.booking_number || null,
        master_bl: form.master_bl || null,
        house_bl: form.house_bl || null,
        ce_mercante_manifest: form.ce_mercante_manifest || null,
        ce_mercante_master: form.ce_mercante_master || null,
        ce_mercante_house: form.ce_mercante_house || null,
        dta_number: form.dta_number || null,
        other_info: form.other_info || null,
        etd: form.etd || null,
        eta: form.eta || null,
        atd: form.atd || null,
        ata: form.ata || null,
        status: form.status,
        incoterm: (form.incoterm && form.incoterm !== 'NONE') ? form.incoterm : null,
        transport_mode: form.transport_mode as any,
        container_number: containerNumberValue,
        container_seals: containerSealsValue,
        container_terminal_entry_dates: containerTerminalEntryValue,
        container_return_dates: containerReturnDatesValue,
        courier_provider: form.courier_provider || null,
        courier_tracking_number: form.courier_tracking_number || null,
        customs_channel: form.customs_channel || null,
        duimp_number: form.duimp_number.trim() || null,
        physical_location: form.physical_location.trim() || null,
        customs_registration_date: form.customs_registration_date || null,
        cargo_delivered_at: form.cargo_delivered_at || null,
        invoice_sent_at: form.invoice_sent_at || null,
        // Setado explicitamente em vez de depender só do trigger do banco,
        // pra "Última Atividade" na lista de Embarques sempre refletir a mudança.
        updated_at: new Date().toISOString(),
        // Toda alteração no processo empurra o Next Update pro dia seguinte,
        // como lembrete automático de acompanhamento.
        next_update: addDays(new Date(), 1).toISOString(),
      };

      const auditLogs: { field_name: string; old_value: string | null; new_value: string | null }[] = [];
      const allFields = [
        'client_reference', 'invoice_number', 'container_quantity',
        'origin_city', 'origin_country', 'origin_port', 'transshipment',
        'destination_city', 'destination_country', 'destination_port',
        'vessel_flight', 'booking_number',
        'master_bl', 'house_bl', 'ce_mercante_manifest', 'ce_mercante_master', 'ce_mercante_house',
        'dta_number', 'other_info',
        'etd', 'eta', 'atd', 'ata', 'status', 'incoterm', 'transport_mode', 'container_number',
        'container_seals', 'container_terminal_entry_dates', 'container_return_dates',
        'courier_provider', 'courier_tracking_number',
        'customs_channel', 'duimp_number', 'physical_location', 'customs_registration_date',
        'cargo_delivered_at', 'invoice_sent_at',
      ];
      for (const dbKey of allFields) {
        const oldVal = shipment[dbKey]?.toString() || '';
        const newVal = (updates[dbKey]?.toString()) || '';
        if (DATE_FIELDS.has(dbKey)) {
          const oldTime = shipment[dbKey] ? new Date(shipment[dbKey]).getTime() : null;
          const newTime = updates[dbKey] ? new Date(updates[dbKey]).getTime() : null;
          if (oldTime !== newTime) {
            auditLogs.push({ field_name: dbKey, old_value: oldVal || null, new_value: newVal || null });
          }
          continue;
        }
        if (oldVal !== newVal) {
          auditLogs.push({ field_name: dbKey, old_value: oldVal || null, new_value: newVal || null });
        }
      }

      const { error } = await (supabase.from('shipments') as any).update(updates).eq('id', shipment.id);
      if (error) throw error;

      // Modal, Incoterm, Ref. Cliente, FreeTime, Transit Time e Validade são
      // espelhados com a cotação de origem (tabela quotes) — editar aqui
      // também atualiza a cotação, pra nunca ficarem divergentes.
      const quoteIdToSync = quoteId || linkedQuote?.id;
      if (quoteIdToSync) {
        await supabase.from('quotes').update({
          transport_mode: updates.transport_mode,
          incoterm: updates.incoterm,
          client_reference: updates.client_reference,
          free_time: updates.free_time,
          transit_time: form.transit_time ? parseInt(form.transit_time, 10) : null,
          valid_until: form.valid_until || null,
        } as any).eq('id', quoteIdToSync);
        queryClient.invalidateQueries({ queryKey: ['quote-detail', quoteIdToSync] });
        queryClient.invalidateQueries({ queryKey: ['logistics-linked-quote', shipment.id] });
      }

      if (auditLogs.length > 0 && profile) {
        await (supabase.from('shipment_audit_log') as any).insert(
          auditLogs.map(log => ({
            ...log,
            shipment_id: shipment.id,
            quote_id: quoteId || null,
            company_id: shipment.company_id,
            user_id: user?.id || null,
          }))
        );
      }

      toast.success(t('quotes.changes_saved'));
      onUpdate?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const updateField = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));

  function DateField({ label, fieldKey }: { label: string; fieldKey: string }) {
    const value = (form as any)[fieldKey];
    const dateValue = value ? new Date(value) : undefined;
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        <TypedDateField value={dateValue} onChange={(d) => updateField(fieldKey, d ? d.toISOString() : '')} />
      </div>
    );
  }

  // Igual ao DateField, mas pra valor/onChange avulsos (usado no prazo de
  // demurrage por container, que não é um campo único do form — é um array
  // indexado por container).
  function InlineDateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    const dateValue = value ? new Date(value) : undefined;
    return (
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <TypedDateField size="sm" value={dateValue} onChange={(d) => onChange(d ? d.toISOString() : '')} />
      </div>
    );
  }

  // Salva na hora (igual ao Select de Status) em vez de esperar o blur do
  // formulário — um clique em checkbox não "sai do campo" da mesma forma
  // que um input de texto, então o auto-save por blur não é confiável aqui.
  async function handleCheckboxDateSave(fieldKey: string, checked: boolean) {
    if (locked) { warnLocked(); return; }
    const oldValue = (form as any)[fieldKey] || '';
    const newValue = checked ? new Date().toISOString() : '';
    updateField(fieldKey, newValue);
    try {
      const { error } = await (supabase.from('shipments') as any).update({
        [fieldKey]: newValue || null,
        updated_at: new Date().toISOString(),
      }).eq('id', shipment.id);
      if (error) throw error;
      if (profile) {
        await (supabase.from('shipment_audit_log') as any).insert({
          shipment_id: shipment.id,
          quote_id: quoteId || null,
          company_id: shipment.company_id,
          user_id: user?.id || null,
          field_name: fieldKey,
          old_value: oldValue || null,
          new_value: newValue || null,
        });
      }
      toast.success(t('quotes.changes_saved'));
      onUpdate?.();
    } catch (err: any) {
      updateField(fieldKey, oldValue);
      toast.error(err.message);
    }
  }

  function CheckboxDateField({ label, fieldKey }: { label: string; fieldKey: string }) {
    const value = (form as any)[fieldKey];
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={!!value}
            onCheckedChange={(checked) => handleCheckboxDateSave(fieldKey, !!checked)}
          />
          <Label className="text-xs cursor-pointer" onClick={() => handleCheckboxDateSave(fieldKey, !value)}>
            {label}
          </Label>
        </div>
        <span className="text-xs text-muted-foreground">
          {value ? format(new Date(value), 'dd/MM/yyyy') : '—'}
        </span>
      </div>
    );
  }

  // Cliente (Card 1): se o pai (QuoteDetail) passar onClientChange, delega
  // pra lá — que checa taxas/DN/AR/parceiros já lançados no cliente antigo
  // antes de trocar e avisa o usuário. Sem isso (embarque avulso sem
  // cotação), salva direto aqui, sem aviso.
  async function handleClientSaveDirect(newClientId: string) {
    if (locked) { warnLocked(); return; }
    const oldClientId = (shipment as any).client_id || null;
    try {
      const { error } = await (supabase.from('shipments') as any).update({
        client_id: newClientId || null,
        updated_at: new Date().toISOString(),
      }).eq('id', shipment.id);
      if (error) throw error;
      if (profile) {
        await (supabase.from('shipment_audit_log') as any).insert({
          shipment_id: shipment.id,
          quote_id: quoteId || null,
          company_id: shipment.company_id,
          user_id: user?.id || null,
          field_name: 'client_id',
          old_value: oldClientId,
          new_value: newClientId || null,
        });
      }
      toast.success('Cliente atualizado com sucesso');
      onUpdate?.();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  const currentClientId = clientIdOverride ?? (shipment as any).client_id ?? '';
  const currentClientName = clientOptions?.find((c) => c.id === currentClientId)?.name || (shipment as any).clients?.name || '';

  return (
    <fieldset disabled={locked} className="contents">
    <div className="space-y-4" onBlur={handleAutoSaveBlur}>
      {locked && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Processo finalizado — os campos abaixo estão somente para leitura. Para editar, reabra o processo em Admin &gt; Reabrir Processos.
        </div>
      )}
      {/* CARD 1 — Status/Ref.Cliente/Cliente/Modal/Incoterm/Validade,
          Coleta/Entrega, Origem/Transbordo/Destino, Transit Time/Free Time */}
      <CollapsibleCard title="1. Geral">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold">Status</Label>
              {isFullAccess && (
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowStatusManager(true)}>
                  <Settings className="w-3 h-3" />
                </Button>
              )}
            </div>
            <Select value={form.status} onValueChange={async (v) => {
              if (locked) { warnLocked(); return; }
              const oldStatus = form.status;
              updateField('status', v);
              try {
                const { error } = await (supabase.from('shipments') as any).update({
                  status: v,
                  updated_at: new Date().toISOString(),
                  next_update: addDays(new Date(), 1).toISOString(),
                }).eq('id', shipment.id);
                if (error) throw error;
                if (profile) {
                  await (supabase.from('shipment_audit_log') as any).insert({
                    shipment_id: shipment.id,
                    quote_id: quoteId || null,
                    company_id: shipment.company_id,
                    user_id: user?.id || null,
                    field_name: 'status',
                    old_value: oldStatus,
                    new_value: v,
                  });
                }
                toast.success(t('quotes.changes_saved'));
                onUpdate?.();
              } catch (err: any) {
                updateField('status', oldStatus);
                toast.error(err.message);
              }
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map(s => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Ref. Cliente</Label>
            <Input value={form.client_reference} onChange={e => updateField('client_reference', e.target.value)} placeholder="Referência do cliente..." />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t('shipments.client')}</Label>
            {clientOptions ? (
              <Select
                value={currentClientId || '_none'}
                onValueChange={(v) => {
                  const newId = v === '_none' ? '' : v;
                  if (onClientChange) onClientChange(newId);
                  else handleClientSaveDirect(newId);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">—</SelectItem>
                  {clientOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center h-10 px-3 rounded-md border bg-muted text-sm">
                {currentClientName || '-'}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold">Modal</Label>
            <Select value={form.transport_mode} onValueChange={(v) => updateField('transport_mode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['ocean_fcl', 'ocean_lcl', 'air', 'road', 'multimodal'].map((m) => (
                  <SelectItem key={m} value={m}>{t(`mode.${m}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold">Incoterm</Label>
            <Select value={form.incoterm} onValueChange={(v) => updateField('incoterm', v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                {form.transport_mode === 'road' && <SelectItem value="NONE">— Sem incoterm —</SelectItem>}
                {(INCOTERMS_BY_MODE[form.transport_mode] || INCOTERMS_BY_MODE.ocean_fcl).map((ic) => (
                  <SelectItem key={ic} value={ic}>{ic}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {linkedQuote && (
            <div className="space-y-1">
              <Label className="text-xs">Validade</Label>
              <Input
                type="date"
                value={form.valid_until ? form.valid_until.slice(0, 10) : ''}
                onChange={(e) => updateField('valid_until', e.target.value ? new Date(e.target.value).toISOString() : '')}
              />
            </div>
          )}
        </div>

        {/* Status Manager Dialog */}
        <Dialog open={showStatusManager} onOpenChange={setShowStatusManager}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Gerenciar Status de Embarque</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={handleSortAlphabetically} disabled={dbStatusOptions.length === 0}>
                  <ArrowDownAZ className="w-3.5 h-3.5 mr-1.5" /> Ordenar A-Z
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                A categoria define em qual marco da linha do tempo (Reservado / Origem / Navegando ou Voando / Atracado / Desembaraço / Entregue) o status aparece no tracking do cliente.
              </p>
              <div className="space-y-1">
                {statusOptions.map((s, idx) => (
                  <div
                    key={s.value}
                    draggable={dbStatusOptions.length > 0 && 'id' in s}
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={() => { if (dragIdx !== null) { handleReorder(dragIdx, idx); setDragIdx(null); } }}
                    onDragEnd={() => setDragIdx(null)}
                    className={cn(
                      "flex items-center justify-between py-1.5 px-2 rounded bg-secondary/50 cursor-grab active:cursor-grabbing transition-opacity gap-2",
                      dragIdx === idx && "opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{s.label} <span className="text-xs text-muted-foreground">({s.value})</span></span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {dbStatusOptions.length > 0 && 'id' in s ? (
                        <Select value={(s as any).category || 'transit'} onValueChange={(v) => handleUpdateCategory((s as any).id, v as StatusCategory)}>
                          <SelectTrigger className="h-7 w-[130px] text-xs cursor-pointer" onClick={(e) => e.stopPropagation()}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_CATEGORY_OPTIONS.map((c) => (
                              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground w-[130px] text-right pr-1">
                          {STATUS_CATEGORY_OPTIONS.find((c) => c.value === (s as any).category)?.label || '—'}
                        </span>
                      )}
                      {dbStatusOptions.length > 0 && 'id' in s && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteStatus((s as any).id)}>
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Nome do status..."
                  value={newStatusLabel}
                  onChange={e => setNewStatusLabel(e.target.value)}
                  className="flex-1"
                />
                <Select value={newStatusCategory} onValueChange={(v) => setNewStatusCategory(v as StatusCategory)}>
                  <SelectTrigger className="w-[130px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleAddStatus} disabled={!newStatusLabel.trim()}>
                  <Plus className="w-4 h-4 mr-1" /> Adicionar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Coleta - Entrega */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
          <div className="space-y-1">
            <Label className="text-xs">Coleta</Label>
            <Input value={form.origin_city} onChange={e => updateField('origin_city', e.target.value)} placeholder="Endereço de coleta..." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Entrega</Label>
            <Input value={form.destination_city} onChange={e => updateField('destination_city', e.target.value)} placeholder="Endereço de entrega..." />
          </div>
        </div>

        {/* Origem - Transbordo - Destino — país não aparece mais aqui, já
            fica implícito no porto escolhido (auto-preenchido em segundo
            plano, ver efeito abaixo). */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
          <div className="space-y-1">
            <Label className="text-xs">Porto/Aeroporto Origem</Label>
            <PortSelect value={form.origin_port} onChange={(code) => updateField('origin_port', code)} transportMode={form.transport_mode} placeholder="Buscar porto/aeroporto..." />
          </div>
          {form.transport_mode !== 'road' ? (
            <div className="space-y-1">
              <Label className="text-xs">Transbordo</Label>
              <PortSelect value={form.transshipment} onChange={(code) => updateField('transshipment', code)} transportMode={form.transport_mode} placeholder="Transbordo (opcional)..." />
            </div>
          ) : <div />}
          <div className="space-y-1">
            <Label className="text-xs">Porto/Aeroporto Destino</Label>
            <PortSelect value={form.destination_port} onChange={(code) => updateField('destination_port', code)} transportMode={form.transport_mode} placeholder="Buscar porto/aeroporto..." />
          </div>
        </div>

        {/* Transit Time - Free Time */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
          <div className="space-y-1">
            <Label className="text-xs">Transit Time</Label>
            <Input
              type="number"
              min={0}
              value={form.transit_time}
              onChange={e => updateField('transit_time', e.target.value)}
              placeholder="Dias em trânsito..."
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">FreeTime (dias)</Label>
            <Input
              type="number"
              min={0}
              value={form.free_time}
              onChange={e => updateField('free_time', e.target.value)}
              placeholder="Ex: 14"
            />
          </div>
        </div>
      </CollapsibleCard>

      {/* CARD 2 — Invoice/Booking/Master/House, CEs (Shipper/Armador/Notify/
          Consignee mudaram pra aba Empresas — ver ShipmentPartnersCard) */}
      <CollapsibleCard title="2. Documentos">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Documentos & Referências</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Nº Invoice</Label>
              <Input value={form.invoice_number} onChange={e => updateField('invoice_number', e.target.value)} placeholder="Número da invoice..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Booking</Label>
              <Input value={form.booking_number} onChange={e => updateField('booking_number', e.target.value)} placeholder="Número Booking..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Master (BL/AWB)</Label>
              <Input value={form.master_bl} onChange={e => updateField('master_bl', e.target.value)} placeholder="Número Master..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">House (BL/AWB)</Label>
              <Input value={form.house_bl} onChange={e => updateField('house_bl', e.target.value)} placeholder="Número House..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CE Mercante Manifest</Label>
              <Input value={form.ce_mercante_manifest} onChange={e => updateField('ce_mercante_manifest', e.target.value)} placeholder="CE Manifest..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CE Mercante Master</Label>
              <Input value={form.ce_mercante_master} onChange={e => updateField('ce_mercante_master', e.target.value)} placeholder="CE Master..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CE Mercante House</Label>
              <Input value={form.ce_mercante_house} onChange={e => updateField('ce_mercante_house', e.target.value)} placeholder="CE House..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">DTA</Label>
              <Input value={form.dta_number} onChange={e => updateField('dta_number', e.target.value)} placeholder="Número DTA..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Outros</Label>
              <Input value={form.other_info} onChange={e => updateField('other_info', e.target.value)} placeholder="Outras informações..." />
            </div>
          </div>
        </div>
      </CollapsibleCard>

      {/* CARD 3 — Containers (qtd vem da Resumo da Carga): número, lacre e as
          datas que marcam início/fim da contagem do FreeTime por container. */}
      {isFCL && containerSlotCount > 0 && (
        <CollapsibleCard title={`3. Containers (${containerSlotCount})`}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: containerSlotCount }).map((_, idx) => (
              <div key={idx} className="space-y-2 rounded-md border border-border p-3">
                <Label className="text-xs">
                  Container #{idx + 1}
                  {containerTypesFlat[idx] && (
                    <span className="ml-1 text-muted-foreground">({containerTypesFlat[idx]})</span>
                  )}
                </Label>
                <Input
                  placeholder="Ex: MSKU1234567"
                  value={containerNumbers[idx] || ''}
                  onChange={(e) => setContainerNumberAt(idx, e.target.value.toUpperCase())}
                />
                <Input
                  placeholder="Lacre"
                  value={containerSeals[idx] || ''}
                  onChange={(e) => setContainerSealAt(idx, e.target.value.toUpperCase())}
                />
                <InlineDateField
                  label="Entrada no Terminal"
                  value={containerTerminalEntry[idx] || ''}
                  onChange={(v) => setContainerTerminalEntryAt(idx, v)}
                />
                {/* Prazo 1º Período de Armazenagem: calculado sozinho a partir
                    da Entrada no Terminal (+10 dias) — não é mais um campo
                    digitado, então só exibe (sem input) quando dá pra calcular. */}
                {containerTerminalEntry[idx] && (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Prazo 1º Período de Armazenagem</Label>
                    <p className="h-8 flex items-center text-xs text-muted-foreground">
                      {format(addDays(new Date(containerTerminalEntry[idx]), 10), 'dd/MM/yyyy')}
                    </p>
                  </div>
                )}
                <InlineDateField
                  label="Devolvido em"
                  value={containerReturnDates[idx] || ''}
                  onChange={(v) => setContainerReturnDateAt(idx, v)}
                />
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {/* CARD 4 — Vessel/Flight/ETD/ETA/ATD/ATA + Courier (aéreo). Entrada no
          Terminal e Prazo 1º Período de Armazenagem saíram daqui — viraram
          por container no Card 3 (Entrada no Terminal já vive lá; Prazo 1º
          Período é calculado a partir dela, Entrada + 10 dias). */}
      <CollapsibleCard title="4. Transporte & Datas">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Vessel/Flight</Label>
            <Input value={form.vessel_flight} onChange={e => updateField('vessel_flight', e.target.value)} />
          </div>
          <DateField label="Departure (ETD)" fieldKey="etd" />
          <DateField label="Arrive (ETA)" fieldKey="eta" />
          <DateField label="Departure (ATD)" fieldKey="atd" />
          <DateField label="Arrive (ATA)" fieldKey="ata" />

          {shipment.transport_mode === 'air' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Courier</Label>
                <Select
                  value={form.courier_provider || '_none'}
                  onValueChange={(v) => updateField('courier_provider', v === '_none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">—</SelectItem>
                    <SelectItem value="DHL">DHL</SelectItem>
                    <SelectItem value="FEDEX">FedEx</SelectItem>
                    <SelectItem value="UPS">UPS</SelectItem>
                    <SelectItem value="TNT">TNT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Nº de Rastreio Courier</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={form.courier_tracking_number}
                    onChange={e => updateField('courier_tracking_number', e.target.value)}
                    placeholder="Ex: 5132057442"
                    className="flex-1"
                  />
                  {(() => {
                    const url = getCourierTrackingUrl(form.courier_provider, form.courier_tracking_number);
                    return url ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3.5 h-3.5 mr-1" />
                          Rastrear
                        </a>
                      </Button>
                    ) : null;
                  })()}
                </div>
              </div>
            </>
          )}
        </div>
      </CollapsibleCard>

      {/* CARD 5 — DUIMP/DI/Registro/Canal/Fat.Enviado + Carga Entregue */}
      <CollapsibleCard title="5. Desembaraço, Entrega & Faturamento">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Canal</Label>
            <Select value={form.customs_channel || '_none'} onValueChange={(v) => updateField('customs_channel', v === '_none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">—</SelectItem>
                {CUSTOMS_CHANNEL_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.customs_channel && (
              <Badge className={CUSTOMS_CHANNEL_OPTIONS.find((c) => c.value === form.customs_channel)?.badgeClass}>
                Canal {CUSTOMS_CHANNEL_OPTIONS.find((c) => c.value === form.customs_channel)?.label}
              </Badge>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Número DUIMP</Label>
            <Input
              value={form.duimp_number}
              onChange={(e) => updateField('duimp_number', e.target.value)}
              placeholder="26BR00000000198"
              className="h-9"
            />
            <p className="text-[10px] text-muted-foreground">Preenchendo aqui, canal e situação são atualizados sozinhos via Portal Único (se a notificação automática estiver ativa em Configurações).</p>
          </div>
          <DateField label="Registro DI" fieldKey="customs_registration_date" />
          <div className="space-y-1">
            <Label className="text-xs">Localização Física da Carga</Label>
            <Input
              value={form.physical_location}
              onChange={(e) => updateField('physical_location', e.target.value)}
              placeholder="Ex.: Porto de Santos - Armazém 3"
              className="h-9"
            />
            <p className="text-[10px] text-muted-foreground">Aparece como "Físico" no tracking do cliente.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
          <CheckboxDateField label="Carga Entregue" fieldKey="cargo_delivered_at" />
          <CheckboxDateField label="Faturamento Enviado" fieldKey="invoice_sent_at" />
        </div>
      </CollapsibleCard>

      {/* Indicador de auto-save — não tem mais botão "Salvar" próprio */}
      {saving && (
        <div className="flex justify-end pt-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando…
          </span>
        </div>
      )}
    </div>
    </fieldset>
  );
}

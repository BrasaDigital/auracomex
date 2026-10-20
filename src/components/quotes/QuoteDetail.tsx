import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { groupByCurrency, formatCurrencyMap } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useHasAddon } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Save, Copy, FileText, Building2, Bell, CheckCircle, Send, MapPin, Package, Info, Users, ShoppingCart, Undo2, Calculator, HelpCircle, ChevronRight, ChevronLeft, Sparkles, ListChecks, Building, Wallet, History, NotebookPen, Receipt, Truck } from 'lucide-react';
import { CostEstimateTab } from './estimate/CostEstimateTab';
import { AccountabilityTab } from './estimate/AccountabilityTab';
import { useAccountability } from '@/hooks/useAccountability';
import { FloatingSaveButton } from './estimate/FloatingSaveButton';
import { QuotePdfPreviewDialog } from './QuotePdfPreviewDialog';
import { SendSupplierDnDialog } from './DebitNotesTab';
import { GenerateClientNdDialog } from './ClientDebitNotesTab';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ModeIcon } from '@/components/shared/ModeIcon';
import { PortSelect } from '@/components/shared/PortSelect';
import { ModeFields, PACKAGE_TYPES, emptyCargoItem, type CargoItem, calcItemCbm, calcItemWeight, calcChargeableWeight, calcChargeableWeightFromTotals, getEffectiveVolume, buildCargoSummaryLines, getItemsMissingPackages, missingPackagesMessage } from './ModeFields';
import { useCostEstimate } from '@/hooks/useCostEstimate';
import { extractCountryFromPort } from '@/lib/countryFlag';
import { FlagIcon } from '@/components/shared/FlagIcon';
import { BenchmarkCard } from '@/components/shared/BenchmarkCard';
import { CollapsibleCard } from '@/components/shared/CollapsibleCard';
import { AutoInsuranceCard } from '@/components/quotes/AutoInsuranceCard';
import { format } from 'date-fns';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { cn } from '@/lib/utils';
import { LogisticsTab } from '@/components/shipments/LogisticsTab';
import { ShipmentPartnersCard } from '@/components/shipments/ShipmentPartnersCard';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { collectPercentUpdates, computePercentCharge, isCollectFeeName, isPercentCharge, type PercentChargeLike, type CollectFxRates } from '@/lib/collectFee';
import { PercentBaseDialog } from '@/components/quotes/PercentBaseDialog';

import { DocumentsTab } from '@/components/shipments/DocumentsTab';
import { ShipmentEventsTab } from '@/components/shipments/ShipmentEventsTab';
import { OrdemColetaTab } from '@/components/coleta/OrdemColetaTab';
import { HistoryPanel } from './HistoryPanel';
// ActivityTab removida como aba própria: histórico agora é unificado no HistoryPanel (botão no header).
import { logAuditChanges, logAuditEvent } from '@/lib/auditLog';
import { deleteSupplierDn, deleteClientDn } from '@/lib/debitNotes';

const LEGS = ['origin', 'freight', 'destination'] as const;
const CURRENCIES = ['USD', 'BRL', 'EUR', 'GBP', 'CNY'];
const BILLING_UNITS = ['fixed', 'per_wm', 'per_cw', 'per_container', 'per_container_20', 'per_container_40', 'per_bl', 'percent'] as const;

// Group container types by size (20' vs 40'). Reefer/OT/FR agrupam pelo prefixo.
function containerSize(type?: string | null): 20 | 40 | null {
  if (!type) return null;
  if (type.startsWith('20')) return 20;
  if (type.startsWith('40')) return 40;
  return null;
}
const INCOTERMS_BY_MODE: Record<string, string[]> = {
  ocean_fcl: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  ocean_lcl: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  air: ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  road: ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  multimodal: ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
};

function playBellSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(830, ctx.currentTime);
    osc.frequency.setValueAtTime(1050, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(830, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio not available
  }
}

function fireConfetti() {
  const duration = 2000;
  const end = Date.now() + duration;
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];

  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

interface Props {
  quoteId: string;
  onBack: () => void;
  /** When provided, renders in "shipment mode" with extra tabs */
  shipmentId?: string;
}

export function QuoteDetail({ quoteId, onBack, shipmentId }: Props) {
  const { t, language } = useLanguage();
  const { profile } = useAuth();
  const { isFullAccess } = usePermissions();
  const queryClient = useQueryClient();
  const legacyEstimateFlag = !!(profile as any)?.estimateEnabled;
  const hasEstimateAddon = useHasAddon('cost_estimate_premium');
  // Mantém compat com a flag antiga da empresa; add-on comercial libera o mesmo módulo.
  const estimateEnabled = legacyEstimateFlag && hasEstimateAddon;
  // Prestação de Contas: só existe (e só aparece como aba) depois que o Numerário
  // é aprovado na aba Estimativa (ver CostEstimateTab/EstimatePdfDialog).
  const { data: accountabilityData } = useAccountability(quoteId, profile?.company_id);
  const accountability = accountabilityData?.accountability || null;
  // Estimativa de custo: quando preenchida, seus itens (peso/NCM/mercadoria) passam a ser a
  // fonte usada no cálculo das Taxas por kg/ton, em vez da Resumo da Carga. Volume (m³) e
  // containers continuam sempre vindos da Resumo da Carga, pois a Estimativa não tem esses campos.
  const { data: costEstimateData } = useCostEstimate(quoteId, profile?.company_id);
  const estimateItemsForCargo = costEstimateData?.estimate ? (costEstimateData.items || []) : [];
  const hasEstimateOverride = estimateItemsForCargo.length > 0;
  const [reverting, setReverting] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const isShipmentMode = !!shipmentId;

  const [form, setForm] = useState({
    client_id: '',
    origin: '',
    transshipment: '',
    destination: '',
    transport_mode: 'ocean_fcl',
    currency: 'USD',
    valid_until: '',
    notes: '',
    status: 'quoting',
    incoterm: '',
    transit_time: '',
    free_time: '',
    payment_terms: '',
    proposal_notes: '',
    storage_fee_amount: '',
    storage_fee_currency: 'BRL',
    storage_fee_note: '',
    pickup_address: '',
    delivery_address: '',
    client_reference: '',
    cargo_pallets: '',
    cargo_packages: '',
    cargo_package_type: '',
  });
  const [cargoItems, setCargoItems] = useState<CargoItem[]>([{ ...emptyCargoItem }]);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [chargeForm, setChargeForm] = useState({
    charge_catalog_id: '',
    description: '',
    charge_type: 'freight',
    leg: 'freight',
    amount: '',
    currency: 'USD',
    partner_id: '',
    billing_unit: 'fixed',
  });
  // Charge percentual sendo configurada (dialog aberto)
  const [percentDialogChargeId, setPercentDialogChargeId] = useState<string | null>(null);
  const [isAddingCharge, setIsAddingCharge] = useState(false);
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  // Campos do lado "Venda" — independentes dos campos de compra (chargeForm),
  // permitindo empresa, unidade de cobrança, moeda e valor diferentes para cada lado.
  // Basta deixar um dos lados sem valor para criar a taxa só de compra ou só de venda.
  const [sellPartnerId, setSellPartnerId] = useState('');
  const [sellBillingUnit, setSellBillingUnit] = useState('fixed');
  const [sellCurrency, setSellCurrency] = useState('USD');
  const [sellAmount, setSellAmount] = useState('');
  // Câmbio próprio desta taxa (Venda) — opcional. Alimenta a conversão pra BRL
  // na Estimativa/Numerário no lugar da taxa fiscal única, pra refletir o câmbio
  // real que cada fornecedor/parceiro cobrou nesta linha específica.
  const [sellExchangeRate, setSellExchangeRate] = useState('');
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [chargeDescSearch, setChargeDescSearch] = useState('');
  const [showChargeSuggestions, setShowChargeSuggestions] = useState(false);
  const [chargeDescHighlighted, setChargeDescHighlighted] = useState(0);
  const chargeDescInputRef = useRef<HTMLInputElement>(null);
  // Onboarding da aba Taxas (mostrado automaticamente na primeira visita)
  const [showChargesOnboarding, setShowChargesOnboarding] = useState(false);
  const [chargesOnboardingStep, setChargesOnboardingStep] = useState(0);

  // Aba ativa controlada
  const [activeTab, setActiveTab] = useState<string>(isShipmentMode ? 'logistics' : 'general');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);
  const [pendingClientChange, setPendingClientChange] = useState<string | null>(null);
  const [clientChangeWarnings, setClientChangeWarnings] = useState<string[]>([]);
  // Botão "Enviar DN" no cabeçalho de cada fornecedor na aba Taxas (Compra).
  const [sendDnPartner, setSendDnPartner] = useState<{ id: string; name: string; amount: number; currency: string; chargeIds: string[] } | null>(null);
  // Botão "Gerar ND" no cabeçalho de cada empresa na aba Taxas (Venda).
  const [generateNdPartner, setGenerateNdPartner] = useState<{ id: string; name: string; charges: any[] } | null>(null);

  // Handler para o botão voltar: se houver alterações não salvas, confirma antes.
  const handleBackClick = () => {
    const unsavedInQuoteMode = hasChanges && form.status !== 'converted' && !isShipmentMode;
    const unsavedCargoInShipment = hasChanges && isShipmentMode && canEditCargo;
    if (unsavedInQuoteMode || unsavedCargoInShipment) {
      setBackConfirmOpen(true);
      return;
    }
    onBack();
  };

  const handleTabChange = async (next: string) => {
    // Geral e Carga (e agora também Estimativa) salvam sozinhas ao sair do
    // campo (onBlur) — trocar de aba já blura o campo focado e dispara o
    // save antes da troca, na maioria dos casos. Mas ações que não passam
    // por um input (ex: excluir um item da Carga clicando na lixeira) não
    // disparam blur nenhum — antes disso caía num modal pedindo pra
    // "descartar" a exclusão, o que não faz sentido pra uma ação que já foi
    // deliberada. Em vez de perguntar, salva direto e troca de aba.
    const autoSavingTab = activeTab === 'cargo' || activeTab === 'general';
    if (autoSavingTab && hasChanges && next !== activeTab && canEditCargoForAutoSave) {
      await handleSave();
    }

    setActiveTab(next);
  };

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote-detail', quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select('*, clients(name)')
        .eq('id', quoteId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ['quote-items', quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_items')
        .select('*')
        .eq('quote_id', quoteId)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });

  const { data: charges = [] } = useQuery({
    queryKey: ['quote-charges', quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_charges')
        .select('*, clients:partner_id(name)' as any)
        .eq('quote_id', quoteId)
        .order('created_at');
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: catalog = [] } = useQuery({
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

  // Sugestões filtradas do catálogo de taxas pra descrição (compartilhado entre
  // renderização e navegação por teclado).
  const chargeFilteredSuggestions = useMemo(() => {
    const activeLeg = chargeForm.leg;
    return catalog
      .filter((c: any) => {
        const legs: string[] = c.legs || [];
        if (!legs.includes(activeLeg)) return false;
        if (chargeDescSearch.length >= 1) {
          return c.name.toLowerCase().includes(chargeDescSearch.toLowerCase());
        }
        return true;
      })
      .slice(0, 8);
  }, [catalog, chargeForm.leg, chargeDescSearch]);

  const chargeDescExactMatch = useMemo(
    () => catalog.some((c: any) => c.name.toLowerCase() === chargeDescSearch.toLowerCase()),
    [catalog, chargeDescSearch]
  );

  // "Adicionar ao catálogo" conta como mais um item navegável no fim da lista.
  const chargeDescShowAddOption = chargeDescSearch.length >= 2 && !chargeDescExactMatch;
  const chargeDescOptionCount = chargeFilteredSuggestions.length + (chargeDescShowAddOption ? 1 : 0);

  useEffect(() => {
    setChargeDescHighlighted(0);
  }, [chargeFilteredSuggestions.length, chargeDescShowAddOption]);

  function selectChargeSuggestion(s: any) {
    setChargeForm({ ...chargeForm, description: s.name, charge_catalog_id: s.id });
    setChargeDescSearch('');
    setShowChargeSuggestions(false);
  }

  async function addChargeDescToCatalog() {
    if (!profile) return;
    try {
      const { data, error } = await supabase.from('charge_catalog' as any).insert({
        company_id: profile.company_id,
        name: chargeDescSearch.trim().toUpperCase(),
        legs: [chargeForm.leg],
      } as any).select('*').single();
      if (error) throw error;
      setChargeForm({ ...chargeForm, description: (data as any).name, charge_catalog_id: (data as any).id });
      setChargeDescSearch('');
      setShowChargeSuggestions(false);
      queryClient.invalidateQueries({ queryKey: ['charge-catalog'] });
      toast.success(t('quotes.add_to_catalog'));
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  function handleChargeDescKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showChargeSuggestions || chargeDescOptionCount === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setChargeDescHighlighted((h) => (h + 1) % chargeDescOptionCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setChargeDescHighlighted((h) => (h - 1 + chargeDescOptionCount) % chargeDescOptionCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (chargeDescHighlighted < chargeFilteredSuggestions.length) {
        const chosen = chargeFilteredSuggestions[chargeDescHighlighted];
        if (chosen) selectChargeSuggestion(chosen);
      } else if (chargeDescShowAddOption) {
        addChargeDescToCatalog();
      }
    } else if (e.key === 'Escape') {
      setShowChargeSuggestions(false);
    }
  }

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-select'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name, partner_category').eq('type', 'client').order('name');
      return data || [];
    },
  });

  const { data: partners = [] } = useQuery({
    queryKey: ['partners-select'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name, type, partner_category, tax_id').order('name');
      return data || [];
    },
  });

  // Quote-specific partners (only these appear in charge partner dropdown)
  const { data: quotePartners = [] } = useQuery({
    queryKey: ['quote-partners', quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_partners' as any)
        .select('*, clients:client_id(id, name, type, partner_category, storage_rebate_percent, insurance_rate_pct)')
        .eq('quote_id', quoteId)
        .order('created_at');
      if (error) throw error;
      return data as any[];
    },
  });

  // Empresas (fornecedores) vinculadas ao processo — usadas para a DN
  // Fornecedor anexada na aba Documentos.
  const linkedPartnersForDn = (() => {
    const allowedIds = new Set(
      (quotePartners as any[]).map((qp) => qp.client_id).filter(Boolean)
    );
    return (partners as any[])
      .filter((p) => allowedIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, partner_category: p.partner_category }));
  })();

  // Shipment data (only when in shipment mode)
  const { data: shipment } = useQuery({
    queryKey: ['shipment', shipmentId],
    enabled: isShipmentMode,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('*, clients(name)')
        .eq('id', shipmentId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Country codes for origin/destination port codes — looked up directly from the
  // `ports` table (reliable for both UN/LOCODEs and IATA airport codes), instead of
  // guessing the country from the code's characters.
  const { data: routeCountries } = useQuery({
    queryKey: ['route-countries', form.origin, form.destination],
    enabled: !!(form.origin || form.destination),
    queryFn: async () => {
      const codes = [form.origin, form.destination].filter(Boolean);
      const { data, error } = await supabase
        .from('ports')
        .select('code, country_code')
        .in('code', codes);
      if (error) throw error;
      const map = new Map((data || []).map((p: any) => [p.code, p.country_code]));
      return { origin: map.get(form.origin) || '', destination: map.get(form.destination) || '' };
    },
  });

  async function handleRevertToQuote() {
    if (!shipmentId) return;
    if (isFinalized) { toast.error('Processo finalizado — não é possível reverter para cotação.'); return; }
    setReverting(true);
    try {
      await supabase.from('charge_lines').delete().eq('shipment_id', shipmentId);
      await supabase.from('shipment_partners').delete().eq('shipment_id', shipmentId);
      await supabase.from('documents').delete().eq('shipment_id', shipmentId);
      await supabase.from('activity_log').delete().eq('shipment_id', shipmentId);
      await supabase.from('shipment_audit_log').delete().eq('shipment_id', shipmentId);
      await supabase.from('charges').delete().eq('shipment_id', shipmentId);
      const { error: quoteErr } = await supabase.from('quotes').update({
        status: 'draft' as any,
        shipment_id: null,
      }).eq('id', quoteId);
      if (quoteErr) throw quoteErr;
      const { error: shipErr } = await supabase.from('shipments').delete().eq('id', shipmentId);
      if (shipErr) throw shipErr;
      toast.success(t('shipments.reverted_to_quote'));
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      onBack();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setReverting(false);
      setShowRevertConfirm(false);
    }
  }

  // Resumo em texto da aba Geral, pra colar em e-mail/whatsapp com fornecedores.
  // Mesmo formato do "Copiar Resumo" do modal de criação (QuoteCreateModal.buildSummaryText)
  // — Coleta e Entrega só entram na lista se estiverem preenchidos.
  function handleCopyGeneralSummary() {
    const mode = form.transport_mode;
    const modeLabel = t(`mode.${mode}`);

    const missingPkgs = getItemsMissingPackages(cargoItems, mode);
    if (missingPkgs.length > 0) {
      toast.error(missingPackagesMessage(missingPkgs));
      return;
    }

    const lines: string[] = [`📋 Cotação - ${modeLabel}`, ''];
    if (form.pickup_address) lines.push(`Coleta: ${form.pickup_address}`);
    lines.push(`Origem: ${form.origin || '-'}`);
    lines.push(`Destino: ${form.destination || '-'}`);
    if (form.delivery_address) lines.push(`Entrega: ${form.delivery_address}`);
    lines.push(`Incoterm: ${(form.incoterm && form.incoterm !== 'NONE') ? form.incoterm : '-'}`);
    if (form.client_reference) lines.push(`Ref. do Cliente: ${form.client_reference}`);
    lines.push('');
    lines.push(...buildCargoSummaryLines(mode, cargoItems, { pallets: form.cargo_pallets, packages: form.cargo_packages, package_type: form.cargo_package_type }));

    if (form.notes) {
      lines.push('');
      lines.push(`Obs: ${form.notes}`);
    }

    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Resumo copiado');
  }

  useEffect(() => {
    if (quote) {
      setForm({
        client_id: quote.client_id || '',
        origin: quote.origin || '',
        transshipment: (quote as any).transshipment || '',
        destination: quote.destination || '',
        transport_mode: quote.transport_mode || 'ocean_fcl',
        currency: quote.currency || 'USD',
        valid_until: quote.valid_until ? format(new Date(quote.valid_until), 'yyyy-MM-dd') : '',
        notes: quote.notes || '',
        status: quote.status || 'draft',
        incoterm: (quote as any).incoterm || '',
        transit_time: (quote as any).transit_time?.toString() || '',
        free_time: (quote as any).free_time?.toString() || '',
        payment_terms: (quote as any).payment_terms || '',
        proposal_notes: (quote as any).proposal_notes || '',
        storage_fee_amount: (quote as any).storage_fee_amount != null ? String((quote as any).storage_fee_amount) : '',
        storage_fee_currency: (quote as any).storage_fee_currency || 'BRL',
        storage_fee_note: (quote as any).storage_fee_note || '',
        pickup_address: (quote as any).pickup_address || '',
        delivery_address: (quote as any).delivery_address || '',
        client_reference: (quote as any).client_reference || '',
        cargo_pallets: (quote as any).cargo_pallets?.toString() || '',
        cargo_packages: (quote as any).cargo_packages?.toString() || '',
        cargo_package_type: (quote as any).cargo_package_type || '',
      });
    }
  }, [quote]);

  useEffect(() => {
    if (items.length > 0) {
      setCargoItems(items.map((item: any) => ({
        id: item.id,
        container_type: item.container_type || '20GP',
        container_qty: item.container_qty || 1,
        container_number: item.container_number || '',
        weight_kg: item.weight_kg?.toString() || '',
        volume_cbm: item.volume_cbm?.toString() || '',
        chargeable_weight: item.chargeable_weight?.toString() || '',
        length_cm: item.length_cm?.toString() || '',
        width_cm: item.width_cm?.toString() || '',
        height_cm: item.height_cm?.toString() || '',
        packages: item.packages?.toString() || '',
        pieces: item.pieces?.toString() || '',
        pieces_unit: item.pieces_unit || 'pçs',
        ncm_code: item.ncm_code || '',
        commodity: item.commodity || '',
        dangerous_goods: item.dangerous_goods || false,
        vehicle_type: item.vehicle_type || '',
        cargo_value: item.cargo_value?.toString() || '',
        cargo_value_currency: item.cargo_value_currency || 'USD',
        notes: item.notes || '',
      })));
    }
  }, [items]);

  const incoterms = useMemo(() => INCOTERMS_BY_MODE[form.transport_mode] || INCOTERMS_BY_MODE.ocean_fcl, [form.transport_mode]);

  // Cargo metrics for billing unit calculations.
  // Volume e containers vêm sempre da Resumo da Carga (a Estimativa não tem esses campos).
  // Peso vem da Estimativa quando ela estiver preenchida; senão, vem da Resumo da Carga.
  const cargoMetrics = useMemo(() => {
    const totalCbm = cargoItems.reduce((s, i) => s + getEffectiveVolume(i), 0);
    let totalContainers20 = 0;
    let totalContainers40 = 0;
    for (const i of cargoItems) {
      const qty = Number((i as any).container_qty) || 1;
      const size = containerSize((i as any).container_type);
      if (size === 20) totalContainers20 += qty;
      else if (size === 40) totalContainers40 += qty;
    }
    const totalContainers = totalContainers20 + totalContainers40;

    const totalWeight = hasEstimateOverride
      ? estimateItemsForCargo.reduce((s: number, it: any) => s + (Number(it.peso) || 0) * (Number(it.quantidade) || 1), 0)
      : cargoItems.reduce((s, i) => s + calcItemWeight(i), 0);
    const totalChargeable = hasEstimateOverride
      ? calcChargeableWeightFromTotals(totalWeight, totalCbm, form.transport_mode)
      : calcChargeableWeight(cargoItems, form.transport_mode);

    return { totalWeight, totalCbm, totalChargeable, totalContainers, totalContainers20, totalContainers40 };
  }, [cargoItems, form.transport_mode, hasEstimateOverride, estimateItemsForCargo]);

  // Check if form or cargo items have changed compared to original quote/items
  const hasChanges = useMemo(() => {
    if (!quote) return false;
    
    const formChanged = 
      form.client_id !== (quote.client_id || '') ||
      form.origin !== (quote.origin || '') ||
      (form.transshipment || '') !== ((quote as any).transshipment || '') ||
      form.destination !== (quote.destination || '') ||
      form.transport_mode !== (quote.transport_mode || 'ocean_fcl') ||
      form.currency !== (quote.currency || 'USD') ||
      form.status !== (quote.status || 'draft') ||
      (form.incoterm || '') !== ((quote as any).incoterm || '') ||
      (form.transit_time || '') !== ((quote as any).transit_time?.toString() || '') ||
      (form.free_time || '') !== ((quote as any).free_time?.toString() || '') ||
      (form.notes || '') !== (quote.notes || '') ||
      (form.payment_terms || '') !== ((quote as any).payment_terms || '') ||
      (form.proposal_notes || '') !== ((quote as any).proposal_notes || '') ||
      (form.storage_fee_amount || '') !== ((quote as any).storage_fee_amount != null ? String((quote as any).storage_fee_amount) : '') ||
      (form.storage_fee_currency || 'BRL') !== ((quote as any).storage_fee_currency || 'BRL') ||
      (form.storage_fee_note || '') !== ((quote as any).storage_fee_note || '') ||
      (form.pickup_address || '') !== ((quote as any).pickup_address || '') ||
      (form.delivery_address || '') !== ((quote as any).delivery_address || '') ||
      (form.client_reference || '') !== ((quote as any).client_reference || '') ||
      (form.cargo_pallets || '') !== ((quote as any).cargo_pallets?.toString() || '') ||
      (form.cargo_packages || '') !== ((quote as any).cargo_packages?.toString() || '') ||
      (form.cargo_package_type || '') !== ((quote as any).cargo_package_type || '');

    if (formChanged) return true;

    if (cargoItems.length !== items.length) return true;

    for (let i = 0; i < cargoItems.length; i++) {
      const ci = cargoItems[i];
      const oi = items[i];
      if (!oi) return true;
      if (
        (ci.container_type || '') !== (oi.container_type || '') ||
        (ci.container_qty || 0) !== (oi.container_qty || 0) ||
        (ci.container_number || '') !== ((oi as any).container_number || '') ||
        (ci.commodity || '') !== (oi.commodity || '') ||
        parseFloat(ci.weight_kg || '0') !== (oi.weight_kg || 0) ||
        parseFloat(ci.volume_cbm || '0') !== (oi.volume_cbm || 0) ||
        parseFloat(ci.chargeable_weight || '0') !== (oi.chargeable_weight || 0) ||
        (ci.ncm_code || '') !== (oi.ncm_code || '') ||
        parseFloat(ci.length_cm || '0') !== ((oi as any).length_cm || 0) ||
        parseFloat(ci.width_cm || '0') !== ((oi as any).width_cm || 0) ||
        parseFloat(ci.height_cm || '0') !== ((oi as any).height_cm || 0) ||
        parseInt(ci.packages || '0') !== ((oi as any).packages || 0) ||
        parseFloat(ci.pieces || '0') !== (Number((oi as any).pieces) || 0) ||
        (ci.pieces_unit || 'pçs') !== ((oi as any).pieces_unit || 'pçs') ||
        !!ci.dangerous_goods !== !!(oi as any).dangerous_goods ||
        (ci.vehicle_type || '') !== ((oi as any).vehicle_type || '') ||
        parseFloat(ci.cargo_value || '0') !== ((oi as any).cargo_value || 0) ||
        (ci.cargo_value_currency || 'USD') !== ((oi as any).cargo_value_currency || 'USD') ||
        (ci.notes || '') !== ((oi as any).notes || '')
      ) return true;
    }

    return false;
  }, [form, cargoItems, quote, items]);

  const dirtyCount = hasChanges ? 1 : 0;

  // Auto-save das abas Geral e Resumo da Carga: nenhuma das duas tem mais
  // botão "Salvar" próprio. Antes disparava sozinho 900ms depois de qualquer
  // tecla digitada — o que salvava no meio da digitação se o usuário parasse
  // de pensar por menos de um segundo. Agora só salva quando o usuário sai do
  // campo (onBlur), anexado no container de cada aba (o blur do React
  // borbulha, então cobre qualquer input dentro dele).
  // OBS: precisa ficar antes do "if (isLoading || !quote) return" lá embaixo,
  // senão o número de hooks muda entre o primeiro render (carregando) e os
  // seguintes, e o React quebra com "Rendered more hooks than during the
  // previous render" — por isso a checagem de permissão aqui é feita de
  // forma independente (com optional chaining), sem usar `canEditCargo`.
  const canEditCargoForAutoSave =
    (!isShipmentMode && form.status !== 'converted') || isFullAccess || (profile?.user_id === quote?.created_by);
  // 'logistics' entra na lista pra cobrir o Card 6 (Observações/Condições de
  // pagamento) mesclado lá após virar embarque; 'charges' cobre o campo
  // Armazenagem no destino, que mudou de aba (Geral → Taxas).
  function handleAutoSaveBlur(tab: 'general' | 'cargo' | 'logistics' | 'charges') {
    if (!quote || activeTab !== tab || !canEditCargoForAutoSave || !hasChanges || saving) return;
    handleSave();
  }

  // Se a aba Estimativa estiver desabilitada para a empresa, volta para 'general'.
  useEffect(() => {
    if (!estimateEnabled && activeTab === 'estimate') {
      setActiveTab(isShipmentMode ? 'logistics' : 'general');
    }
  }, [estimateEnabled, activeTab, isShipmentMode]);

  // Se a Prestação de Contas for excluída (destravando a Estimativa) enquanto
  // o usuário está nela, a aba some — volta pra Estimativa.
  useEffect(() => {
    if (!accountability && activeTab === 'accountability') {
      setActiveTab('estimate');
    }
  }, [accountability, activeTab]);

  // Onboarding da aba Taxas: mostra automaticamente na primeira vez que o usuário abre a aba.
  useEffect(() => {
    if (activeTab !== 'charges') return;
    try {
      const seen = localStorage.getItem('auracomex_taxas_onboarding_v1');
      if (!seen) {
        setChargesOnboardingStep(0);
        setShowChargesOnboarding(true);
      }
    } catch { /* localStorage indisponível — ignora */ }
  }, [activeTab]);

  // Aviso nativo do navegador ao recarregar/fechar com alterações não salvas.
  useEffect(() => {
    if (!hasChanges || form.status === 'converted' || isShipmentMode) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges, form.status, isShipmentMode]);

  // Helper to get billing multiplier for a charge
  function getChargeMultiplier(billingUnit: string): number {
    switch (billingUnit) {
      case 'per_cw': return cargoMetrics.totalChargeable;
      case 'per_ton': return cargoMetrics.totalWeight / 1000;
      case 'per_cbm': return cargoMetrics.totalCbm;
      case 'per_wm': return Math.max(cargoMetrics.totalWeight / 1000, cargoMetrics.totalCbm);
      case 'per_container': return cargoMetrics.totalContainers;
      case 'per_container_20': return cargoMetrics.totalContainers20;
      case 'per_container_40': return cargoMetrics.totalContainers40;
      case 'per_bl': return 1;
      default: return 1; // 'fixed'
    }
  }

  // Show charges including zero amounts (1.6)
  const buyCharges = charges.filter((c: any) => c.buy_amount != null && c.buy_amount >= 0 && (c.buy_amount > 0 || c.sell_amount === 0 || c.sell_amount == null));
  const sellCharges = charges.filter((c: any) => c.sell_amount != null && c.sell_amount >= 0 && (c.sell_amount > 0 || c.buy_amount === 0 || c.buy_amount == null));

  // Helper: check if a charge is a discount (DESCONTO in description)
  const isDiscount = (c: any) => (c.description || '').toUpperCase().includes('DESCONTO');

  // Taxa prepaid (já paga na origem) continua aparecendo nas listas de
  // compra/venda e na Estimativa/Numerário — só não conta no Lucro do
  // processo. Por isso filtra aqui, na base do cálculo de lucro, e não em
  // `charges` (que alimenta as tabelas de exibição mais abaixo).
  const profitCharges = charges.filter((c: any) => c.payment_term !== 'prepaid');

  // Currency-grouped totals (accounting for billing unit multipliers and DESCONTO)
  const buyByCurrency = groupByCurrency(profitCharges, (c: any) => c.currency || 'USD', (c: any) => {
    const val = c.billing_unit === 'percent'
      ? (Number(c.computed_buy_amount) || 0)
      : (Number(c.buy_amount) || 0) * getChargeMultiplier(c.billing_unit || 'fixed');
    return isDiscount(c) ? -val : val;
  });
  const sellByCurrency = groupByCurrency(profitCharges, (c: any) => c.currency || 'USD', (c: any) => {
    const val = c.billing_unit === 'percent'
      ? (Number(c.computed_sell_amount) || 0)
      : (Number(c.sell_amount) || 0) * getChargeMultiplier(c.billing_unit || 'fixed');
    return isDiscount(c) ? -val : val;
  });
  const allCurrencies = [...new Set([...Object.keys(buyByCurrency), ...Object.keys(sellByCurrency)])];
  const profitByCurrency: Record<string, number> = {};
  const marginByCurrency: Record<string, number> = {};
  allCurrencies.forEach((cur) => {
    const sell = sellByCurrency[cur] || 0;
    const buy = buyByCurrency[cur] || 0;
    profitByCurrency[cur] = sell - buy;
    marginByCurrency[cur] = sell > 0 ? ((sell - buy) / sell) * 100 : 0;
  });

  // BRL consolidation using daily FX rate - Manual update only
  const { usdBrl: latestUsdBrl, eurBrl: latestEurBrl, loading: ratesLoading } = useExchangeRate();
  const [usdBrl, setUsdBrl] = useState<number | null>(null);
  const [eurBrl, setEurBrl] = useState<number | null>(null);

  useEffect(() => {
    if (latestUsdBrl && usdBrl === null) setUsdBrl(latestUsdBrl);
    if (latestEurBrl && eurBrl === null) setEurBrl(latestEurBrl);
  }, [latestUsdBrl, latestEurBrl]);

  const fxRates: Record<string, number | null> = {
    BRL: 1,
    USD: usdBrl,
    EUR: eurBrl,
  };
  const convertibleCurrencies = new Set(['BRL', 'USD', 'EUR']);
  const toBRL = (amount: number, currency: string): number | null => {
    const rate = fxRates[currency];
    if (rate == null) return null;
    return amount * rate;
  };
  const sumToBRL = (map: Record<string, number>) => {
    let total = 0;
    let unsupported = 0;
    for (const [cur, val] of Object.entries(map)) {
      const conv = toBRL(val, cur);
      if (conv == null) unsupported += 1; else total += conv;
    }
    return { total, unsupported };
  };
  const buyBRL = sumToBRL(buyByCurrency);
  const sellBRL = sumToBRL(sellByCurrency);
  const profitBRLValue = sellBRL.total - buyBRL.total;
  const marginBRLValue = sellBRL.total > 0 ? (profitBRLValue / sellBRL.total) * 100 : 0;
  const unsupportedCurrencies = [...new Set([
    ...Object.keys(buyByCurrency).filter(c => !convertibleCurrencies.has(c)),
    ...Object.keys(sellByCurrency).filter(c => !convertibleCurrencies.has(c)),
  ])];
  const ratesAvailable = usdBrl != null && eurBrl != null;
  const fmtBRL = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtMoney = (cur: string, v: number) => `${cur} ${v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const detailLine = (map: Record<string, number>) => {
    const entries = Object.entries(map).filter(([, v]) => v !== 0);
    if (entries.length === 0) return '—';
    return entries.map(([cur, v]) => fmtMoney(cur, v)).join(' + ');
  };

  // Legacy totals for backward compat (syncTotals, BenchmarkCard) - with DESCONTO support
  const totalBuy = profitCharges.reduce((s: number, c: any) => {
    const val = c.buy_amount || 0;
    return s + (isDiscount(c) ? -val : val);
  }, 0);
  const totalSell = profitCharges.reduce((s: number, c: any) => {
    const val = c.sell_amount || 0;
    return s + (isDiscount(c) ? -val : val);
  }, 0);
  const profit = totalSell - totalBuy;
  const margin = totalSell > 0 ? (profit / totalSell) * 100 : 0;

  const legLabels: Record<string, string> = {
    origin: t('quotes.leg_origin'),
    freight: t('quotes.leg_freight'),
    destination: t('quotes.leg_destination'),
  };

  const legColors: Record<string, string> = {
    origin: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    freight: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    destination: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  };

  const legBorderLeftColors: Record<string, string> = {
    origin: 'border-l-blue-500',
    freight: 'border-l-emerald-500',
    destination: 'border-l-amber-500',
  };

  // Country derived from the port's actual country_code (looked up above),
  // falling back to parsing the code string itself (works for UN/LOCODEs) if the
  // lookup hasn't resolved yet.
  const originCountryCode = routeCountries?.origin || extractCountryFromPort(form.origin);
  const destCountryCode = routeCountries?.destination || extractCountryFromPort(form.destination);

  async function syncTotals() {
    const { data } = await supabase
      .from('quote_charges')
      .select('buy_amount, sell_amount')
      .eq('quote_id', quoteId);
    if (!data) return;
    const tb = data.reduce((s, c) => s + (c.buy_amount || 0), 0);
    const ts = data.reduce((s, c) => s + (c.sell_amount || 0), 0);
    await supabase.from('quotes').update({ total_buy: tb, total_sell: ts } as any).eq('id', quoteId);
  }

  // Recalcula todas as taxas percentuais (Collect Fee etc.) da cotação após qualquer alteração
  // em charges base. Persiste os novos buy_amount/sell_amount.
  async function recalcPercentCharges() {
    const { data } = await supabase
      .from('quote_charges')
      .select('id, description, currency, billing_unit, buy_amount, sell_amount, percent_base_charge_ids, computed_buy_amount, computed_sell_amount')
      .eq('quote_id', quoteId);
    if (!data || data.length === 0) return;
    const fx: CollectFxRates = { USD: usdBrl, BRL: 1, EUR: eurBrl };
    const updates = collectPercentUpdates(data as unknown as PercentChargeLike[], fx, getChargeMultiplier);
    for (const u of updates) {
      await supabase.from('quote_charges').update({ computed_buy_amount: u.computed_buy_amount, computed_sell_amount: u.computed_sell_amount } as any).eq('id', u.id);
    }
  }

  // Regra de negócio: todo embarque LCL ou FCL com armazenagem lançada deve
  // gerar (ou atualizar) uma conta a receber automática. Se o valor for
  // zerado e a conta ainda não tiver sido recebida, ela é removida.
  //
  // LCL: pagador é o Co-loader (aba Empresas) e o valor é um PERCENTUAL de
  // rebate cadastrado nele, calculado em cima da armazenagem lançada aqui.
  //
  // FCL: pagador é o Terminal (aba Empresas) e o valor é FIXO, cadastrado
  // direto no Terminal (não é calculado a partir da armazenagem lançada
  // aqui — é o rebate fixo que ele repassa por container/processo).
  async function syncStorageFeeReceivable() {
    if (!isShipmentMode || !shipmentId || !profile) return;
    const isLCL = form.transport_mode === 'ocean_lcl';
    const isFCL = form.transport_mode === 'ocean_fcl';
    if (!isLCL && !isFCL) return;

    const amount = form.storage_fee_amount ? parseFloat(form.storage_fee_amount) : 0;

    const { data: existing } = await supabase
      .from('accounts_receivable' as any)
      .select('id, status')
      .eq('quote_id', quoteId)
      .eq('source', 'storage_fee')
      .maybeSingle();

    if (!amount || amount <= 0) {
      if (existing && (existing as any).status === 'aberto') {
        await supabase.from('accounts_receivable' as any).delete().eq('id', (existing as any).id);
        queryClient.invalidateQueries({ queryKey: ['accounts_receivable'] });
      }
      return;
    }

    let payerId: string | undefined;
    let payerName: string | undefined;
    let rebateAmount: number | undefined;
    let description: string;

    if (isLCL) {
      const coLoader = (quotePartners as any[]).find((qp) => qp.clients?.partner_category === 'co_loader');
      if (!coLoader) {
        toast.warning('Armazenagem lançada, mas nenhum Co-loader cadastrado neste processo — a conta a receber não foi gerada. Cadastre o Co-loader na aba Empresas.');
        return;
      }
      // A conta a receber não é o valor cheio da armazenagem: é o rebate negociado
      // com esse Co-loader, um percentual cadastrado no fornecedor (aba Cadastros).
      const rebatePercent = coLoader.clients?.storage_rebate_percent;
      if (rebatePercent == null) {
        toast.warning(`Armazenagem lançada, mas o Co-loader "${coLoader.clients?.name}" não tem o percentual de rebate cadastrado — a conta a receber não foi gerada. Cadastre o rebate na aba Cadastros.`);
        return;
      }
      payerId = coLoader.clients.id;
      payerName = coLoader.clients?.name;
      rebateAmount = Math.round(amount * (Number(rebatePercent) / 100) * 100) / 100;
      description = `Rebate de armazenagem (${rebatePercent}% de ${form.storage_fee_currency || 'BRL'} ${amount.toFixed(2)}) - ${(quote as any)?.quote_number || ''}`;
    } else {
      const terminal = (quotePartners as any[]).find((qp) => qp.clients?.partner_category === 'terminal');
      if (!terminal) {
        toast.warning('Armazenagem lançada, mas nenhum Terminal cadastrado neste processo — a conta a receber não foi gerada. Cadastre o Terminal na aba Empresas.');
        return;
      }
      // FCL não calcula em cima do valor lançado — é um valor fixo cadastrado
      // direto no Terminal (aba Cadastros).
      const fixedValue = terminal.clients?.storage_fixed_value;
      if (fixedValue == null) {
        toast.warning(`Armazenagem lançada, mas o Terminal "${terminal.clients?.name}" não tem o valor fixo de rebate cadastrado — a conta a receber não foi gerada. Cadastre o valor fixo na aba Cadastros.`);
        return;
      }
      payerId = terminal.clients.id;
      payerName = terminal.clients?.name;
      rebateAmount = Number(fixedValue);
      description = `Rebate de armazenagem (valor fixo do Terminal ${payerName || ''}) - ${(quote as any)?.quote_number || ''}`;
    }

    const payload = {
      company_id: profile.company_id,
      source: 'storage_fee' as any,
      quote_id: quoteId,
      shipment_id: shipmentId,
      client_id: payerId,
      description,
      currency: form.storage_fee_currency || 'BRL',
      amount: rebateAmount,
      // Armazenagem não tem data de vencimento fixa (é cobrada quando o Co-loader/Terminal repassa o rebate).
      due_date: null,
      created_by: profile.user_id,
    };

    if (existing) {
      await supabase.from('accounts_receivable' as any).update(payload).eq('id', (existing as any).id);
    } else {
      await supabase.from('accounts_receivable' as any).insert(payload);
    }
    queryClient.invalidateQueries({ queryKey: ['accounts_receivable'] });
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    try {
      setSaveState('saving');

      // Monta o diff dos campos gerais contra os dados originais (antes de sobrescrever) para o histórico.
      const generalFieldChecks: { field: string; old: any; next: any }[] = [
        { field: 'client_id', old: (quote as any)?.client_id, next: form.client_id || null },
        { field: 'origin', old: (quote as any)?.origin, next: form.origin || null },
        { field: 'destination', old: (quote as any)?.destination, next: form.destination || null },
        { field: 'transport_mode', old: (quote as any)?.transport_mode, next: form.transport_mode },
        { field: 'incoterm', old: (quote as any)?.incoterm, next: (form.incoterm && form.incoterm !== 'NONE') ? form.incoterm : null },
        { field: 'valid_until', old: (quote as any)?.valid_until ? format(new Date((quote as any).valid_until), 'yyyy-MM-dd') : null, next: form.valid_until || null },
        { field: 'status', old: (quote as any)?.status, next: form.status },
        { field: 'pickup_address', old: (quote as any)?.pickup_address, next: form.pickup_address || null },
        { field: 'delivery_address', old: (quote as any)?.delivery_address, next: form.delivery_address || null },
        { field: 'client_reference', old: (quote as any)?.client_reference, next: form.client_reference || null },
      ];
      const generalChanges = generalFieldChecks
        .filter((c) => String(c.old ?? '') !== String(c.next ?? ''))
        .map((c) => {
          const fmt = (v: any) => {
            if (c.field === 'client_id') return clients.find((cl: any) => cl.id === v)?.name || v || null;
            return v ?? null;
          };
          return { field_name: c.field, old_value: fmt(c.old), new_value: fmt(c.next) };
        });

      const { error } = await supabase.from('quotes').update({
        client_id: form.client_id || null,
        origin: form.origin || null,
        transshipment: form.transshipment || null,
        destination: form.destination || null,
        transport_mode: form.transport_mode as any,
        currency: form.currency,
        valid_until: form.valid_until || null,
        notes: form.notes || null,
        status: form.status as any,
        incoterm: (form.incoterm && form.incoterm !== 'NONE') ? form.incoterm : null,
        transit_time: parseInt(form.transit_time) || null,
        free_time: parseInt(form.free_time) || null,
        payment_terms: form.payment_terms || null,
        proposal_notes: form.proposal_notes || null,
        storage_fee_amount: form.storage_fee_amount ? parseFloat(form.storage_fee_amount) : null,
        storage_fee_currency: form.storage_fee_amount ? (form.storage_fee_currency || 'BRL') : null,
        storage_fee_note: form.storage_fee_note || null,
        pickup_address: form.pickup_address || null,
        delivery_address: form.delivery_address || null,
        client_reference: form.client_reference || null,
        cargo_pallets: parseInt(form.cargo_pallets) || null,
        cargo_packages: parseInt(form.cargo_packages) || null,
        cargo_package_type: form.cargo_package_type || null,
      } as any).eq('id', quoteId);
      if (error) throw error;

      // Modal e Incoterm são espelhados com a aba Logística (tabela shipments) —
      // editar aqui também atualiza o embarque vinculado, pra nunca ficarem divergentes.
      if (isShipmentMode && shipmentId) {
        await (supabase.from('shipments') as any).update({
          transport_mode: form.transport_mode,
          incoterm: (form.incoterm && form.incoterm !== 'NONE') ? form.incoterm : null,
        }).eq('id', shipmentId);
        queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] });
      }

      await syncStorageFeeReceivable();

      const seenItemIds = new Set<string>();
      const itemPayload = (item: CargoItem) => ({
          quote_id: quoteId,
          company_id: profile.company_id,
          container_type: item.container_type || null,
          container_qty: item.container_qty || null,
          container_number: item.container_number || null,
          weight_kg: parseFloat(item.weight_kg) || null,
          volume_cbm: parseFloat(item.volume_cbm) || null,
          chargeable_weight: parseFloat(item.chargeable_weight) || null,
          length_cm: parseFloat(item.length_cm) || null,
          width_cm: parseFloat(item.width_cm) || null,
          height_cm: parseFloat(item.height_cm) || null,
          packages: parseInt(item.packages) || null,
          pieces: parseFloat(item.pieces || '') || null,
          pieces_unit: parseFloat(item.pieces || '') ? (item.pieces_unit || 'pçs') : null,
          ncm_code: item.ncm_code || null,
          commodity: item.commodity || null,
          dangerous_goods: item.dangerous_goods,
          vehicle_type: item.vehicle_type || null,
          cargo_value: parseFloat(item.cargo_value) || null,
          cargo_value_currency: item.cargo_value_currency || 'USD',
          notes: item.notes || null,
        });
      for (const item of cargoItems) {
        if (item.id) {
          seenItemIds.add(item.id);
          const { error: itemErr } = await supabase
            .from('quote_items' as any)
            .update(itemPayload(item))
            .eq('id', item.id)
            .eq('quote_id', quoteId);
          if (itemErr) throw itemErr;
        } else {
          const { data: insertedItem, error: itemErr } = await supabase
            .from('quote_items' as any)
            .insert(itemPayload(item))
            .select('id')
            .single();
          if (itemErr) throw itemErr;
          const insertedId = (insertedItem as any)?.id;
          if (insertedId) seenItemIds.add(insertedId);
        }
      }
      if (seenItemIds.size > 0) {
        await supabase.from('quote_items').delete().eq('quote_id', quoteId).not('id', 'in', `(${Array.from(seenItemIds).join(',')})`);
      } else {
        await supabase.from('quote_items').delete().eq('quote_id', quoteId);
      }

      // Resumo da Carga: compara ids originais vs. atuais para o histórico (nível de evento, não campo a campo).
      const originalItemIds = new Set((items as any[]).map((i: any) => i.id));
      const added = cargoItems.filter((i) => !i.id).length;
      const removed = Array.from(originalItemIds).filter((id) => !seenItemIds.has(id as string)).length;
      const editedIds = cargoItems.filter((i) => i.id && seenItemIds.has(i.id)).length;
      const cargoChanges: { field_name: string; old_value: string | null; new_value: string | null }[] = [];
      if (added || removed || editedIds !== originalItemIds.size || originalItemIds.size !== seenItemIds.size) {
        const parts: string[] = [];
        if (added) parts.push(`${added} item(ns) adicionado(s)`);
        if (removed) parts.push(`${removed} item(ns) removido(s)`);
        if (parts.length === 0 && editedIds > 0) parts.push('itens editados');
        if (parts.length > 0) {
          cargoChanges.push({ field_name: 'cargo_summary', old_value: `${originalItemIds.size} item(ns)`, new_value: parts.join(', ') });
        }
      }

      await logAuditChanges({
        quoteId,
        shipmentId: isShipmentMode ? shipmentId : null,
        companyId: profile.company_id,
        userId: profile.user_id,
        changes: [...generalChanges, ...cargoChanges],
      });

      await syncTotals();
      queryClient.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote-items', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['cost-estimate', quoteId] });
      // Aba Logística usa sua própria query (cache separado) pra saber a
      // quantidade de containers — sem invalidar aqui também, adicionar ou
      // remover item na Resumo da Carga só refletia lá depois de recarregar
      // a página inteira (F5), em vez de só trocar de aba.
      queryClient.invalidateQueries({ queryKey: ['logistics-quote-items'] });
      toast.success(t('quotes.changes_saved'));
      // Autosave no blur: não trava o salvamento (perderia o que a pessoa acabou
      // de digitar), mas avisa que Volumes é obrigatório pro peso/cubagem total.
      const missingPkgs = getItemsMissingPackages(cargoItems, form.transport_mode);
      if (missingPkgs.length > 0) {
        toast.warning(missingPackagesMessage(missingPkgs), { id: 'packages-required' });
      }
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (err: any) {
      toast.error(err.message);
      setSaveState('idle');
    } finally {
      setSaving(false);
    }
  }

  // Cotações já convertidas em embarque ficam travadas para edição geral
  // (botão "Editar Cotação" só existe fora do modo embarque). Isso cria um
  // beco sem saída quando o cliente do embarque precisa ser corrigido: esse
  // atalho libera o campo cliente seguindo a mesma regra de acesso da aba
  // Carga (canEditCargo), em vez de depender do modo de edição completo.
  async function handleChangeClient(newClientId: string) {
    if (isFinalized) { toast.error('Processo finalizado — não é possível editar.'); return; }
    if (!profile) return;
    const oldClientId = form.client_id || null;
    try {
      const { error: qErr } = await supabase.from('quotes').update({ client_id: newClientId } as any).eq('id', quoteId);
      if (qErr) throw qErr;
      if (shipmentId) {
        const { error: sErr } = await supabase
          .from('shipments')
          .update({ client_id: newClientId, updated_at: new Date().toISOString() } as any)
          .eq('id', shipmentId);
        if (sErr) throw sErr;
      }
      await logAuditChanges({
        quoteId,
        shipmentId: isShipmentMode ? shipmentId : null,
        companyId: profile.company_id,
        userId: profile.user_id,
        changes: [{ field_name: 'client_id', old_value: oldClientId, new_value: newClientId }],
      });
      setForm((f) => ({ ...f, client_id: newClientId }));
      queryClient.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      if (shipmentId) queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] });
      toast.success('Cliente atualizado com sucesso');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  // Antes de trocar o cliente de um embarque que JÁ tinha um cliente definido,
  // verifica se existem lançamentos financeiros (taxas, DN, contas a receber,
  // parceiros da cotação) feitos no nome do cliente atual. Trocar o cliente não
  // atualiza esses lançamentos em cascata, então avisamos o usuário antes.
  async function requestClientChange(newClientId: string) {
    if (isFinalized) { toast.error('Processo finalizado — não é possível editar.'); return; }
    const oldClientId = form.client_id;
    if (!oldClientId || oldClientId === newClientId) {
      handleChangeClient(newClientId);
      return;
    }
    try {
      const [chargesRes, dnRes, arRes, qpRes] = await Promise.all([
        supabase.from('quote_charges' as any).select('id', { count: 'exact', head: true }).eq('quote_id', quoteId).eq('partner_id', oldClientId),
        supabase.from('debit_notes' as any).select('id', { count: 'exact', head: true }).eq('quote_id', quoteId).eq('client_id', oldClientId),
        supabase.from('accounts_receivable' as any).select('id', { count: 'exact', head: true }).eq('quote_id', quoteId).eq('client_id', oldClientId),
        supabase.from('quote_partners' as any).select('id', { count: 'exact', head: true }).eq('quote_id', quoteId).eq('client_id', oldClientId),
      ]);
      const warnings: string[] = [];
      if ((chargesRes.count || 0) > 0) warnings.push(`${chargesRes.count} taxa(s) lançada(s)`);
      if ((dnRes.count || 0) > 0) warnings.push(`${dnRes.count} nota(s) de débito`);
      if ((arRes.count || 0) > 0) warnings.push(`${arRes.count} conta(s) a receber`);
      if ((qpRes.count || 0) > 0) warnings.push(`${qpRes.count} vínculo(s) de parceiro`);

      if (warnings.length > 0) {
        setClientChangeWarnings(warnings);
        setPendingClientChange(newClientId);
      } else {
        handleChangeClient(newClientId);
      }
    } catch (err: any) {
      // Se a verificação falhar por algum motivo, não bloqueia a troca —
      // apenas segue sem o aviso extra.
      handleChangeClient(newClientId);
    }
  }

  async function handleApprove() {
    if (!profile) return;
    // Guard: prevent double-conversion
    if (form.status === 'converted' || form.status === 'approved' || quote?.shipment_id) {
      toast.info(t('quotes.already_converted') || 'Esta cotação já foi convertida em embarque.');
      return;
    }

    // Salva a cotação ANTES de checar o limite do plano — se a conversão for
    // bloqueada logo abaixo, o que foi digitado não se perde (fica salvo como
    // cotação normal, só a conversão em embarque que fica pendente).
    await handleSave();

    // Bloqueio real de limite de embarques/mês do plano. O superadmin pode
    // conceder embarques bônus de cortesia (bonus_shipments), somados ao
    // limite do plano.
    if (profile.company_id) {
      const { data: companySub } = await supabase
        .from('company_subscriptions')
        .select('shipments_limit, bonus_shipments')
        .eq('company_id', profile.company_id)
        .maybeSingle();
      if (companySub?.shipments_limit != null) {
        const effectiveLimit = companySub.shipments_limit + (companySub.bonus_shipments || 0);
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const { count } = await supabase
          .from('shipments')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', profile.company_id)
          .gte('created_at', monthStart.toISOString());
        if ((count ?? 0) >= effectiveLimit) {
          toast.error(`Limite de ${effectiveLimit} embarques/mês do plano atingido. Sua cotação foi salva normalmente — faça upgrade (ou peça um embarque bônus ao suporte) para converter em embarque.`);
          return;
        }
      }
    }

    try {
      // Sync totals first
      await syncTotals();

      // Use the quote number as the shipment reference (unified numbering)
      const refNumber = quote?.quote_number || `SHP-${Date.now().toString(36).toUpperCase()}`;

      // Fetch port metadata for origin and destination
      let originCity = '';
      let originCountry = '';
      let destCity = '';
      let destCountry = '';

      if (form.origin) {
        const { data: originPort } = await supabase
          .from('ports')
          .select('city, country_name, country_code')
          .eq('code', form.origin)
          .maybeSingle();
        if (originPort) {
          originCity = originPort.city || '';
          // Store the 2-letter code (not the name) — that's what the flags
          // shown in the shipments list expect.
          originCountry = originPort.country_code || '';
        }
      }
      if (form.destination) {
        const { data: destPort } = await supabase
          .from('ports')
          .select('city, country_name, country_code')
          .eq('code', form.destination)
          .maybeSingle();
        if (destPort) {
          destCity = destPort.city || '';
          destCountry = destPort.country_code || '';
        }
      }

      // Create shipment from quote data
      const { data: newShipment, error: shipError } = await supabase.from('shipments').insert({
        company_id: profile.company_id,
        reference_number: refNumber,
        client_id: form.client_id || null,
        transport_mode: form.transport_mode as any,
        origin_port: form.origin || null,
        origin_city: originCity || null,
        origin_country: originCountry || null,
        destination_port: form.destination || null,
        destination_city: destCity || null,
        destination_country: destCountry || null,
        status: 'approved' as any,
        created_by: profile.user_id,
        // Espelhados da cotação de origem — sem isso o embarque nascia sem
        // Incoterm (e sem Ref. Cliente/FreeTime), só pegando esses valores
        // depois que alguém abrisse a aba Logística e o auto-preenchimento
        // rodasse. Agora já nasce certo.
        incoterm: (form.incoterm && (form.incoterm as any) !== 'NONE') ? form.incoterm : null,
        client_reference: form.client_reference || null,
        free_time: parseInt(form.free_time) || null,
      } as any).select('id').single();
      if (shipError) throw shipError;

      // Copy quote_charges to charge_lines
      if (charges.length > 0) {
        const chargeLinesToInsert: any[] = [];
        for (const qc of charges) {
          if ((qc.buy_amount || 0) > 0) {
            chargeLinesToInsert.push({
              shipment_id: newShipment.id,
              company_id: profile.company_id,
              direction: 'payable' as const,
              description: qc.description,
              charge_type: qc.charge_type || 'freight',
              amount: qc.buy_amount,
              currency: qc.currency || 'USD',
              partner_id: qc.partner_id || null,
              exchange_rate: 1,
              tax_rate: 0,
            });
          }
          if ((qc.sell_amount || 0) > 0) {
            chargeLinesToInsert.push({
              shipment_id: newShipment.id,
              company_id: profile.company_id,
              direction: 'receivable' as const,
              description: qc.description,
              charge_type: qc.charge_type || 'freight',
              amount: qc.sell_amount,
              currency: qc.currency || 'USD',
              partner_id: qc.partner_id || null,
              exchange_rate: 1,
              tax_rate: 0,
            });
          }
        }
        if (chargeLinesToInsert.length > 0) {
          await supabase.from('charge_lines').insert(chargeLinesToInsert as any);
        }
      }

      // Copy quote_partners to shipment_partners
      if (quotePartners.length > 0) {
        const spInsert = quotePartners.map((qp: any) => ({
          shipment_id: newShipment.id,
          company_id: profile.company_id,
          client_id: qp.client_id || qp.clients?.id,
        })).filter((sp: any) => sp.client_id);
        if (spInsert.length > 0) {
          await supabase.from('shipment_partners').insert(spInsert as any);
        }
      }

      // Update quote: link shipment and set status to converted
      const { error } = await supabase.from('quotes').update({
        status: 'converted' as any,
        shipment_id: newShipment.id,
      }).eq('id', quoteId);
      if (error) throw error;

      await logAuditEvent({
        quoteId,
        shipmentId: newShipment.id,
        companyId: profile.company_id,
        userId: profile.user_id,
        field_name: 'conversion',
        old_value: `Cotação (${quote?.status || form.status})`,
        new_value: `Embarque criado (${refNumber})`,
      });

      setForm((f) => ({ ...f, status: 'converted' }));
      queryClient.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });

      // Celebration!
      playBellSound();
      fireConfetti();
      toast.success(t('quotes.converted_to_shipment'));
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  function resetChargeFormAfterAdd() {
    const keepDefault = form.client_id || '';
    setChargeForm((prev) => ({ charge_catalog_id: '', description: '', charge_type: 'freight', leg: prev.leg, amount: '', currency: 'USD', partner_id: '', billing_unit: 'fixed' }));
    setSellPartnerId(keepDefault);
    setSellBillingUnit('fixed');
    setSellCurrency('USD');
    setSellAmount('');
    setSellExchangeRate('');
    setChargeDescSearch('');
  }

  // Compra e venda com empresa, unidade, moeda e valor totalmente independentes.
  // Basta deixar um dos lados sem valor para criar só a compra ou só a venda.
  async function handleAddCharge(opts?: { keepOpen?: boolean }) {
    if (isFinalized) { toast.error('Processo finalizado — não é possível editar.'); return; }
    if (!profile || !chargeForm.description.trim()) return;

    const buyAmt = parseFloat(chargeForm.amount) || 0;
    const sellAmt = parseFloat(sellAmount) || 0;
    if (buyAmt === 0 && sellAmt === 0) {
      toast.error('Informe o valor de compra e/ou de venda');
      return;
    }
    if (buyAmt !== 0 && !chargeForm.partner_id) {
      toast.error('Selecione a empresa de compra');
      return;
    }
    if (sellAmt !== 0 && !sellPartnerId) {
      toast.error('Selecione a empresa de venda');
      return;
    }

    await executeAddCharge(buyAmt, sellAmt, opts);
  }

  // Grava compra e venda como duas linhas independentes (cada uma com sua empresa, unidade
  // de cobrança, moeda e valor), pulando o lado cujo valor ficou zerado.
  async function executeAddCharge(buyAmt: number, sellAmt: number, opts?: { keepOpen?: boolean }) {
    if (!profile || !chargeForm.description.trim()) return;
    setIsAddingCharge(true);
    try {
      const baseRow: any = {
        quote_id: quoteId,
        company_id: profile.company_id,
        description: chargeForm.description.trim(),
        charge_type: chargeForm.charge_type,
        leg: chargeForm.leg,
        charge_catalog_id: chargeForm.charge_catalog_id || null,
      };

      let percentRowId: string | null = null;

      if (buyAmt !== 0) {
        const isPercent = chargeForm.billing_unit === 'percent';
        const row: any = {
          ...baseRow,
          buy_amount: buyAmt,
          sell_amount: 0,
          currency: isPercent ? 'USD' : chargeForm.currency,
          partner_id: chargeForm.partner_id || null,
          billing_unit: chargeForm.billing_unit,
        };
        if (isPercent) { row.percent_base_charge_ids = []; row.computed_buy_amount = 0; row.computed_sell_amount = 0; }
        const { data, error } = await supabase.from('quote_charges').insert(row as any).select('id').single();
        if (error) throw error;
        if (isPercent) percentRowId = (data as any)?.id || null;
      }

      if (sellAmt !== 0) {
        const isPercent = sellBillingUnit === 'percent';
        const row: any = {
          ...baseRow,
          buy_amount: 0,
          sell_amount: sellAmt,
          currency: isPercent ? 'USD' : sellCurrency,
          partner_id: sellPartnerId || null,
          billing_unit: sellBillingUnit,
          exchange_rate: (!isPercent && sellCurrency !== 'BRL' && sellExchangeRate) ? (parseFloat(sellExchangeRate) || null) : null,
        };
        if (isPercent) { row.percent_base_charge_ids = []; row.computed_buy_amount = 0; row.computed_sell_amount = 0; }
        const { data, error } = await supabase.from('quote_charges').insert(row as any).select('id').single();
        if (error) throw error;
        if (isPercent && !percentRowId) percentRowId = (data as any)?.id || null;
      }

      const addedParts: string[] = [];
      if (buyAmt !== 0) addedParts.push(`compra ${chargeForm.currency} ${buyAmt.toFixed(2)}`);
      if (sellAmt !== 0) addedParts.push(`venda ${sellCurrency} ${sellAmt.toFixed(2)}`);
      await logAuditEvent({
        quoteId,
        shipmentId: isShipmentMode ? shipmentId : null,
        companyId: profile.company_id,
        userId: profile.user_id,
        field_name: 'charge',
        old_value: null,
        new_value: `${chargeForm.description.trim()} (${addedParts.join(' / ')})`,
      });

      resetChargeFormAfterAdd();
      await recalcPercentCharges();
      await syncTotals();
      queryClient.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['cost-estimate', quoteId] });
      toast.success(t('financial.charge_added'));
      if (percentRowId) {
        setPercentDialogChargeId(percentRowId);
        setAddChargeOpen(false);
      } else if (!opts?.keepOpen) {
        setAddChargeOpen(false);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsAddingCharge(false);
    }
  }

  async function handleDeleteCharge(chargeId: string) {
    if (isFinalized) { toast.error('Processo finalizado — não é possível editar.'); return; }
    try {
      const charge = (charges as any[]).find((c: any) => c.id === chargeId);
      if (charge?.sent_in_debit_note_id) {
        toast.error('Esta taxa já foi enviada em uma DN e não pode ser excluída.');
        return;
      }
      const { error } = await supabase.from('quote_charges').delete().eq('id', chargeId);
      if (error) throw error;
      if (charge && profile) {
        const amt = charge.buy_amount > 0 ? `compra ${charge.currency} ${charge.buy_amount}` : `venda ${charge.currency} ${charge.sell_amount}`;
        await logAuditEvent({
          quoteId,
          shipmentId: isShipmentMode ? shipmentId : null,
          companyId: profile.company_id,
          userId: profile.user_id,
          field_name: 'charge',
          old_value: `${charge.description} (${amt})`,
          new_value: null,
        });
      }
      await recalcPercentCharges();
      await syncTotals();
      queryClient.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['cost-estimate', quoteId] });
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleUpdateCharge(chargeId: string, updates: Record<string, any>) {
    if (isFinalized) { toast.error('Processo finalizado — não é possível editar.'); return; }
    try {
      const charge = (charges as any[]).find((c: any) => c.id === chargeId);
      const { error } = await supabase.from('quote_charges').update(updates as any).eq('id', chargeId);
      if (error) throw error;
      if (charge && profile) {
        const changedKeys = Object.keys(updates).filter((k) => String((charge as any)[k] ?? '') !== String(updates[k] ?? ''));
        if (changedKeys.length > 0) {
          await logAuditEvent({
            quoteId,
            shipmentId: isShipmentMode ? shipmentId : null,
            companyId: profile.company_id,
            userId: profile.user_id,
            field_name: 'charge',
            old_value: `${charge.description}: ${changedKeys.map((k) => `${k}=${(charge as any)[k] ?? '-'}`).join(', ')}`,
            new_value: `${charge.description}: ${changedKeys.map((k) => `${k}=${updates[k] ?? '-'}`).join(', ')}`,
          });
        }
      }
      await recalcPercentCharges();
      await syncTotals();
      queryClient.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['cost-estimate', quoteId] });
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  // Reabrir uma taxa já enviada numa DN (ainda não paga): exclui a DN inteira
  // (some do Financeiro) e libera de volta pra edição todas as taxas que
  // estavam presas nela, com aviso no histórico da referência.
  async function handleReopenChargeWithDn(charge: any, partnerName: string) {
    if (!profile) return { ok: false as const, error: 'Não autenticado' };
    const dnId = charge.sent_in_debit_note_id;
    if (!dnId) return { ok: false as const, error: 'Taxa não está vinculada a uma DN' };
    const result = await deleteSupplierDn({
      dnId,
      companyId: profile.company_id,
      quoteId,
      userId: profile.user_id,
      partnerName,
    });
    if (result.ok === true) {
      queryClient.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['debit_notes', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['debit_notes_ap', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote_charges_for_dn', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['accounts_payable'] });
      toast.success('DN excluída — taxas liberadas para edição');
    } else {
      toast.error(result.error);
    }
    return result;
  }

  // Reabrir uma taxa de venda já enviada numa ND ao cliente (ainda não paga):
  // exclui a ND inteira (some do Financeiro) e libera a taxa pra edição de
  // novo, com aviso no histórico. Não existe "conferência" separada do lado
  // venda — gerar a ND já é o que trava o valor cobrado do cliente.
  async function handleReopenSellChargeWithNd(charge: any, partnerName: string) {
    if (!profile) return { ok: false as const, error: 'Não autenticado' };
    const dnId = charge.sent_in_debit_note_id;
    if (!dnId) return { ok: false as const, error: 'Taxa não está vinculada a uma ND' };
    const result = await deleteClientDn({
      dnId,
      companyId: profile.company_id,
      quoteId,
      userId: profile.user_id,
      clientName: partnerName,
    });
    if (result.ok === true) {
      queryClient.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['client_debit_notes', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote_sell_charges', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['accounts_receivable'] });
      toast.success('ND excluída — taxa liberada para edição');
    } else {
      toast.error(result.error);
    }
    return result;
  }

  async function handleCloneCharge(charge: any, newAmount: number, targetSide: 'buy' | 'sell', partnerId?: string) {
    if (isFinalized) { toast.error('Processo finalizado — não é possível editar.'); return; }
    if (!profile) return;
    try {
      const { error } = await supabase.from('quote_charges').insert({
        quote_id: quoteId,
        company_id: profile.company_id,
        description: charge.description,
        charge_type: charge.charge_type,
        leg: charge.leg,
        charge_catalog_id: charge.charge_catalog_id,
        buy_amount: targetSide === 'buy' ? newAmount : 0,
        sell_amount: targetSide === 'sell' ? newAmount : 0,
        currency: charge.currency,
        partner_id: partnerId ?? charge.partner_id ?? null,
        billing_unit: charge.billing_unit || 'fixed',
      } as any);
      if (error) throw error;
      await recalcPercentCharges();
      await syncTotals();
      queryClient.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['cost-estimate', quoteId] });
      toast.success(t('financial.charge_added'));
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (isLoading || !quote) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">{t('common.loading')}</div>;
  }

  // Financial visibility: only process owner (created_by) or admin can see/edit financial data
  const isProcessOwner = profile?.user_id === quote.created_by;
  const canSeeFinancials = isFullAccess || isProcessOwner;
  // Processo Finalizado (categoria 'delivered' em Gerenciar Status) não pode
  // mais ser editado de forma alguma — nem quem tem Full Access. Reabertura
  // só pela tela de Admin (RPC reopen_shipment).
  const isFinalized = isShipmentMode && !!(shipment as any)?.is_finalized;
  const canEditCharges = (!isShipmentMode || isFullAccess || isProcessOwner) && !isFinalized;
  // Mesma regra da Taxas, mas preservando o trava adicional de "cotação já convertida"
  // (fora do modo embarque) que existia antes só para usuários sem acesso total.
  const canEditCargo = ((!isShipmentMode && form.status !== 'converted') || isFullAccess || isProcessOwner) && !isFinalized;
  // A aba Geral não tem mais botão "Editar"/"Salvar" (fora o campo Cliente, que
  // tem sua própria trava dedicada) — ela sempre segue a mesma regra da aba
  // Carga e salva sozinha (auto-save), tanto em cotação quanto em embarque.
  const canEditGeneral = canEditCargo;

  const showPort = form.transport_mode !== 'road';

  const chargesOnboardingSteps = [
    {
      icon: Plus,
      title: 'Adicionar uma taxa',
      desc: 'Clique em "Adicionar Taxa" para lançar uma nova cobrança. Escolha o trecho (frete, origem, destino...) e descreva a taxa — o sistema sugere nomes já usados antes e aprende novos conforme você digita.',
    },
    {
      icon: Wallet,
      title: 'Compra e venda independentes',
      desc: 'Cada taxa tem um lado de Compra e um de Venda, cada um com sua própria empresa, unidade de cobrança, moeda e valor. Preencha só o lado que fizer sentido — não precisa dos dois.',
    },
    {
      icon: Building,
      title: 'Escolha as empresas certas',
      desc: 'Defina para quem você paga (Compra) e quem paga você (Venda). O cliente da cotação já vem pré-selecionado; troque quando o parceiro for outro, como um armador, CIA aérea ou agente.',
    },
    {
      icon: ListChecks,
      title: 'Acompanhe tudo organizado',
      desc: 'As taxas aparecem em duas colunas — Compra e Venda —, com totais e margem calculados automaticamente. Você pode editar, clonar ou excluir qualquer taxa quando quiser.',
    },
  ];

  return (
    <div className="space-y-1.5 animate-slide-in -mt-2 sm:-mt-3">
      {/* Onboarding da aba Taxas */}
      <Dialog
        open={showChargesOnboarding}
        onOpenChange={(o) => {
          setShowChargesOnboarding(o);
          if (!o) {
            try { localStorage.setItem('auracomex_taxas_onboarding_v1', '1'); } catch { /* ignore */ }
          }
        }}
      >
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <div className="px-6 py-4 border-b bg-muted/30">
            <DialogHeader className="space-y-0.5">
              <DialogTitle className="flex items-center gap-2 text-base">
                <span className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary">
                  <Sparkles className="w-4 h-4" />
                </span>
                Conheça a aba Taxas
              </DialogTitle>
              <DialogDescription className="text-xs">
                Um guia rápido de como lançar e organizar as cobranças da cotação.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-5 space-y-4 min-h-[180px]">
            {(() => {
              const step = chargesOnboardingSteps[chargesOnboardingStep];
              const StepIcon = step.icon;
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mx-auto">
                    <StepIcon className="w-6 h-6" />
                  </div>
                  <div className="text-center space-y-1.5">
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              );
            })()}
            <div className="flex items-center justify-center gap-1.5 pt-1">
              {chargesOnboardingSteps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${i === chargesOnboardingStep ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`}
                />
              ))}
            </div>
          </div>

          <DialogFooter className="flex-row items-center justify-between gap-2 px-6 py-3 border-t bg-muted/20 sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowChargesOnboarding(false);
                try { localStorage.setItem('auracomex_taxas_onboarding_v1', '1'); } catch { /* ignore */ }
              }}
            >
              Pular
            </Button>
            <div className="flex gap-2">
              {chargesOnboardingStep > 0 && (
                <Button variant="outline" size="sm" onClick={() => setChargesOnboardingStep((s) => s - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Voltar
                </Button>
              )}
              {chargesOnboardingStep < chargesOnboardingSteps.length - 1 ? (
                <Button size="sm" onClick={() => setChargesOnboardingStep((s) => s + 1)}>
                  Próximo <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    setShowChargesOnboarding(false);
                    try { localStorage.setItem('auracomex_taxas_onboarding_v1', '1'); } catch { /* ignore */ }
                  }}
                >
                  Entendi
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revert confirmation dialog (shipment mode only) */}
      {showRevertConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardContent className="pt-6 space-y-4">
              <h3 className="text-lg font-semibold">{t('shipments.revert_confirm_title')}</h3>
              <p className="text-sm text-muted-foreground">{t('shipments.revert_confirm_desc')}</p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowRevertConfirm(false)} disabled={reverting}>
                  {t('common.cancel')}
                </Button>
                <Button variant="destructive" onClick={handleRevertToQuote} disabled={reverting}>
                  {reverting ? '...' : t('shipments.revert_to_quote')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={handleBackClick}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2.5 flex-wrap min-w-0 flex-1">
          <h1
            className="text-lg sm:text-xl font-bold tracking-tight font-mono shrink-0 cursor-pointer hover:underline"
            title="Clique para copiar a referência"
            onClick={() => {
              navigator.clipboard.writeText(quote.quote_number || '');
              toast.success('Referência copiada');
            }}
          >
            {quote.quote_number}
          </h1>
          <span className="text-muted-foreground/40 shrink-0">-</span>
          <ModeIcon mode={form.transport_mode} />
          <span className="text-muted-foreground/40 shrink-0">-</span>
          <span
            className="text-sm text-muted-foreground truncate min-w-0 cursor-pointer hover:underline"
            title="Clique para copiar como texto (assunto de e-mail)"
            onClick={() => {
              const modeShortLabels: Record<string, string> = {
                ocean_fcl: 'FCL',
                ocean_lcl: 'LCL',
                air: 'AÉREO',
                road: 'RODOVIÁRIO',
                multimodal: 'MULTIMODAL',
              };
              const modeLabel = modeShortLabels[form.transport_mode] || form.transport_mode;
              const clientFirstName = (clients.find((c: any) => c.id === form.client_id)?.name || '-').split(' ')[0];
              const routeText = `${form.origin || '?'}/${form.destination || '?'}`;
              const descText = [
                quote.quote_number,
                modeLabel,
                clientFirstName,
                routeText,
                form.incoterm || null,
                form.client_reference ? `Ref. Cliente: ${form.client_reference}` : null,
              ].filter(Boolean).join(' - ');
              navigator.clipboard.writeText(descText);
              toast.success('Texto copiado');
            }}
          >
            {(clients.find((c: any) => c.id === form.client_id)?.name || '-').split(' ')[0]}
            {' - '}
            {originCountryCode && <FlagIcon country={originCountryCode} className="text-base mr-0.5" />}
            {form.origin || '?'}/
            {destCountryCode && <FlagIcon country={destCountryCode} className="text-base mr-0.5" />}
            {form.destination || '?'}
            {form.incoterm ? ` - ${form.incoterm}` : ''}
          </span>
          <Input
            value={form.client_reference}
            onChange={(e) => setForm({ ...form, client_reference: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            // Este campo fica no cabeçalho da página, fora do CardContent da
            // aba Geral — o auto-save por onBlur de lá (handleAutoSaveBlur)
            // só dispara quando activeTab === 'general', então editar aqui
            // estando em qualquer outra aba (Taxas, Logística etc.) nunca
            // salvava. Salva direto aqui, sem depender da aba ativa.
            onBlur={() => {
              if (!quote || saving) return;
              if ((form.client_reference || '') === ((quote as any).client_reference || '')) return;
              handleSave();
            }}
            placeholder="Ref. do Cliente"
            title="Referência do cliente (opcional) — entra na cópia do texto"
            className="h-6 w-32 shrink-0 text-xs px-2 text-center"
          />
        </div>
        {!isShipmentMode && form.status === 'converted' && (
          <div className="flex items-center gap-1.5 text-green-600 font-semibold text-sm shrink-0">
            <CheckCircle className="w-4 h-4" />
            {t('quote_status.converted')}
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          title="Histórico de alterações"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="w-4 h-4" />
        </Button>

      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="flex h-auto justify-center gap-1 p-1 w-full overflow-x-auto overflow-y-hidden flex-nowrap">
          {(() => {
            const triggerCls = "gap-1 sm:gap-1.5 text-[11px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 whitespace-nowrap shrink-0";
            const iconCls = "w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0";
            return (
              <>
                {/* Aba Geral só existe separada em cotação — depois de virar
                    embarque, os campos dela são mesclados dentro da aba
                    Logística (Card 1 e Card 6), pra não duplicar tela. */}
                {!isShipmentMode && (
                  <TabsTrigger value="general" className={triggerCls}>
                    <Info className={iconCls} /> {t('quotes.general')}
                  </TabsTrigger>
                )}
                {/* Em modo embarque, Logística vira a primeira aba — é a
                    tela principal de acompanhamento do processo depois que
                    ele já virou embarque. */}
                {isShipmentMode && (
                  <TabsTrigger value="logistics" className={triggerCls}>
                    <MapPin className={iconCls} /> {t('shipments.logistics')}
                  </TabsTrigger>
                )}
                <TabsTrigger value="cargo" className={triggerCls}>
                  <Package className={iconCls} /> {t('quotes.cargo')}
                </TabsTrigger>
                <TabsTrigger value="partners" className={triggerCls}>
                  <Users className={iconCls} /> {t('quotes.partners_tab')}
                </TabsTrigger>
                <TabsTrigger value="charges" className={triggerCls}>
                  <ShoppingCart className={iconCls} /> Taxas
                </TabsTrigger>
                {estimateEnabled && (
                  <TabsTrigger value="estimate" className={triggerCls}>
                    <Calculator className={iconCls} /> Estimativa
                  </TabsTrigger>
                )}
                {estimateEnabled && accountability && (
                  <TabsTrigger value="accountability" className={triggerCls}>
                    <Receipt className={iconCls} /> Prestação de Contas
                  </TabsTrigger>
                )}
                {/* Documents tab available in both modes */}
                <TabsTrigger value="documents" className={triggerCls}>
                  <FileText className={iconCls} /> {t('shipments.documents')}
                </TabsTrigger>
                {isShipmentMode && (
                  <TabsTrigger value="events" className={triggerCls}>
                    <NotebookPen className={iconCls} /> Diário
                  </TabsTrigger>
                )}
                {isShipmentMode && (
                  <TabsTrigger value="coleta" className={triggerCls}>
                    <Truck className={iconCls} /> Coleta
                  </TabsTrigger>
                )}
              </>
            );
          })()}
        </TabsList>

        {/* Resumo financeiro do processo — abaixo do menu de abas (que assim nunca
            muda de altura/posição), só faz sentido na aba Taxas. */}
        {canSeeFinancials && activeTab === 'charges' && (
        <div className="space-y-2">
          {(!ratesLoading && !ratesAvailable) || (unsupportedCurrencies.length > 0 && ratesAvailable) ? (
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              {!ratesLoading && !ratesAvailable && (
                <span className="text-amber-500">Câmbio indisponível — exibindo por moeda (atualize no menu lateral)</span>
              )}
              {unsupportedCurrencies.length > 0 && ratesAvailable && (
                <span className="text-amber-500">
                  {unsupportedCurrencies.length} moeda(s) não convertida(s): {unsupportedCurrencies.join(', ')}
                </span>
              )}
            </div>
          ) : null}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Card className="glass">
              <CardContent className="p-1 flex flex-col items-center justify-center text-center min-h-[24px]">
                {ratesAvailable ? (
                  <p className="flex items-baseline justify-center gap-1 flex-wrap" title={detailLine(buyByCurrency)}>
                    <span className="text-[10px] text-muted-foreground shrink-0">Compra -</span>
                    <span className="text-sm font-bold font-mono truncate">{fmtBRL(buyBRL.total)}</span>
                  </p>
                ) : (
                  <p className="flex items-baseline justify-center gap-1 flex-wrap">
                    <span className="text-[10px] text-muted-foreground shrink-0">Compra -</span>
                    <span className="text-sm font-bold font-mono break-words">{formatCurrencyMap(buyByCurrency)}</span>
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="glass">
              <CardContent className="p-1 flex flex-col items-center justify-center text-center min-h-[24px]">
                {ratesAvailable ? (
                  <p className="flex items-baseline justify-center gap-1 flex-wrap" title={detailLine(sellByCurrency)}>
                    <span className="text-[10px] text-muted-foreground shrink-0">Venda -</span>
                    <span className="text-sm font-bold font-mono truncate">{fmtBRL(sellBRL.total)}</span>
                  </p>
                ) : (
                  <p className="flex items-baseline justify-center gap-1 flex-wrap">
                    <span className="text-[10px] text-muted-foreground shrink-0">Venda -</span>
                    <span className="text-sm font-bold font-mono break-words">{formatCurrencyMap(sellByCurrency)}</span>
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="glass">
              <CardContent className="p-1 flex flex-col items-center justify-center text-center min-h-[24px]">
                {ratesAvailable ? (
                  <p
                    className="flex items-baseline justify-center gap-1 flex-wrap"
                    title={Object.keys(profitByCurrency).length === 0 ? '—' : Object.entries(profitByCurrency).map(([cur, v]) => fmtMoney(cur, v)).join(' + ')}
                  >
                    <span className="text-[10px] text-muted-foreground shrink-0">Lucro -</span>
                    <span className={`text-sm font-bold font-mono truncate ${profitBRLValue >= 0 ? 'text-status-completed' : 'text-status-urgent'}`}>
                      {fmtBRL(profitBRLValue)}
                    </span>
                  </p>
                ) : (
                  <div>
                    <span className="text-[10px] text-muted-foreground">Lucro</span>
                    {Object.entries(profitByCurrency).map(([cur, val]) => (
                      <span key={cur} className={`block text-sm font-bold font-mono ${val >= 0 ? 'text-status-completed' : 'text-status-urgent'}`}>
                        {cur} {val.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    ))}
                    {Object.keys(profitByCurrency).length === 0 && <span className="text-sm font-bold font-mono">-</span>}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="glass">
              <CardContent className="p-1 flex flex-col items-center justify-center text-center min-h-[24px]">
                {ratesAvailable ? (
                  <p className="flex items-baseline justify-center gap-1 flex-wrap" title="sobre venda em BRL">
                    <span className="text-[10px] text-muted-foreground shrink-0">Margem -</span>
                    <span className={`text-sm font-bold font-mono truncate ${marginBRLValue >= 0 ? 'text-status-completed' : 'text-status-urgent'}`}>
                      {sellBRL.total > 0 ? `${marginBRLValue.toFixed(1)}%` : '—'}
                    </span>
                  </p>
                ) : (
                  <div>
                    <span className="text-[10px] text-muted-foreground">Margem</span>
                    {Object.entries(marginByCurrency).map(([cur, val]) => (
                      <span key={cur} className="block text-sm font-bold font-mono">{cur} {val.toFixed(1)}%</span>
                    ))}
                    {Object.keys(marginByCurrency).length === 0 && <span className="text-sm font-bold font-mono">-</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
        )}

        {/* General Tab — só em cotação; depois de virar embarque esses campos
            ficam mesclados na aba Logística (Card 1 e Card 6). */}
        {!isShipmentMode && (
        <TabsContent value="general">
          <Card className="glass">
            <CardHeader className="flex flex-row items-center justify-between pb-0">
              <CardTitle className="text-base">Geral</CardTitle>
              <Button variant="outline" size="sm" onClick={handleCopyGeneralSummary}>
                <Copy className="w-3.5 h-3.5 mr-1.5" /> {t('common.copy_summary')}
              </Button>
            </CardHeader>
            <CardContent className="pt-6 space-y-4" onBlur={() => handleAutoSaveBlur('general')}>
              {/* Linha 1: Status - Ref. Cliente - Cliente - Modal - Incoterm - Validade (Status/Ref. Cliente/Validade só em cotações) */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {!isShipmentMode && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('shipments.status')}</Label>
                    {form.status === 'converted' ? (
                      <div className="flex items-center gap-1.5 h-10 px-3 rounded-md border bg-muted text-sm font-medium">
                        <CheckCircle className="w-4 h-4 text-status-completed" />
                        {t(`quote_status.${form.status}`)}
                      </div>
                    ) : (
                      <Select
                        value={form.status}
                        onValueChange={(v) => {
                          if (v === 'approved') {
                            // Não marca localmente como "approved" antes da hora: esse status só
                            // deve existir de fato se a conversão em embarque realmente for
                            // concluída (handleApprove já ajusta form.status pra 'converted' no
                            // sucesso). Se ficasse marcado aqui e a conversão fosse bloqueada
                            // (ex: limite do plano) ou falhasse, um save qualquer depois deixaria
                            // a cotação travada em "approved" sem embarque nenhum — sumindo tanto
                            // da lista de Cotações quanto da de Embarques.
                            handleApprove();
                          } else {
                            setForm({ ...form, status: v });
                          }
                        }}
                        disabled={!canEditGeneral}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['quoting', 'sent', 'approved', 'rejected'].map((s) => (
                            <SelectItem key={s} value={s}>{t(`quote_status.${s}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
                {!isShipmentMode && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ref. Cliente</Label>
                    <Input
                      value={form.client_reference || ''}
                      onChange={(e) => setForm({ ...form, client_reference: e.target.value })}
                      placeholder="Referência do cliente (opcional)"
                      disabled={!canEditGeneral}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('shipments.client')}</Label>
                  {(() => {
                    // No modo embarque não existe botão "Editar Cotação" — o campo Cliente
                    // segue a mesma regra de acesso da aba Carga (canEditCargo). Se o
                    // cliente já estiver definido e houver taxas/DN/AR/parceiros lançados
                    // no nome dele, avisamos antes de trocar (requestClientChange).
                    const canChangeClientInShipment = isShipmentMode && canEditCargo;
                    return (
                      <Select
                        value={form.client_id}
                        onValueChange={(v) => {
                          if (canChangeClientInShipment) {
                            requestClientChange(v);
                          } else {
                            setForm({ ...form, client_id: v });
                          }
                        }}
                        disabled={!canEditGeneral && !canChangeClientInShipment}
                      >
                        <SelectTrigger><SelectValue placeholder={t('quotes.select_client')} /></SelectTrigger>
                        <SelectContent>
                          {clients.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('shipments.mode')}</Label>
                  <Select
                    value={form.transport_mode}
                    onValueChange={(v) => setForm({ ...form, transport_mode: v })}
                    disabled={!canEditGeneral}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['ocean_fcl', 'ocean_lcl', 'air', 'road', 'multimodal'].map((m) => (
                        <SelectItem key={m} value={m}>{t(`mode.${m}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('quotes.incoterm')}</Label>
                  <Select
                    value={form.incoterm}
                    onValueChange={(v) => setForm({ ...form, incoterm: v })}
                    disabled={!canEditGeneral}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                    <SelectContent>
                      {form.transport_mode === 'road' && <SelectItem value="NONE">— Sem incoterm —</SelectItem>}
                      {incoterms.map((ic) => (
                        <SelectItem key={ic} value={ic}>{ic}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!isShipmentMode && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('quotes.valid_until')}</Label>
                    <Input
                      type="date"
                      value={form.valid_until}
                      onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                      disabled={!canEditGeneral}
                    />
                  </div>
                )}
              </div>

              {/* Linha 1.5: Coleta - Entrega — endereços usados pra cotar com fornecedores,
                  não fazem parte da rota (Origem/Destino) nem viram carga tributária/logística;
                  só aparecem no resumo copiado se estiverem preenchidos. */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Coleta</Label>
                  <Input
                    value={form.pickup_address}
                    onChange={(e) => setForm({ ...form, pickup_address: e.target.value })}
                    placeholder="Endereço de coleta (opcional)"
                    disabled={!canEditGeneral}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Entrega</Label>
                  <Input
                    value={form.delivery_address}
                    onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
                    placeholder="Endereço de entrega (opcional)"
                    disabled={!canEditGeneral}
                  />
                </div>
              </div>

              {/* Linha 2: Origem - Transbordo - Destino */}
              <div className={`grid grid-cols-2 ${showPort ? 'md:grid-cols-3' : ''} gap-4`}>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('shipments.origin')}</Label>
                  {showPort ? (
                    <PortSelect
                      value={form.origin}
                      onChange={(v) => setForm({ ...form, origin: v })}
                      disabled={!canEditGeneral}
                      placeholder={t('quotes.search_port')}
                    />
                  ) : (
                    <Input
                      value={form.origin}
                      onChange={(e) => setForm({ ...form, origin: e.target.value })}
                      placeholder="São Paulo, BR"
                      disabled={!canEditGeneral}
                    />
                  )}
                </div>
                {showPort && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Transbordo</Label>
                    <PortSelect
                      value={form.transshipment}
                      onChange={(v) => setForm({ ...form, transshipment: v })}
                      transportMode={form.transport_mode}
                      disabled={!canEditGeneral}
                      placeholder="Porto de transbordo (opcional)"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('shipments.destination')}</Label>
                  {showPort ? (
                    <PortSelect
                      value={form.destination}
                      onChange={(v) => setForm({ ...form, destination: v })}
                      transportMode={form.transport_mode}
                      disabled={!canEditGeneral}
                      placeholder={t('quotes.search_port')}
                    />
                  ) : (
                    <Input
                      value={form.destination}
                      onChange={(e) => setForm({ ...form, destination: e.target.value })}
                      placeholder="Curitiba, BR"
                      disabled={!canEditGeneral}
                    />
                  )}
                </div>
              </div>

              {/* Linha 3: Transit Time - Free Time - Armazenagem (LCL e FCL — regra do FCL a definir) */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 items-start">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('quotes.transit_time')}</Label>
                  <Input
                    type="number"
                    value={form.transit_time}
                    onChange={(e) => setForm({ ...form, transit_time: e.target.value })}
                    placeholder="0"
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    disabled={!canEditGeneral}
                  />
                </div>
                {form.transport_mode?.startsWith('ocean') && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('quotes.free_time')}</Label>
                    <Input
                      type="number"
                      value={form.free_time}
                      onChange={(e) => setForm({ ...form, free_time: e.target.value })}
                      placeholder="0"
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      disabled={!canEditGeneral}
                    />
                  </div>
                )}
              </div>

              {/* Linha 4: Observações - Condições de pagamento */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('quotes.notes')}</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder={t('quotes.notes_placeholder')}
                    rows={4}
                    disabled={!canEditGeneral}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Condições de pagamento</Label>
                  <Textarea
                    value={form.payment_terms}
                    onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    placeholder="Ex: 50% na chegada, saldo em 30 dias"
                    rows={4}
                    disabled={!canEditGeneral}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* Cargo Tab */}
        <TabsContent value="cargo">
          <Card className="glass">
            <CardContent className="pt-6 space-y-4" onBlur={() => handleAutoSaveBlur('cargo')}>
              {hasEstimateOverride && (
                <div className="rounded-md border border-primary/30 bg-primary/5 text-xs px-3 py-2 flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0 text-primary" />
                  <span>
                    Esta cotação tem uma Estimativa de custo preenchida: o <strong>peso total</strong> usado para calcular as taxas por kg vem da aba Estimativa, não daqui. Volume (m³) e containers continuam vindo desta aba.
                  </span>
                </div>
              )}
              {/* Carga física do embarque (totais). Itens/produtos ficam abaixo, só com peças e valor. */}
              <div className="rounded-lg border border-border/60 p-3 space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carga física do embarque (totais)</div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase text-muted-foreground">Pallets</Label>
                    <Input inputMode="numeric" placeholder="0" value={form.cargo_pallets} disabled={!canEditCargo}
                      onChange={(e) => setForm((f) => ({ ...f, cargo_pallets: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase text-muted-foreground">Caixas / volumes</Label>
                    <Input inputMode="numeric" placeholder="0" value={form.cargo_packages} disabled={!canEditCargo}
                      onChange={(e) => setForm((f) => ({ ...f, cargo_packages: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase text-muted-foreground">Tipo do volume</Label>
                    <Select value={form.cargo_package_type || '__none'} disabled={!canEditCargo}
                      onValueChange={(v) => setForm((f) => ({ ...f, cargo_package_type: v === '__none' ? '' : v }))}>
                      <SelectTrigger><SelectValue placeholder="Volume" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Volume (genérico)</SelectItem>
                        {PACKAGE_TYPES.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.singular.charAt(0).toUpperCase() + p.singular.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <ModeFields
                mode={form.transport_mode}
                items={cargoItems}
                onChange={setCargoItems}
                readOnly={!canEditCargo}
                saving={activeTab === 'cargo' && saveState === 'saving'}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Partners Tab */}
        <TabsContent value="partners" className="space-y-4">
          <Card className="glass">
            <CardContent className="pt-6 space-y-4">
              <QuotePartnersList
                quoteId={quoteId}
                companyId={profile?.company_id || ''}
                partners={partners}
                quotePartners={quotePartners}
                isFinalized={isFinalized}
                onChanged={() => {
                  queryClient.invalidateQueries({ queryKey: ['quote-partners', quoteId] });
                  // A aba Logística usa sua própria query (cache separado) pra
                  // montar as opções de Shipper/Armador/Notify/Consignee — sem
                  // invalidar aqui também, uma empresa recém-adicionada em
                  // Empresas não aparecia lá (nem disparava o auto-preenchimento
                  // do Armador) até a página ser recarregada.
                  queryClient.invalidateQueries({ queryKey: ['quote-partners-logistics', quoteId] });
                }}
              />
            </CardContent>
          </Card>

          {/* Shipper/Armador/Notify/Consignee do embarque — mudaram da aba
              Logística pra cá, já que as opções vêm das empresas cadastradas
              logo acima. */}
          {isShipmentMode && shipment && (
            <ShipmentPartnersCard
              shipment={shipment}
              quoteId={quoteId}
              onUpdate={() => queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] })}
            />
          )}
        </TabsContent>

        {/* Charges Tab */}
        <TabsContent value="charges">
          <div className="space-y-4">
            {isFinalized && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Processo finalizado — somente leitura. Para editar, reabra o processo em Admin &gt; Reabrir Processos.
              </div>
            )}
            {/* Armazenagem no destino, Seguro Internacional e os botões de
                ação da aba — tudo na mesma linha (quebra em telas menores). */}
            {(() => {
              const showStorageFee = form.transport_mode === 'ocean_lcl' || form.transport_mode === 'ocean_fcl';
              return (
                <div className="flex flex-col sm:flex-row items-start gap-3">
                  <div className="flex flex-wrap items-start gap-3 w-full sm:w-1/2">
                  {showStorageFee && (
                    <Card className="glass w-full sm:w-auto shrink-0">
                      <CardHeader className="h-9 py-0 flex flex-row items-center gap-2 space-y-0 flex-nowrap" onBlur={() => handleAutoSaveBlur('charges')}>
                        <div className="flex items-center gap-1 shrink-0">
                          <Label className="text-xs whitespace-nowrap leading-none">Armazenagem no destino (R$)</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-64 text-xs">
                              Não compõe o total da cotação. Gera automaticamente uma conta a receber com o rebate: em LCL, um percentual cadastrado no Co-loader do processo; em FCL, um valor fixo cadastrado no Terminal do processo.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          value={form.storage_fee_amount}
                          onChange={(e) => setForm({ ...form, storage_fee_amount: e.target.value, storage_fee_currency: 'BRL' })}
                          placeholder="0,00"
                          className="w-24 h-[18px] py-0 px-1.5 text-[11px] leading-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          disabled={!canEditGeneral}
                        />
                      </CardHeader>
                    </Card>
                  )}
                  {profile?.company_id && (
                    <div className="flex-1 min-w-[260px]">
                      <AutoInsuranceCard
                        quoteId={quoteId}
                        companyId={profile.company_id}
                        quote={quote as any}
                        quotePartners={quotePartners}
                        cargoItems={items}
                        readOnly={!canEditCharges}
                      />
                    </div>
                  )}
                </div>
                  <div className="flex items-center gap-2 flex-wrap w-full sm:w-1/2 sm:justify-end">
                    {canEditCharges && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          // Sugere o cliente da cotação/embarque como parceiro padrão apenas na Venda
                          const def = form.client_id || '';
                          setSellPartnerId((sp) => sp || def);
                          setAddChargeOpen(true);
                        }}
                        className="gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Adicionar Taxa
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground"
                      title="Como funciona a aba Taxas"
                      onClick={() => { setChargesOnboardingStep(0); setShowChargesOnboarding(true); }}
                    >
                      <HelpCircle className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPdfPreviewOpen(true)}
                      className="gap-2"
                    >
                      <FileText className="w-4 h-4" />
                      Pré-visualizar Proposta (PDF)
                    </Button>
                    {isShipmentMode && isFullAccess && !isFinalized && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => setShowRevertConfirm(true)}
                      >
                        <Undo2 className="w-4 h-4" />
                        {t('shipments.revert_to_quote')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Benchmarks - only in quote mode, not shipment mode */}
            {!shipmentId && profile && form.origin && form.destination && (
              <BenchmarkCard
                companyId={profile.company_id}
                clientId={form.client_id || null}
                transportMode={form.transport_mode}
                originPort={form.origin}
                destinationPort={form.destination}
                currentProfit={profit}
              />
            )}
            {/* Add charge dialog - only for authorized users */}
            {canEditCharges && (
              <Dialog open={addChargeOpen} onOpenChange={(o) => {
                setAddChargeOpen(o);
                if (o) {
                  // Ao abrir: pré-preenche apenas a Venda com o cliente da cotação
                  const def = form.client_id || '';
                  setSellPartnerId((sp) => sp || def);
                } else {
                  setChargeForm({ charge_catalog_id: '', description: '', charge_type: 'freight', leg: 'freight', amount: '', currency: 'USD', partner_id: '', billing_unit: 'fixed' });
                  setSellPartnerId('');
                  setSellBillingUnit('fixed');
                  setSellCurrency('USD');
                  setSellAmount('');
                  setChargeDescSearch('');
                }
              }}>
                <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
                  <div className="px-6 py-3 border-b bg-muted/30">
                    <DialogHeader className="space-y-0.5">
                      <DialogTitle className="flex items-center gap-2 text-base">
                        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary">
                          <Plus className="w-4 h-4" />
                        </span>
                        {t('quotes.add_charge')}
                      </DialogTitle>
                      <DialogDescription className="text-xs">
                        Escolha o trecho, descreva a taxa e preencha compra e/ou venda — cada lado com sua empresa, unidade, moeda e valor.
                      </DialogDescription>
                    </DialogHeader>
                  </div>

                  <div className="px-6 py-4 space-y-3.5 max-h-[85vh] overflow-y-auto">
                  {/* Trecho + Descrição na mesma linha */}
                  <div className="flex gap-3 items-end flex-wrap">
                    <div className="space-y-1.5 shrink-0">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Trecho</Label>
                      <div className="flex gap-1.5 flex-wrap">
                        {LEGS.map((leg) => (
                          <Button
                            key={leg}
                            type="button"
                            size="sm"
                            variant={chargeForm.leg === leg ? 'default' : 'outline'}
                            className="h-9 text-xs px-3 rounded-full"
                            onClick={() => setChargeForm({ ...chargeForm, leg })}
                          >
                            {legLabels[leg]}
                          </Button>
                        ))}
                      </div>
                    </div>

                  {/* Description with autocomplete */}
                  <div className="space-y-1.5 flex-1 min-w-[220px]">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('financial.description')}</Label>
                       <div className="relative">
                         <Input
                           ref={chargeDescInputRef}
                           value={chargeForm.description}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            const shouldSuggest = isCollectFeeName(val) && chargeForm.billing_unit !== 'percent';
                            setChargeForm({
                              ...chargeForm,
                              description: val,
                              ...(shouldSuggest ? { billing_unit: 'percent' as const } : {}),
                            });
                            setChargeDescSearch(val);
                            setShowChargeSuggestions(true);
                          }}
                          onFocus={() => setShowChargeSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowChargeSuggestions(false), 200)}
                          onKeyDown={handleChargeDescKeyDown}
                          placeholder="THC, BL FEE, OCEAN FREIGHT..."
                          className="h-10"
                          style={{ textTransform: 'uppercase' }}
                        />
                         {showChargeSuggestions && chargeDescOptionCount > 0 && (
                           // Renderizado como filho direto do wrapper relativo (não em portal para o body),
                           // pois o DismissableLayer do Radix Dialog fecha/perde o clique em elementos
                           // portalizados fora da árvore do DialogContent, impedindo a seleção do item.
                           <div
                             style={{
                               position: 'absolute',
                               top: '100%',
                               left: 0,
                               right: 0,
                               marginTop: 4,
                               zIndex: 9999,
                             }}
                             className="bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto"
                           >
                            {chargeFilteredSuggestions.map((s: any, idx: number) => (
                              <button
                                key={s.id}
                                className={cn(
                                  'w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors',
                                  idx === chargeDescHighlighted ? 'bg-accent' : 'hover:bg-accent'
                                )}
                                onMouseEnter={() => setChargeDescHighlighted(idx)}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  selectChargeSuggestion(s);
                                }}
                              >
                                <span>{s.name}</span>
                                <div className="flex gap-1">
                                  {((s.legs as string[]) || []).map((l: string) => (
                                    <span key={l} className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">{legLabels[l] || l}</span>
                                  ))}
                                </div>
                              </button>
                            ))}
                            {chargeDescShowAddOption && (
                              <button
                                className={cn(
                                  'w-full text-left px-3 py-2 text-sm text-primary font-medium border-t transition-colors',
                                  chargeDescHighlighted === chargeFilteredSuggestions.length ? 'bg-accent' : 'hover:bg-accent'
                                )}
                                onMouseEnter={() => setChargeDescHighlighted(chargeFilteredSuggestions.length)}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  addChargeDescToCatalog();
                                }}
                              >
                                <Plus className="w-3.5 h-3.5 inline mr-1" />
                                {t('quotes.add_to_catalog')}: "{chargeDescSearch.trim()}"
                              </button>
                            )}
                           </div>
                         )}
                      </div>
                  </div>
                  </div>

                  {/* Empresa(s), unidade de cobrança e valor — campos de Compra e Venda ficam
                      totalmente independentes quando bidirecional está ligado. */}
                  {(() => {
                    const partnerOptions = (
                      <>
                        {form.client_id && (() => {
                          const client = clients.find((c: any) => c.id === form.client_id);
                          return client ? <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem> : null;
                        })()}
                        {quotePartners
                          .filter((qp: any) => (qp.clients?.id || qp.client_id) !== form.client_id)
                          .map((qp: any) => {
                            const pId = qp.clients?.id || qp.client_id;
                            const pName = qp.clients?.name || '-';
                            const pCategory = qp.clients?.partner_category;
                            const label = pCategory ? `${pName} (${t(`registrations.category_${pCategory}`) !== `registrations.category_${pCategory}` ? t(`registrations.category_${pCategory}`) : pCategory})` : pName;
                            return (
                              <SelectItem key={pId} value={pId}>
                                {label}
                              </SelectItem>
                            );
                          })}
                      </>
                    );

                    const billingUnitOptions = (
                      <>
                        {BILLING_UNITS.map((u) => {
                          const mixed = cargoMetrics.totalContainers20 > 0 && cargoMetrics.totalContainers40 > 0;
                          // Força escolher 20' ou 40' quando a carga é mista
                          if (u === 'per_container' && mixed) {
                            return <SelectItem key={u} value={u} disabled>{t(`quotes.billing_${u}`)} (carga mista — escolha 20' ou 40')</SelectItem>;
                          }
                          if (u === 'per_container_20' && cargoMetrics.totalContainers20 === 0) return null;
                          if (u === 'per_container_40' && cargoMetrics.totalContainers40 === 0) return null;
                          return <SelectItem key={u} value={u}>{t(`quotes.billing_${u}`)}</SelectItem>;
                        })}
                      </>
                    );

                    const billingHint = (unit: string): string | null => {
                      if (unit === 'percent') return '% das taxas base (defina após criar)';
                      switch (unit) {
                        case 'per_cw': return `× ${cargoMetrics.totalChargeable.toFixed(2)} kg`;
                        case 'per_ton': return `× ${(cargoMetrics.totalWeight / 1000).toFixed(3)} ton`;
                        case 'per_cbm': return `× ${cargoMetrics.totalCbm.toFixed(4)} m³`;
                        case 'per_wm': {
                          const tons = cargoMetrics.totalWeight / 1000;
                          const cbm = cargoMetrics.totalCbm;
                          const winner = tons >= cbm ? `${tons.toFixed(3)} ton` : `${cbm.toFixed(4)} m³`;
                          return `× ${winner} (W/M)`;
                        }
                        case 'per_container': return `× ${cargoMetrics.totalContainers} cntr`;
                        case 'per_container_20': return `× ${cargoMetrics.totalContainers20} cntr 20'`;
                        case 'per_container_40': return `× ${cargoMetrics.totalContainers40} cntr 40'`;
                        case 'per_bl': return `× 1 BL`;
                        default: return null;
                      }
                    };

                    return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* Card Compra */}
                          <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Compra</p>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">Empresa</Label>
                              <Select value={chargeForm.partner_id} onValueChange={(v) => setChargeForm({ ...chargeForm, partner_id: v })}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={t('financial.select_partner')} /></SelectTrigger>
                                <SelectContent>{partnerOptions}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">Unidade de cobrança</Label>
                              <Select value={chargeForm.billing_unit} onValueChange={(v) => setChargeForm({ ...chargeForm, billing_unit: v })}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>{billingUnitOptions}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">Moeda / Valor</Label>
                              <div className="flex gap-1.5">
                                <Select value={chargeForm.currency} onValueChange={(v) => setChargeForm({ ...chargeForm, currency: v })} disabled={chargeForm.billing_unit === 'percent'}>
                                  <SelectTrigger className="w-20 h-9 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <Input
                                  type="number"
                                  placeholder={chargeForm.billing_unit === 'percent' ? '%' : '0.00'}
                                  value={chargeForm.amount}
                                  onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                                  className="flex-1 min-w-[100px] h-9 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                              {billingHint(chargeForm.billing_unit) && (
                                <p className="text-[11px] text-muted-foreground">{billingHint(chargeForm.billing_unit)}</p>
                              )}
                            </div>
                          </div>

                          {/* Card Venda */}
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Venda</p>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">Empresa</Label>
                              <Select value={sellPartnerId} onValueChange={setSellPartnerId}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={t('financial.select_partner')} /></SelectTrigger>
                                <SelectContent>{partnerOptions}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">Unidade de cobrança</Label>
                              <Select value={sellBillingUnit} onValueChange={setSellBillingUnit}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>{billingUnitOptions}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">Moeda / Valor</Label>
                              <div className="flex gap-1.5">
                                <Select value={sellCurrency} onValueChange={setSellCurrency} disabled={sellBillingUnit === 'percent'}>
                                  <SelectTrigger className="w-20 h-9 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <Input
                                  type="number"
                                  placeholder={sellBillingUnit === 'percent' ? '%' : '0.00'}
                                  value={sellAmount}
                                  onChange={(e) => setSellAmount(e.target.value)}
                                  className="flex-1 min-w-[100px] h-9 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                              {billingHint(sellBillingUnit) && (
                                <p className="text-[11px] text-muted-foreground">{billingHint(sellBillingUnit)}</p>
                              )}
                            </div>
                            {sellBillingUnit !== 'percent' && sellCurrency !== 'BRL' && (
                              <div className="space-y-1.5">
                                <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                                  Câmbio desta taxa (opcional)
                                  <Tooltip><TooltipTrigger asChild>
                                    <Info className="w-3 h-3 text-muted-foreground/70" />
                                  </TooltipTrigger><TooltipContent className="max-w-[240px] text-xs">
                                    Câmbio que este fornecedor/parceiro realmente cobrou nesta taxa. Se
                                    informado, a Estimativa/Numerário converte o valor em BRL desta linha
                                    por ele em vez da taxa fiscal única da estimativa. Deixe em branco pra
                                    usar a taxa fiscal (comportamento padrão).
                                  </TooltipContent></Tooltip>
                                </Label>
                                <Input
                                  type="number"
                                  step="0.0001"
                                  placeholder={`Taxa fiscal (padrão)`}
                                  value={sellExchangeRate}
                                  onChange={(e) => setSellExchangeRate(e.target.value)}
                                  className="h-9 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                    );
                  })()}
                  </div>
                <DialogFooter className="flex-wrap gap-2 sm:justify-between px-6 py-3 border-t bg-muted/20">
                  <Button variant="ghost" onClick={() => setAddChargeOpen(false)}>{t('common.cancel')}</Button>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={() => handleAddCharge({ keepOpen: true })}
                      disabled={isAddingCharge || !chargeForm.description.trim()}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Adicionar e criar outra
                    </Button>
                    <Button
                      onClick={() => handleAddCharge()}
                      disabled={isAddingCharge || !chargeForm.description.trim()}
                    >
                      Adicionar
                    </Button>
                  </div>
                </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {!canSeeFinancials && isShipmentMode && (
              <Card className="glass">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <p className="text-sm">Informações financeiras restritas ao vendedor do processo.</p>
                </CardContent>
              </Card>
            )}

            {/* Split View: Buy left, Sell right */}
            {canSeeFinancials && (() => {
              // Build combined partner list: client + quote partners
              const clientEntry = form.client_id ? clients.find((c: any) => c.id === form.client_id) : null;
              const qpEntries = quotePartners.map((qp: any) => ({ 
                id: qp.clients?.id || qp.client_id, 
                name: qp.clients?.name || '-', 
                type: qp.clients?.type,
                partner_category: qp.clients?.partner_category
              }));
              const combinedPartners = [
                ...(clientEntry ? [{ id: clientEntry.id, name: clientEntry.name, type: 'client' }] : []),
                ...qpEntries.filter((qp: any) => qp.id !== form.client_id),
              ];
              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChargeColumn
                    title={t('quotes.total_buy')}
                    charges={buyCharges}
                    amountKey="buy_amount"
                    totalByCurrency={buyByCurrency}
                    legLabels={legLabels}
                    legColors={legColors}
                    legBorderLeftColors={legBorderLeftColors}
                    onDelete={canEditCharges ? handleDeleteCharge : () => {}}
                    onUpdate={canEditCharges ? handleUpdateCharge : async () => {}}
                    onClone={(charge, amount, partnerId) => handleCloneCharge(charge, amount, 'sell', partnerId)}
                    colorClass="text-blue-600"
                    borderClass="border-red-500/20"
                    bgClass="!bg-red-50/60 dark:!bg-red-950/20"
                    cloneLabel={t('quotes.clone_to_sell')}
                    partners={combinedPartners}
                    defaultClonePartnerId={form.client_id || ''}
                    cargoMetrics={cargoMetrics}
                    readOnly={!canEditCharges}
                    showReconciliation={isShipmentMode && canSeeFinancials}
                    currentUserId={profile?.user_id}
                    onPercentClick={(id) => setPercentDialogChargeId(id)}
                    onSendDn={(id, name, amount, currency, chargeIds) => setSendDnPartner({ id, name, amount, currency, chargeIds })}
                    onReopenCharge={handleReopenChargeWithDn}
                  />
                  <ChargeColumn
                    title={t('quotes.total_sell')}
                    charges={sellCharges}
                    amountKey="sell_amount"
                    totalByCurrency={sellByCurrency}
                    legLabels={legLabels}
                    legColors={legColors}
                    legBorderLeftColors={legBorderLeftColors}
                    onDelete={canEditCharges ? handleDeleteCharge : () => {}}
                    onUpdate={canEditCharges ? handleUpdateCharge : async () => {}}
                    onClone={(charge, amount, partnerId) => handleCloneCharge(charge, amount, 'buy', partnerId)}
                    colorClass="text-emerald-600"
                    borderClass="border-emerald-500/20"
                    bgClass="!bg-emerald-50/60 dark:!bg-emerald-950/20"
                    cloneLabel={t('quotes.clone_to_buy')}
                    partners={combinedPartners}
                    cargoMetrics={cargoMetrics}
                    readOnly={!canEditCharges}
                    onPercentClick={(id) => setPercentDialogChargeId(id)}
                    onGenerateNd={(id, name, groupCharges) => setGenerateNdPartner({ id, name, charges: groupCharges })}
                    onReopenSellCharge={handleReopenSellChargeWithNd}
                  />
                </div>
              );
            })()}

            {/* Profit summary removido — informação já exibida no card de Lucro acima */}
          </div>
        </TabsContent>

        {/* Cost Estimate Tab */}
        {estimateEnabled && (
          <TabsContent value="estimate">
            <CostEstimateTab
              quoteId={quoteId}
              quote={quote}
              quoteItems={cargoItems}
              quotePartners={quotePartners}
              companyId={profile?.company_id}
              charges={charges as any}
              getBillingMultiplier={getChargeMultiplier}
              shipmentEtd={(shipment as any)?.etd}
              shipmentEta={(shipment as any)?.eta}
              isFinalized={isFinalized}
            />
          </TabsContent>
        )}

        {/* Prestação de Contas: só existe depois que o Numerário é aprovado. */}
        {estimateEnabled && accountability && (
          <TabsContent value="accountability">
            <AccountabilityTab
              quoteId={quoteId}
              quote={quote}
              companyId={profile?.company_id}
              isFinalized={isFinalized}
            />
          </TabsContent>
        )}

        {/* Documents tab - available in both modes. A DN de Fornecedor é criada
            anexando um arquivo com a categoria "DN Fornecedor" aqui mesmo (sem
            aba separada); a DN de Cliente é emitida por um botão nesta aba. */}
        <TabsContent value="documents">
          {isShipmentMode && shipment ? (
            <DocumentsTab
              shipmentId={shipmentId!}
              companyId={shipment.company_id}
              quoteId={quoteId}
              onGeneratePdf={() => setPdfPreviewOpen(true)}
              dnPartners={linkedPartnersForDn}
              dnClientId={(quote as any)?.client_id || null}
              isFinalized={isFinalized}
            />
          ) : profile ? (
            <DocumentsTab
              shipmentId={quoteId}
              companyId={profile.company_id}
              isQuoteMode
              onGeneratePdf={() => setPdfPreviewOpen(true)}
              dnPartners={linkedPartnersForDn}
              dnClientId={(quote as any)?.client_id || null}
            />
          ) : null}
        </TabsContent>

        {/* Shipment-specific tabs (only in shipment mode) */}
        {isShipmentMode && shipment && (
          <TabsContent value="logistics" className="space-y-4">
            <LogisticsTab
              shipment={shipment}
              quoteId={quoteId}
              onUpdate={() => queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] })}
              clientOptions={clients.map((c: any) => ({ id: c.id, name: c.name }))}
              onClientChange={requestClientChange}
              clientIdOverride={form.client_id}
            />

            {/* CARD 6 — Observações / Condições de pagamento (aba Geral
                mesclada aqui após virar embarque) */}
            <CollapsibleCard title="6. Observações & Condições de Pagamento">
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
                onBlur={() => handleAutoSaveBlur('logistics')}
              >
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('quotes.notes')}</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder={t('quotes.notes_placeholder')}
                    rows={4}
                    disabled={!canEditGeneral}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Condições de pagamento</Label>
                  <Textarea
                    value={form.payment_terms}
                    onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    placeholder="Ex: 50% na chegada, saldo em 30 dias"
                    rows={4}
                    disabled={!canEditGeneral}
                  />
                </div>
              </div>
            </CollapsibleCard>
          </TabsContent>
        )}
        {isShipmentMode && shipment && (
          <TabsContent value="events">
            <ShipmentEventsTab shipmentId={shipment.id} companyId={shipment.company_id} isFinalized={isFinalized} />
          </TabsContent>
        )}
        {isShipmentMode && shipment && (
          <TabsContent value="coleta">
            <OrdemColetaTab
              shipmentId={shipment.id}
              companyId={shipment.company_id}
              clientId={(quote as any)?.client_id || null}
              shipment={{
                reference_number: shipment.reference_number,
                container_number: (shipment as any).container_number ?? null,
                master_bl: (shipment as any).master_bl ?? null,
                house_bl: (shipment as any).house_bl ?? null,
                duimp_number: (shipment as any).duimp_number ?? null,
              }}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Geral e Resumo da Carga não usam mais esse botão — salvam sozinhas
          (auto-save) a cada alteração. Fica só como fallback pras demais abas
          de cotação (Taxas, Empresas etc.) que ainda dependem de salvar aqui. */}
      {!isShipmentMode && activeTab !== 'estimate' && activeTab !== 'documents' && activeTab !== 'cargo' && activeTab !== 'general' && (
        <FloatingSaveButton
          visible={hasChanges && form.status !== 'converted'}
          dirtyCount={dirtyCount}
          state={saveState}
          onSave={handleSave}
        />
      )}

      {/* Respiro no fim da página, pra não ficar por baixo do botão flutuante de Salvar */}
      <div className="h-20" />

      <QuotePdfPreviewDialog
        quoteId={quoteId}
        open={pdfPreviewOpen}
        onClose={() => setPdfPreviewOpen(false)}
      />

      {sendDnPartner && (
        <SendSupplierDnDialog
          open={!!sendDnPartner}
          onOpenChange={(o) => { if (!o) setSendDnPartner(null); }}
          quoteId={quoteId}
          companyId={profile?.company_id || ''}
          partnerId={sendDnPartner.id}
          partnerName={sendDnPartner.name}
          suggestedAmount={sendDnPartner.amount}
          suggestedCurrency={sendDnPartner.currency}
          chargeIds={sendDnPartner.chargeIds}
          onSent={() => setSendDnPartner(null)}
        />
      )}

      {generateNdPartner && (
        <GenerateClientNdDialog
          open={!!generateNdPartner}
          onClose={() => setGenerateNdPartner(null)}
          quoteId={quoteId}
          companyId={profile?.company_id || ''}
          clientId={generateNdPartner.id}
          charges={generateNdPartner.charges}
          onCreated={() => setGenerateNdPartner(null)}
        />
      )}

      <HistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        quoteId={quoteId}
        shipmentId={isShipmentMode ? shipmentId : null}
      />

      <AlertDialog open={!!pendingClientChange} onOpenChange={(o) => { if (!o) { setPendingClientChange(null); setClientChangeWarnings([]); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar o cliente deste processo?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Este processo já tem lançamentos no nome do cliente atual: {clientChangeWarnings.join(', ')}.</p>
                <p>Trocar o cliente <strong>não atualiza</strong> esses lançamentos automaticamente — eles continuarão vinculados ao cliente antigo. Deseja continuar mesmo assim?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingClientChange(null); setClientChangeWarnings([]); }}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingClientChange) handleChangeClient(pendingClientChange);
              setPendingClientChange(null);
              setClientChangeWarnings([]);
            }}>Trocar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={backConfirmOpen} onOpenChange={setBackConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem alterações não salvas nesta cotação (incluindo containers/carga). Se sair agora, elas serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setBackConfirmOpen(false);
                await handleSave();
                onBack();
              }}
            >
              Salvar e sair
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                setBackConfirmOpen(false);
                onBack();
              }}
            >
              Descartar e sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PercentBaseDialog
        quoteId={quoteId}
        chargeId={percentDialogChargeId}
        charges={charges}
        usdBrl={usdBrl}
        eurBrl={eurBrl}
        getChargeMultiplier={getChargeMultiplier}
        onClose={() => setPercentDialogChargeId(null)}
      />
    </div>
  );
}

/* ── Charge Column Sub-component ── */
interface ChargeColumnProps {
  title: string;
  charges: any[];
  amountKey: 'buy_amount' | 'sell_amount';
  totalByCurrency: Record<string, number>;
  legLabels: Record<string, string>;
  legColors: Record<string, string>;
  legBorderLeftColors: Record<string, string>;
  onDelete: (id: string) => void;
  onClone: (charge: any, newAmount: number, partnerId?: string) => Promise<void>;
  onUpdate: (id: string, updates: Record<string, any>) => Promise<void>;
  colorClass: string;
  borderClass: string;
  /** Fundo levemente colorido do card inteiro (ex.: vermelho p/ Compra,
   *  verde p/ Venda) — substitui o título "Total Compra"/"Total Venda". */
  bgClass?: string;
  cloneLabel: string;
  partners: any[];
  defaultClonePartnerId?: string;
  cargoMetrics?: { totalWeight: number; totalCbm: number; totalChargeable: number; totalContainers: number; totalContainers20: number; totalContainers40: number };
  readOnly?: boolean;
  showReconciliation?: boolean;
  currentUserId?: string;
  onPercentClick?: (chargeId: string) => void;
  /** Botão "Enviar DN" no cabeçalho de cada fornecedor (só faz sentido do
   *  lado Compra) — habilitado só quando todas as taxas do grupo já foram
   *  conferidas (buy_actual_confirmed_at preenchido). */
  onSendDn?: (partnerId: string, partnerName: string, suggestedAmount: number, suggestedCurrency: string, chargeIds: string[]) => void;
  /** Botão "Gerar ND" no cabeçalho de cada empresa (só faz sentido do lado
   *  Venda) — abre o mesmo formulário de emissão de DN ao Cliente, já
   *  escopado às taxas daquele grupo. */
  onGenerateNd?: (partnerId: string, partnerName: string, groupCharges: any[]) => void;
  /** "Reabrir" uma taxa já enviada numa DN (ainda não paga) — exclui a DN
   *  inteira e libera as taxas presas nela pra edição de novo. */
  onReopenCharge?: (charge: any, partnerName: string) => Promise<{ ok: boolean; error?: string }>;
  /** Equivalente do lado venda: "Reabrir" uma taxa já enviada numa ND ao
   *  cliente — exclui a ND e libera a taxa pra edição de novo. */
  onReopenSellCharge?: (charge: any, partnerName: string) => Promise<{ ok: boolean; error?: string }>;
}

function ChargeColumn({ title, charges, amountKey, totalByCurrency, legLabels, legColors, legBorderLeftColors, onDelete, onClone, onUpdate, colorClass, borderClass, bgClass, cloneLabel, partners, defaultClonePartnerId, cargoMetrics, readOnly, showReconciliation, currentUserId, onPercentClick, onSendDn, onGenerateNd, onReopenCharge, onReopenSellCharge }: ChargeColumnProps) {
  const { t } = useLanguage();
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [cloneAmount, setCloneAmount] = useState('');
  const [clonePartnerId, setClonePartnerId] = useState(defaultClonePartnerId || '');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editLeg, setEditLeg] = useState('');

  function getBillingRef(unit: string): string {
    if (!cargoMetrics) return '';
    switch (unit) {
      case 'per_cw': return `${cargoMetrics.totalChargeable.toFixed(2)} kg`;
      case 'per_ton': return `${(cargoMetrics.totalWeight / 1000).toFixed(3)} ton`;
      case 'per_cbm': return `${cargoMetrics.totalCbm.toFixed(4)} m³`;
      case 'per_wm': {
        const tons = cargoMetrics.totalWeight / 1000;
        const cbm = cargoMetrics.totalCbm;
        return tons >= cbm ? `${tons.toFixed(3)} ton (W/M)` : `${cbm.toFixed(4)} m³ (W/M)`;
      }
      case 'per_container': return `${cargoMetrics.totalContainers} cntr`;
      case 'per_container_20': return `${cargoMetrics.totalContainers20} cntr 20'`;
      case 'per_container_40': return `${cargoMetrics.totalContainers40} cntr 40'`;
      case 'per_bl': return '1 BL';
      default: return '';
    }
  }

  function getBillingMultiplier(unit: string): number {
    if (!cargoMetrics) return 1;
    switch (unit) {
      case 'per_cw': return cargoMetrics.totalChargeable;
      case 'per_ton': return cargoMetrics.totalWeight / 1000;
      case 'per_cbm': return cargoMetrics.totalCbm;
      case 'per_wm': return Math.max(cargoMetrics.totalWeight / 1000, cargoMetrics.totalCbm);
      case 'per_container': return cargoMetrics.totalContainers;
      case 'per_container_20': return cargoMetrics.totalContainers20;
      case 'per_container_40': return cargoMetrics.totalContainers40;
      case 'per_bl': return 1;
      default: return 1;
    }
  }

  async function handleCloneConfirm(charge: any) {
    const amount = parseFloat(cloneAmount);
    if (!amount || amount <= 0) return;
    setCloneLoading(true);
    await onClone(charge, amount, clonePartnerId || undefined);
    setCloneLoading(false);
    setCloningId(null);
    setCloneAmount('');
    setClonePartnerId('');
  }

  // Uma empresa pode ter taxas em mais de um trecho (origem/frete/destino) —
  // antes cada trecho virava um grupo/cabeçalho separado, repetindo a mesma
  // empresa várias vezes. Agora agrupa só por empresa (uma linha de cabeçalho
  // cada), e cada taxa continua mostrando seu próprio trecho na coluna
  // "Trecho" — então "Enviar DN"/"Gerar ND" já juntam todos os trechos da
  // empresa de uma vez, sem precisar aparecer mais de uma vez.
  const groupedByPartner = useMemo(() => {
    const partnerMap = new Map<string, { partnerId: string; partnerName: string; partnerCategory: string; charges: any[] }>();
    for (const leg of LEGS) {
      for (const c of charges.filter((c: any) => c.leg === leg)) {
        const pid = c.partner_id || '__none__';
        const pname = c.clients?.name || t('financial.no_partner');
        const pcategory = c.clients?.partner_category || '';
        if (!partnerMap.has(pid)) {
          partnerMap.set(pid, { partnerId: pid, partnerName: pname, partnerCategory: pcategory, charges: [] });
        }
        partnerMap.get(pid)!.charges.push(c);
      }
    }
    return Array.from(partnerMap.values());
  }, [charges, t]);

  const totalsByLeg = useMemo(() => {
    const result: Record<string, Record<string, number>> = { origin: {}, freight: {}, destination: {} };
    for (const c of charges) {
      const leg = (c.leg as string) || 'freight';
      if (!result[leg]) result[leg] = {};
      const isPct = c.billing_unit === 'percent';
      const cur = isPct ? 'USD' : (c.currency || 'USD');
      let val: number;
      if (isPct) {
        val = Number(amountKey === 'buy_amount' ? c.computed_buy_amount : c.computed_sell_amount) || 0;
      } else {
        const mult = c.billing_unit && c.billing_unit !== 'fixed' ? getBillingMultiplier(c.billing_unit) : 1;
        val = (c[amountKey] || 0) * mult;
      }
      result[leg][cur] = (result[leg][cur] || 0) + val;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charges, amountKey, cargoMetrics]);

  return (
    <Card className={`glass border ${borderClass} ${bgClass || ''}`}>
      <CardContent className="p-0 pt-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 py-1.5 text-xs">{t('financial.description')}</TableHead>
              <TableHead className="h-8 py-1.5 text-xs">{t('quotes.leg')}</TableHead>
              {amountKey === 'sell_amount' && (
                <TableHead className="h-8 py-1.5 text-xs w-24 text-right">Câmbio</TableHead>
              )}
              <TableHead className="h-8 py-1.5 text-xs text-right">{t('financial.amount')}</TableHead>
              <TableHead className="h-8 py-1.5 text-xs w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.length === 0 ? (
              <TableRow>
                <TableCell colSpan={amountKey === 'sell_amount' ? 5 : 4} className="text-center py-6 text-muted-foreground text-sm">{t('common.no_data')}</TableCell>
              </TableRow>
            ) : (
              groupedByPartner.map((group) => {
                return (
                  <React.Fragment key={group.partnerId}>
                        {/* Partner sub-header — uma linha só por empresa, mesmo que tenha
                            taxas em mais de um trecho (cada taxa mostra seu trecho embaixo). */}
                        <TableRow className="bg-muted/30 border-t border-l-4 border-l-muted-foreground/20">
                          <TableCell colSpan={amountKey === 'sell_amount' ? 5 : 4} className="py-1.5 px-4">
                            <div className="flex items-center justify-between gap-2.5 flex-wrap">
                              <div className="flex items-center gap-2.5">
                                <div className="flex items-center gap-1.5">
                                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span className="text-sm font-bold text-foreground">
                                    {group.partnerName}
                                  </span>
                                  {group.partnerCategory && (
                                    <Badge variant="secondary" className="text-[10px] h-5 bg-primary/10 text-primary border-primary/20">
                                      {t(`registrations.category_${group.partnerCategory}`) !== `registrations.category_${group.partnerCategory}`
                                        ? t(`registrations.category_${group.partnerCategory}`)
                                        : group.partnerCategory}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              {onSendDn && amountKey === 'buy_amount' && group.partnerId && (() => {
                                // Taxas já enviadas numa DN anterior (paga ou não) não entram de
                                // novo — se o fornecedor mandar uma cobrança nova, ela chega como
                                // taxa nova (sem sent_in_debit_note_id) e é essa que conta aqui.
                                const pendingCharges = group.charges.filter((c: any) => !c.sent_in_debit_note_id);
                                const hasPending = pendingCharges.length > 0;
                                const allConfirmed = pendingCharges.every((c: any) => !!c.buy_actual_confirmed_at);
                                const enabled = hasPending && allConfirmed;
                                return (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1.5 text-xs"
                                    disabled={!enabled}
                                    title={
                                      !hasPending
                                        ? 'Todas as taxas deste fornecedor já foram enviadas em uma DN'
                                        : allConfirmed
                                          ? 'Enviar Debit Note deste fornecedor'
                                          : 'Confira todas as taxas deste fornecedor antes de enviar a DN'
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Soma o valor já conferido (buy_amount_actual) das taxas
                                      // ainda não enviadas, na moeda predominante entre elas.
                                      const currency = pendingCharges[0]?.currency || 'USD';
                                      const amount = pendingCharges.reduce((s: number, c: any) => {
                                        if ((c.currency || 'USD') !== currency) return s;
                                        if (c.billing_unit === 'percent') return s + (Number(c.computed_buy_amount) || 0);
                                        const unit = Number(c.buy_amount_actual ?? c.buy_amount) || 0;
                                        const mult = c.billing_unit && c.billing_unit !== 'fixed' ? getBillingMultiplier(c.billing_unit) : 1;
                                        return s + unit * mult;
                                      }, 0);
                                      const ids = pendingCharges.map((c: any) => c.id).filter(Boolean);
                                      onSendDn(group.partnerId, group.partnerName, amount, currency, ids);
                                    }}
                                  >
                                    <Send className="w-3.5 h-3.5" /> Enviar DN
                                  </Button>
                                );
                              })()}
                              {onGenerateNd && amountKey === 'sell_amount' && group.partnerId && (() => {
                                // Taxas já enviadas numa ND anterior ficam de fora — reentram só
                                // se a ND antiga for reaberta/excluída primeiro.
                                const pending = group.charges.filter((c: any) => !c.sent_in_debit_note_id);
                                return (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1.5 text-xs"
                                    disabled={pending.length === 0}
                                    title={pending.length === 0 ? 'Todas as taxas desta empresa já foram enviadas em uma ND' : 'Gerar Nota de Débito para esta empresa (todas as taxas, todos os trechos)'}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onGenerateNd(group.partnerId, group.partnerName, pending);
                                    }}
                                  >
                                    <Send className="w-3.5 h-3.5" /> Gerar ND
                                  </Button>
                                );
                              })()}
                            </div>
                          </TableCell>
                        </TableRow>
                        {group.charges.map((c: any) => {
                          // Do lado venda, gerar a ND já trava o valor cobrado do cliente — não
                          // tem uma etapa de "conferência" separada como o lado compra. Só dá pra
                          // editar de novo reabrindo (o que exclui a ND vinculada).
                          const lockedForEdit = amountKey === 'sell_amount' && !!c.sent_in_debit_note_id;
                          return (
                          <React.Fragment key={c.id}>
                            <TableRow
                              className={`${readOnly || lockedForEdit ? '' : 'cursor-pointer'} hover:bg-muted/40 transition-colors`}
                              onClick={() => {
                                if (readOnly || lockedForEdit) return;
                                if (c.billing_unit === 'percent' && onPercentClick) {
                                  onPercentClick(c.id);
                                  return;
                                }
                                if (editingId === c.id) return;
                                setEditingId(c.id);
                                setEditAmount(String(c[amountKey] || 0));
                                setEditLeg(c.leg || 'freight');
                              }}
                            >
                              <TableCell className="font-medium text-sm pl-8 py-2">
                                <div>
                                  {c.description}
                                  <span className={`ml-1.5 text-[10px] border rounded px-1 py-0.5 ${c.billing_unit === 'percent' ? 'text-primary border-primary/40 bg-primary/10' : 'text-muted-foreground'}`}>
                                    {t(`quotes.billing_${c.billing_unit || 'fixed'}`)}
                                  </span>
                                  {c.billing_unit === 'percent' && (!c.percent_base_charge_ids || c.percent_base_charge_ids.length === 0) && (
                                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                      Selecionar taxas base
                                    </span>
                                  )}
                                  {/* Só importa pro trecho "destino" — é o que compõe a base do
                                      ICMS na Estimativa (junto com Siscomex/AFRMM). Clique
                                      alterna: Automático (decide pela palavra-chave da descrição)
                                      → Sim → Não → Automático de novo. */}
                                  {c.leg === 'destination' && !readOnly && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const next = c.aduaneira === true ? false : c.aduaneira === false ? null : true;
                                        onUpdate(c.id, { aduaneira: next });
                                      }}
                                      title="Define se esta taxa entra na base de cálculo do ICMS (Estimativa de Custo). Clique para alternar: Automático → Sim → Não."
                                      className={`ml-1.5 text-[10px] border rounded px-1 py-0.5 ${
                                        c.aduaneira === true
                                          ? 'text-blue-600 border-blue-400/50 bg-blue-500/10'
                                          : c.aduaneira === false
                                            ? 'text-muted-foreground border-border'
                                            : 'text-muted-foreground border-dashed border-border'
                                      }`}
                                    >
                                      Aduaneira: {c.aduaneira === true ? 'Sim' : c.aduaneira === false ? 'Não' : 'Auto'}
                                    </button>
                                  )}
                                  {/* Prepaid = já pago na origem, não entra no total que o cliente
                                      precisa depositar via Numerário (mas continua aparecendo na
                                      Estimativa e no Numerário, só de fora do total a cobrar).
                                      Collect (padrão) = cobrado do cliente no destino. */}
                                  {!readOnly && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const next = c.payment_term === 'prepaid' ? 'collect' : 'prepaid';
                                        onUpdate(c.id, { payment_term: next });
                                      }}
                                      title="Prepaid = já pago na origem, não entra no total do Numerário (mas continua aparecendo na Estimativa/Numerário). Collect = cobrado do cliente no destino. Clique para alternar."
                                      className={`ml-1.5 text-[10px] border rounded px-1 py-0.5 ${
                                        c.payment_term === 'prepaid'
                                          ? 'text-amber-600 border-amber-400/50 bg-amber-500/10'
                                          : 'text-muted-foreground border-border'
                                      }`}
                                    >
                                      {c.payment_term === 'prepaid' ? 'Prepaid' : 'Collect'}
                                    </button>
                                  )}
                                </div>
                                {c.billing_unit === 'percent' ? (
                                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                                    {(Number(c[amountKey]) || 0).toFixed(2)}% × base = USD {(Number(amountKey === 'buy_amount' ? c.computed_buy_amount : c.computed_sell_amount) || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                ) : c.billing_unit && c.billing_unit !== 'fixed' && getBillingRef(c.billing_unit) && (() => {
                                  const unitPrice = editingId === c.id ? (parseFloat(editAmount) || 0) : (c[amountKey] || 0);
                                  const mult = getBillingMultiplier(c.billing_unit);
                                  const total = unitPrice * mult;
                                  return (
                                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                                      {getBillingRef(c.billing_unit)} × {c.currency || 'USD'} {unitPrice.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = {c.currency || 'USD'} {total.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                  );
                                })()}
                              </TableCell>
                              <TableCell className="py-2">
                                {editingId === c.id ? (
                                  <div className="flex gap-1">
                                    {(['origin', 'freight', 'destination'] as const).map((leg) => (
                                      <button
                                        key={leg}
                                        className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${editLeg === leg ? legColors[leg] : 'text-muted-foreground'}`}
                                        onMouseDown={(e) => { e.preventDefault(); setEditLeg(leg); }}
                                      >
                                        {legLabels[leg]}
                                      </button>
                                    ))}
                                  </div>
                                ) : (
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${legColors[c.leg] || ''}`}>
                                    {legLabels[c.leg] || c.leg}
                                  </span>
                                )}
                              </TableCell>
                              {amountKey === 'sell_amount' && (
                                <TableCell className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                  {c.billing_unit !== 'percent' && (c.currency || 'USD') !== 'BRL' ? (
                                    <Input
                                      key={`rate-${c.id}-${c.exchange_rate ?? ''}`}
                                      type="number"
                                      step="0.0001"
                                      placeholder="taxa fiscal"
                                      defaultValue={c.exchange_rate ?? ''}
                                      disabled={readOnly || lockedForEdit}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                                      }}
                                      onBlur={(e) => {
                                        const raw = e.target.value.trim();
                                        const val = raw === '' ? null : (parseFloat(raw) || null);
                                        if (val !== (c.exchange_rate ?? null)) {
                                          onUpdate(c.id, { exchange_rate: val });
                                        }
                                      }}
                                      className="h-7 w-20 text-right font-mono text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              <TableCell className="text-right font-mono text-sm py-2" onClick={(e) => e.stopPropagation()}>
                                {editingId === c.id ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-xs text-muted-foreground">{c.currency || 'USD'}</span>
                                    <Input
                                      type="number"
                                      value={editAmount}
                                      onChange={(e) => setEditAmount(e.target.value)}
                                      className="h-7 w-28 text-right font-mono text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          const val = parseFloat(editAmount) || 0;
                                          onUpdate(c.id, { [amountKey]: val, leg: editLeg });
                                          setEditingId(null);
                                        }
                                        if (e.key === 'Escape') setEditingId(null);
                                      }}
                                      onBlur={() => {
                                        const val = parseFloat(editAmount) || 0;
                                        if (val !== (c[amountKey] || 0) || editLeg !== c.leg) {
                                          onUpdate(c.id, { [amountKey]: val, leg: editLeg });
                                        }
                                        setEditingId(null);
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <>
                                    {c.billing_unit === 'percent' ? (
                                      <>
                                        <span className="text-xs text-muted-foreground mr-1">USD</span>
                                        {(Number(amountKey === 'buy_amount' ? c.computed_buy_amount : c.computed_sell_amount) || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </>
                                    ) : c.billing_unit && c.billing_unit !== 'fixed' ? (
                                      <>
                                        <span className="text-xs text-muted-foreground mr-1">{c.currency || 'USD'}</span>
                                        {((c[amountKey] || 0) * getBillingMultiplier(c.billing_unit)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-xs text-muted-foreground mr-1">{c.currency || 'USD'}</span>
                                        {(c[amountKey] || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </>
                                    )}
                                  </>
                                )}
                                {lockedForEdit && (
                                  <Badge variant="outline" className="ml-1.5 text-[9px] h-4 px-1 bg-primary/10 text-primary border-primary/30">
                                    ND
                                  </Badge>
                                )}
                              </TableCell>
                              {!readOnly && (
                              <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title={cloneLabel}
                                    onClick={() => {
                                      setCloningId(cloningId === c.id ? null : c.id);
                                      setCloneAmount(String(c[amountKey] || 0));
                                      setClonePartnerId(defaultClonePartnerId || '');
                                    }}
                                  >
                                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                                  </Button>
                                  {lockedForEdit && onReopenSellCharge ? (
                                    <ReopenNdButton charge={c} partnerName={group.partnerName} onReopenSellCharge={onReopenSellCharge} />
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      disabled={!!c.sent_in_debit_note_id}
                                      title={c.sent_in_debit_note_id ? 'Taxa já enviada em uma DN — não pode ser excluída' : undefined}
                                      onClick={() => onDelete(c.id)}
                                    >
                                      <Trash2 className={`w-3.5 h-3.5 ${c.sent_in_debit_note_id ? 'text-muted-foreground' : 'text-destructive'}`} />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                              )}
                            </TableRow>
                            {showReconciliation && amountKey === 'buy_amount' && (
                              <ReconciliationRow
                                charge={c}
                                cargoMetrics={cargoMetrics}
                                onUpdate={onUpdate}
                                currentUserId={currentUserId}
                                partnerName={group.partnerName}
                                onReopenCharge={onReopenCharge}
                              />
                            )}
                            {cloningId === c.id && (
                              <TableRow className="bg-muted/20">
                                <TableCell colSpan={amountKey === 'sell_amount' ? 5 : 4}>
                                  <div className="flex items-center gap-2 py-1 flex-wrap">
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">{cloneLabel}:</span>
                                    <Select value={clonePartnerId} onValueChange={setClonePartnerId}>
                                      <SelectTrigger className="h-8 w-44 text-xs">
                                        <SelectValue placeholder={t('financial.select_partner')} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {partners.map((p: any) => {
                                          const categoryLabel = p.partner_category ? ` (${t(`registrations.category_${p.partner_category}`) !== `registrations.category_${p.partner_category}` ? t(`registrations.category_${p.partner_category}`) : p.partner_category})` : '';
                                          return (
                                            <SelectItem key={p.id} value={p.id}>
                                              {p.name}{categoryLabel}
                                            </SelectItem>
                                          );
                                        })}
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      type="number"
                                      placeholder="0.00"
                                      value={cloneAmount}
                                      onChange={(e) => setCloneAmount(e.target.value)}
                                      className="h-8 w-32 font-mono text-sm"
                                      autoFocus
                                      onKeyDown={(e) => { if (e.key === 'Enter') handleCloneConfirm(c); if (e.key === 'Escape') setCloningId(null); }}
                                    />
                                    {c.billing_unit && c.billing_unit !== 'fixed' && getBillingRef(c.billing_unit) && (() => {
                                      const unitPrice = parseFloat(cloneAmount) || 0;
                                      const mult = getBillingMultiplier(c.billing_unit);
                                      const total = unitPrice * mult;
                                      return (
                                        <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                                          {getBillingRef(c.billing_unit)} × {c.currency || 'USD'} {unitPrice.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = <strong>{c.currency || 'USD'} {total.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                                        </span>
                                      );
                                    })()}
                                    <Button size="sm" className="h-8" disabled={cloneLoading} onClick={() => handleCloneConfirm(c)}>
                                      {cloneLoading ? '...' : t('common.create')}
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setCloningId(null)}>
                                      {t('common.cancel')}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                          );
                        })}
                  </React.Fragment>
                );
              })
            )}
            {charges.length > 0 && (
              <>
                {LEGS.map((leg) => {
                  const entries = Object.entries(totalsByLeg[leg] || {});
                  if (entries.length === 0) return null;
                  return (
                    <TableRow key={`subtotal-${leg}`} className={`bg-muted/10 border-l-4 ${legBorderLeftColors[leg] || ''}`}>
                      <TableCell colSpan={2} className="text-xs font-medium pl-4">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${legColors[leg] || ''}`}>
                          {legLabels[leg] || leg}
                        </span>
                        <span className="ml-2 text-muted-foreground">{t('financial.subtotal') || 'Subtotal'}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {entries.map(([cur, val]) => (
                          <span key={cur} className="block">{cur} {val.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        ))}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  );
                })}
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell colSpan={2}>{t('financial.total')}</TableCell>
                <TableCell className={`text-right font-mono ${colorClass}`}>
                  {Object.entries(totalByCurrency).map(([cur, val]) => (
                    <span key={cur} className="block">{cur} {val.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  ))}
                </TableCell>
                <TableCell />
              </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ── Quote Partners List ── */
interface QuotePartnersListProps {
  quoteId: string;
  companyId: string;
  partners: any[];
  quotePartners: any[];
  onChanged: () => void;
  /** Processo Finalizado — trava adicionar/remover empresas vinculadas. */
  isFinalized?: boolean;
}

function QuotePartnersList({ quoteId, companyId, partners, quotePartners, onChanged, isFinalized }: QuotePartnersListProps) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const locked = !!isFinalized;
  const [searchText, setSearchText] = useState('');
  const [adding, setAdding] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const addedClientIds = new Set(quotePartners.map((qp: any) => qp.clients?.id || qp.client_id));
  const availablePartners = partners.filter((p: any) => !addedClientIds.has(p.id));

  // Só busca depois que o usuário digitar pelo menos 3 letras, ou pelo menos
  // 3 dígitos (caso esteja digitando um CNPJ) — não abre lista ao simplesmente
  // clicar no campo.
  const query = searchText.trim();
  const queryDigits = query.replace(/\D/g, '');
  const searchReady = query.length >= 3 || queryDigits.length >= 3;
  const filteredPartners = searchReady
    ? availablePartners.filter((p: any) => {
        const nameMatch = p.name.toLowerCase().includes(query.toLowerCase());
        const taxIdMatch = queryDigits.length >= 3 && p.tax_id && p.tax_id.replace(/\D/g, '').includes(queryDigits);
        return nameMatch || taxIdMatch;
      })
    : [];
  const matchedPartner = availablePartners.find(
    (p: any) => p.name.trim().toLowerCase() === query.toLowerCase()
  );

  async function handleAdd(partnerId: string) {
    if (!partnerId || !companyId) return;
    if (locked) { toast.error('Processo finalizado — não é possível adicionar empresas.'); return; }
    setAdding(true);
    try {
      const { error } = await supabase.from('quote_partners' as any).insert({
        quote_id: quoteId,
        client_id: partnerId,
        company_id: companyId,
      });
      if (error) throw error;
      const partnerName = partners.find((p: any) => p.id === partnerId)?.name || partnerId;
      await logAuditEvent({
        quoteId,
        companyId,
        userId: profile?.user_id,
        field_name: 'partner',
        old_value: null,
        new_value: partnerName,
      });
      setSearchText('');
      setShowSuggestions(false);
      onChanged();
      toast.success(t('quotes.partner_added'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  function handleAddClick() {
    if (matchedPartner) {
      handleAdd(matchedPartner.id);
    } else if (filteredPartners.length === 1) {
      handleAdd(filteredPartners[0].id);
    } else {
      toast.error('Digite o nome exato ou selecione uma empresa na lista.');
    }
  }

  async function handleRemove(id: string) {
    if (locked) { toast.error('Processo finalizado — não é possível remover empresas.'); return; }
    try {
      const removedPartner = quotePartners.find((qp: any) => qp.id === id);
      const { error } = await supabase.from('quote_partners' as any).delete().eq('id', id);
      if (error) throw error;
      await logAuditEvent({
        quoteId,
        companyId,
        userId: profile?.user_id,
        field_name: 'partner',
        old_value: removedPartner?.clients?.name || null,
        new_value: null,
      });
      onChanged();
      toast.success(t('quotes.partner_removed'));
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  return (
    <fieldset disabled={locked} className="contents">
    <div className="space-y-4">
      {locked && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Processo finalizado — somente leitura. Para editar, reabra o processo em Admin &gt; Reabrir Processos.
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border bg-muted/20 px-3 py-2">
        <div className="relative flex-1 min-w-[180px]">
          <Input
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddClick();
              }
            }}
            placeholder="Digite ao menos 3 letras ou o CNPJ..."
            className="h-9 bg-background"
          />
          {showSuggestions && searchReady && filteredPartners.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
              {filteredPartners.slice(0, 10).map((p: any) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center justify-between"
                  onMouseDown={async (e) => {
                    e.preventDefault();
                    await handleAdd(p.id);
                  }}
                  disabled={adding}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{p.name}</span>
                    {p.tax_id && <span className="text-xs text-muted-foreground shrink-0">{p.tax_id}</span>}
                  </div>
                  {p.partner_category ? (
                    <Badge variant="secondary" className="text-[10px] h-5 bg-primary/10 text-primary border-primary/20 shrink-0">
                      {t(`registrations.category_${p.partner_category}`) !== `registrations.category_${p.partner_category}`
                        ? t(`registrations.category_${p.partner_category}`)
                        : p.partner_category}
                    </Badge>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {showSuggestions && searchReady && filteredPartners.length === 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Nenhuma empresa encontrada. Cadastre em <strong>Cadastros</strong> primeiro.
              </p>
            </div>
          )}
        </div>
      </div>

      {quotePartners.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">{t('quotes.no_partners')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('shipments.client')}</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotePartners.map((qp: any) => (
              <TableRow key={qp.id}>
                <TableCell className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{qp.clients?.name || '-'}</span>
                  {qp.clients?.partner_category ? (
                    <Badge variant="secondary" className="text-[10px] h-5 bg-primary/10 text-primary border-primary/20">
                      {t(`registrations.category_${qp.clients.partner_category}`) !== `registrations.category_${qp.clients.partner_category}` 
                        ? t(`registrations.category_${qp.clients.partner_category}`) 
                        : qp.clients.partner_category}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemove(qp.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
    </fieldset>
  );
}

/* ── Botão "Reabrir" de uma taxa de venda já enviada numa ND ao cliente ── */
function ReopenNdButton({ charge, partnerName, onReopenSellCharge }: {
  charge: any;
  partnerName: string;
  onReopenSellCharge: (charge: any, partnerName: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (loading) return;
    setLoading(true);
    const result = await onReopenSellCharge(charge, partnerName);
    setLoading(false);
    if (result.ok) setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Reabrir (exclui a ND vinculada)"
        onClick={() => setOpen(true)}
      >
        <Undo2 className="w-3.5 h-3.5 text-primary" />
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !loading && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Essa taxa já está numa ND emitida</AlertDialogTitle>
            <AlertDialogDescription>
              Reabrir vai excluir a Nota de Débito já emitida ao cliente e removê-la de Contas a
              Receber. A taxa volta a ficar editável. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={loading}>
              {loading ? 'Excluindo…' : 'Sim, excluir ND'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ── Reconciliation Row (Cotado vs Cobrado do fornecedor) ── */
const VARIANCE_REASONS = ['peso', 'cubagem', 'cambio', 'sobrestadia', 'reajuste', 'outros'] as const;
const VARIANCE_LABELS: Record<string, string> = {
  peso: 'Peso', cubagem: 'Cubagem', cambio: 'Câmbio',
  sobrestadia: 'Sobrestadia', reajuste: 'Reajuste', outros: 'Outros',
};

function ReconciliationRow({ charge, cargoMetrics, onUpdate, currentUserId, partnerName, onReopenCharge }: {
  charge: any;
  cargoMetrics?: { totalWeight: number; totalCbm: number; totalChargeable: number; totalContainers: number; totalContainers20: number; totalContainers40: number };
  onUpdate: (id: string, updates: Record<string, any>) => Promise<void>;
  currentUserId?: string;
  partnerName?: string;
  onReopenCharge?: (charge: any, partnerName: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const mult = (() => {
    if (!cargoMetrics) return 1;
    switch (charge.billing_unit) {
      case 'per_cw': return cargoMetrics.totalChargeable;
      case 'per_ton': return cargoMetrics.totalWeight / 1000;
      case 'per_cbm': return cargoMetrics.totalCbm;
      case 'per_wm': return Math.max(cargoMetrics.totalWeight / 1000, cargoMetrics.totalCbm);
      case 'per_container': return cargoMetrics.totalContainers;
      case 'per_container_20': return cargoMetrics.totalContainers20;
      case 'per_container_40': return cargoMetrics.totalContainers40;
      case 'per_bl': return 1;
      default: return 1;
    }
  })();
  const quotedTotal = (Number(charge.buy_amount) || 0) * mult;
  const actualUnit = charge.buy_amount_actual;
  const actualTotal = actualUnit != null ? Number(actualUnit) * mult : null;
  const confirmed = !!charge.buy_actual_confirmed_at;
  const delta = actualTotal != null ? actualTotal - quotedTotal : 0;
  const deltaPct = quotedTotal > 0 && actualTotal != null ? (delta / quotedTotal) * 100 : 0;
  const cur = charge.currency || 'USD';
  // Já vem preenchido com o valor cotado sugerido — se não houver divergência,
  // o usuário só confirma direto, sem precisar digitar de novo.
  const suggestedVal = String(charge.buy_amount ?? '');
  const [inputVal, setInputVal] = useState(actualUnit != null ? String(actualUnit) : suggestedVal);
  const [reason, setReason] = useState<string>(charge.buy_variance_reason || '');

  useEffect(() => {
    setInputVal(actualUnit != null ? String(actualUnit) : suggestedVal);
    setReason(charge.buy_variance_reason || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualUnit, charge.buy_variance_reason]);

  const deltaColor =
    actualTotal == null ? 'text-muted-foreground' :
    Math.abs(delta) < 0.01 ? 'text-muted-foreground' :
    delta < 0 ? 'text-emerald-600' :
    Math.abs(deltaPct) <= 5 ? 'text-amber-500' : 'text-destructive';

  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [reopening, setReopening] = useState(false);

  // Enviada numa DN é o travamento de verdade — a partir daí ninguém edita
  // mais o valor direto aqui. Só "Conferir" (checklist, pré-requisito pra
  // habilitar o botão "Enviar DN") não trava nada; dá pra editar à vontade
  // até a DN ser realmente enviada.
  const sentInDn = !!charge.sent_in_debit_note_id;

  const saveActual = () => {
    const val = inputVal === '' ? null : parseFloat(inputVal);
    if (val !== null && isNaN(val)) return;
    if (val === (actualUnit ?? null)) return;
    const updates: Record<string, any> = { buy_amount_actual: val };
    // Mudou o valor depois de já ter conferido (mas ainda não enviado)? A
    // confirmação anterior fica desatualizada — precisa conferir de novo.
    if (confirmed && !sentInDn) {
      updates.buy_actual_confirmed_at = null;
      updates.buy_actual_confirmed_by = null;
    }
    onUpdate(charge.id, updates);
  };

  const saveReason = (v: string) => {
    setReason(v);
    onUpdate(charge.id, { buy_variance_reason: v || null });
  };

  const confirmActual = () => {
    if (actualUnit == null && inputVal === '') return;
    const val = inputVal === '' ? actualUnit : parseFloat(inputVal);
    onUpdate(charge.id, {
      buy_amount_actual: val,
      buy_actual_confirmed_at: new Date().toISOString(),
      buy_actual_confirmed_by: currentUserId || null,
    });
  };

  const handleReopenConfirm = async () => {
    if (!onReopenCharge || reopening) return;
    setReopening(true);
    const result = await onReopenCharge(charge, partnerName || '');
    setReopening(false);
    if (result.ok) setReopenConfirmOpen(false);
  };

  // Mesmo depois de paga, ainda dá pra reabrir se for realmente necessário
  // (ex.: DN errada, arquivo trocado) — "Reabrir" exclui a DN e a conta a
  // pagar vinculada (perde o registro do pagamento) e libera a taxa de
  // novo. O aviso deixa isso claro antes de confirmar.
  const paid = !!charge.buy_paid_at;

  return (
    <TableRow className={confirmed ? 'bg-emerald-500/5' : 'bg-muted/10'}>
      <TableCell colSpan={4} className="py-1.5 pl-8 pr-2">
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-muted-foreground uppercase tracking-wide">Cobrado:</span>
          <span className="text-muted-foreground">{cur}</span>
          <Input
            type="number"
            value={inputVal}
            disabled={sentInDn}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={saveActual}
            placeholder={String(charge.buy_amount ?? '0')}
            className="h-6 w-24 text-xs font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {actualTotal != null && Math.abs(delta) >= 0.01 && (
            <Select value={reason} onValueChange={saveReason} disabled={sentInDn}>
              <SelectTrigger className="h-6 w-32 text-[11px]">
                <SelectValue placeholder="Motivo" />
              </SelectTrigger>
              <SelectContent>
                {VARIANCE_REASONS.map(r => (
                  <SelectItem key={r} value={r}>{VARIANCE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-1">
            {sentInDn ? (
              <>
                <Badge variant="outline" className={`text-[10px] h-5 gap-1 ${paid ? 'bg-primary/10 text-primary border-primary/30' : 'bg-primary/15 text-primary border-primary/30'}`}>
                  <CheckCircle className="w-3 h-3" /> {paid ? 'Pago' : 'Enviado em DN'}
                </Badge>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setReopenConfirmOpen(true)}>
                  Reabrir
                </Button>
                <AlertDialog open={reopenConfirmOpen} onOpenChange={(o) => !reopening && setReopenConfirmOpen(o)}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{paid ? 'Essa taxa já foi paga' : 'Essa taxa já está numa DN enviada'}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {paid
                          ? 'Reabrir vai excluir a Debit Note já enviada ao fornecedor e o registro do pagamento em Contas a Pagar (data, comprovante, etc. são perdidos). As taxas incluídas nela voltam a ficar editáveis e precisam ser conferidas e reenviadas numa nova DN. Deseja continuar?'
                          : 'Reabrir vai excluir a Debit Note já enviada ao fornecedor e removê-la de Contas a Pagar. As taxas incluídas nela voltam a ficar editáveis e precisam ser conferidas de novo antes de gerar uma nova DN. Deseja continuar?'}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={reopening}>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleReopenConfirm} disabled={reopening}>
                        {reopening ? 'Excluindo…' : 'Sim, excluir DN'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : confirmed ? (
              <Badge variant="outline" className="text-[10px] h-5 bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-1">
                <CheckCircle className="w-3 h-3" /> Conferido
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2"
                disabled={inputVal === '' && actualUnit == null}
                onClick={confirmActual}
              >
                <CheckCircle className="w-3 h-3 mr-1" /> Conferir
              </Button>
            )}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function QuotePartnersTab({ quoteId, quotePartners, partners, companyId, onChanged }: { quoteId: string; quotePartners: any[]; partners: any[]; companyId: string | null; onChanged: () => void }) {
  const { t } = useLanguage();
  const [searchText, setSearchText] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [adding, setAdding] = useState(false);

  const addedClientIds = new Set(quotePartners.map((qp: any) => qp.clients?.id || qp.client_id));
  const filteredPartners = partners
    .filter((p: any) => !addedClientIds.has(p.id))
    .filter((p: any) => searchText.length >= 1 && p.name.toLowerCase().includes(searchText.toLowerCase()));

  async function handleAdd(partnerId: string) {
    if (!partnerId || !companyId) return;
    setAdding(true);
    try {
      const { error } = await supabase.from('quote_partners' as any).insert({
        quote_id: quoteId,
        client_id: partnerId,
        company_id: companyId,
      });
      if (error) throw error;
      setSearchText('');
      setShowSuggestions(false);
      onChanged();
      toast.success(t('quotes.partner_added'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      const { error } = await supabase.from('quote_partners' as any).delete().eq('id', id);
      if (error) throw error;
      onChanged();
      toast.success(t('quotes.partner_removed'));
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Input
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder={t('quotes.add_partner')}
        />
        {showSuggestions && filteredPartners.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
            {filteredPartners.slice(0, 10).map((p: any) => (
              <button
                key={p.id}
                className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center justify-between"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleAdd(p.id);
                }}
                disabled={adding}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{p.name}</span>
                </div>
                {p.partner_category ? (
                  <Badge variant="secondary" className="text-[10px] h-5 bg-primary/10 text-primary border-primary/20">
                    {t(`registrations.category_${p.partner_category}`) !== `registrations.category_${p.partner_category}` 
                      ? t(`registrations.category_${p.partner_category}`) 
                      : p.partner_category}
                  </Badge>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {quotePartners.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">{t('quotes.no_partners')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('shipments.client')}</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotePartners.map((qp: any) => (
              <TableRow key={qp.id}>
                <TableCell className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{qp.clients?.name || '-'}</span>
                  {qp.clients?.partner_category ? (
                    <Badge variant="secondary" className="text-[10px] h-5 bg-primary/10 text-primary border-primary/20">
                      {t(`registrations.category_${qp.clients.partner_category}`) !== `registrations.category_${qp.clients.partner_category}` 
                        ? t(`registrations.category_${qp.clients.partner_category}`) 
                        : qp.clients.partner_category}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemove(qp.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

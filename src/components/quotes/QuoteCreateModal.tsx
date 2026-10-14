import { useState, useMemo, useRef, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PortSelect } from '@/components/shared/PortSelect';
import { ModeFields, type CargoItem, buildCargoSummaryLines, getItemsMissingPackages, missingPackagesMessage } from './ModeFields';
import { ModeIcon } from '@/components/shared/ModeIcon';
import { cn } from '@/lib/utils';
import { ArrowLeft, Copy, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, format } from 'date-fns';
import { quoteNumberExists, findFreeQuoteNumber } from '@/lib/referenceUtils';

const MODES = ['ocean_fcl', 'ocean_lcl', 'air', 'road'] as const;

const MODE_LETTER: Record<string, string> = {
  ocean_fcl: 'F',
  ocean_lcl: 'L',
  air: 'A',
  road: 'R',
  multimodal: 'M',
};

const DIRECTION_LETTER: Record<string, string> = {
  IMP: 'I',
  EXP: 'E',
};

// Incoterms rules per transport mode
const INCOTERMS_BY_MODE: Record<string, string[]> = {
  ocean_fcl: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  ocean_lcl: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  air:       ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  road:      ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  multimodal:['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const defaultValidUntil = () => format(addDays(new Date(), 15), 'yyyy-MM-dd');

/* ── Client Autocomplete ── */
const CLIENT_SEARCH_MIN_CHARS = 2;

function ClientAutocomplete({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // When value is cleared externally, reset query
  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  async function runSearch(term: string) {
    const myRequestId = ++requestIdRef.current;
    setSearching(true);
    let queryBuilder = supabase
      .from('clients')
      .select('id, name')
      .eq('type', 'client')
      .ilike('name', `%${term}%`)
      .order('name')
      .limit(10);
    if (profile?.company_id) {
      queryBuilder = queryBuilder.eq('company_id', profile.company_id) as any;
    }
    const { data, error } = await queryBuilder;
    // Ignora respostas de buscas antigas (evita "piscar" resultado errado)
    if (myRequestId !== requestIdRef.current) return;
    if (error) { setResults([]); setSearching(false); return; }
    setResults(data || []);
    setHighlighted(0);
    setOpen(true);
    setSearching(false);
  }

  function search(term: string) {
    const clean = term.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (clean.length < CLIENT_SEARCH_MIN_CHARS) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(clean), 250);
  }

  function handleSelect(client: { id: string; name: string }) {
    setQuery(client.name);
    onChange(client.id);
    setOpen(false);
  }

  async function handleCreateClient() {
    const name = query.trim();
    if (!profile || !name || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .insert({ company_id: profile.company_id, name, type: 'client' } as any)
        .select('id, name')
        .single();
      if (error) throw error;
      handleSelect(data as any);
      toast.success(`Cliente "${name}" cadastrado`);
      queryClient.invalidateQueries({ queryKey: ['clients-select'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (results.length === 0) {
      if (e.key === 'Enter' && showNoResults) {
        e.preventDefault();
        handleCreateClient();
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = results[highlighted] || results[0];
      if (chosen) handleSelect(chosen);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showHint = query.trim().length > 0 && query.trim().length < CLIENT_SEARCH_MIN_CHARS;
  const showNoResults = open && !searching && results.length === 0 && query.trim().length >= CLIENT_SEARCH_MIN_CHARS;

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); search(e.target.value); if (!e.target.value) onChange(''); }}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder="Digite o nome do cliente..."
        className="text-sm"
      />
      {showHint && (
        <p className="text-xs text-muted-foreground mt-1">Digite pelo menos {CLIENT_SEARCH_MIN_CHARS} letras para buscar.</p>
      )}
      {showNoResults && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
          <p className="px-3 py-2 text-sm text-muted-foreground border-b">
            Nenhum cliente encontrado com esse nome.
          </p>
          <button
            type="button"
            disabled={creating}
            onMouseDown={(e) => { e.preventDefault(); handleCreateClient(); }}
            className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-sm text-primary font-medium hover:bg-accent disabled:opacity-60"
          >
            <Plus className="w-3.5 h-3.5" />
            {creating ? 'Cadastrando...' : `Cadastrar "${query.trim()}" como novo cliente`}
          </button>
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-md border bg-popover shadow-lg">
          {results.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleSelect(c)}
              onMouseEnter={() => setHighlighted(idx)}
              className={cn(
                'w-full px-3 py-2 text-left text-sm transition-colors',
                idx === highlighted ? 'bg-accent' : 'hover:bg-accent'
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuoteCreateModal({ open, onClose, onCreated }: Props) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<string>('ocean_fcl');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CargoItem[]>([]);
  const [showTransshipment, setShowTransshipment] = useState(false);
  const [form, setForm] = useState({
    client_id: '',
    pickup: '',
    origin: '',
    transshipment: '',
    destination: '',
    delivery: '',
    incoterm: 'FOB',
    currency: 'USD',
    valid_until: defaultValidUntil(),
    notes: '',
    manual_reference: '',
  });

  const incoterms = useMemo(() => INCOTERMS_BY_MODE[mode] || INCOTERMS_BY_MODE.ocean_fcl, [mode]);

  // Auto-detect direction based on origin/destination country codes
  const direction = useMemo<'IMP' | 'EXP'>(() => {
    const originIsBR = form.origin?.startsWith('BR') || form.origin?.includes('(BR)') || form.origin?.includes(', BR');
    if (originIsBR) return 'EXP';
    return 'IMP';
  }, [form.origin]);

  function handleModeSelect(newMode: string) {
    setMode(newMode);
    const validIncoterms = INCOTERMS_BY_MODE[newMode] || [];
    const defaultIncoterm = newMode === 'road' ? 'NONE' : (validIncoterms[0] || 'FOB');
    setForm({ client_id: '', pickup: '', origin: '', transshipment: '', destination: '', delivery: '', incoterm: defaultIncoterm, currency: 'USD', valid_until: defaultValidUntil(), notes: '', manual_reference: '' });
    setShowTransshipment(false);
    setItems([]);
    setStep(2);
  }

  function handleClose() {
    setStep(1);
    setMode('ocean_fcl');
    setItems([]);
    setForm({ client_id: '', pickup: '', origin: '', transshipment: '', destination: '', delivery: '', incoterm: 'FOB', currency: 'USD', valid_until: defaultValidUntil(), notes: '', manual_reference: '' });
    setShowTransshipment(false);
    onClose();
  }

  function buildSummaryText(): string {
    const modeLabel = t(`mode.${mode}`);

    const lines: string[] = [
      `📋 Cotação - ${modeLabel}`,
      '',
      `Coleta: ${form.pickup || '-'}`,
      `Origem: ${form.origin || '-'}`,
      `Destino: ${form.destination || '-'}`,
      `Entrega: ${form.delivery || '-'}`,
      `Incoterm: ${form.incoterm}`,
      '',
      ...buildCargoSummaryLines(mode, items),
    ];

    if (form.notes) {
      lines.push('');
      lines.push(`Obs: ${form.notes}`);
    }
    return lines.join('\n');
  }

  function handleCopySummary() {
    const missingPkgs = getItemsMissingPackages(items, mode);
    if (missingPkgs.length > 0) {
      toast.error(missingPackagesMessage(missingPkgs));
      return;
    }
    const text = buildSummaryText();
    navigator.clipboard.writeText(text).then(() => {
      toast.success(t('common.copied'));
    });
  }

  async function handleCreate() {
    if (!profile) return;
    const missingPkgs = getItemsMissingPackages(items, mode);
    if (missingPkgs.length > 0) {
      toast.error(missingPackagesMessage(missingPkgs));
      return;
    }
    setLoading(true);
    try {
      const manualRef = form.manual_reference.trim();
      let baseRef: string;
      let quoteNum: string;
      if (manualRef) {
        // Referência digitada manualmente: não pode duplicar uma já existente.
        if (await quoteNumberExists(profile.company_id, manualRef)) {
          toast.error(`Já existe uma cotação com a referência "${manualRef}". Escolha outra.`);
          setLoading(false);
          return;
        }
        baseRef = manualRef;
        quoteNum = manualRef;
      } else {
        const { data: ref, error: rpcErr } = await supabase.rpc('next_reference', { p_company_id: profile.company_id });
        if (rpcErr) throw rpcErr;
        baseRef = ref as string;
        const { data: companyRow } = await supabase
          .from('companies')
          .select('quote_include_mode')
          .eq('id', profile.company_id)
          .single();
        const includeMode = (companyRow as any)?.quote_include_mode !== false;
        const modeLetter = MODE_LETTER[mode] || 'F';
        const dirLetter = DIRECTION_LETTER[direction] || 'I';
        quoteNum = includeMode ? `${baseRef}-${modeLetter}${dirLetter}` : baseRef;
        // Salvaguarda: mesmo gerada automaticamente, garante que não colide com nada existente.
        quoteNum = await findFreeQuoteNumber(profile.company_id, quoteNum);
      }

      const { data: quote, error: qErr } = await supabase.from('quotes').insert([{
        company_id: profile.company_id,
        quote_number: quoteNum,
        transport_mode: mode as any,
        client_id: form.client_id || null,
        origin: form.origin || null,
        transshipment: form.transshipment || null,
        destination: form.destination || null,
        currency: form.currency,
        valid_until: form.valid_until || null,
        notes: form.notes || null,
        created_by: profile.user_id,
        status: 'quoting' as any,
        base_reference: baseRef,
        direction: direction,
        incoterm: (form.incoterm && form.incoterm !== 'NONE') ? form.incoterm : null,
        // Antes só existiam aqui no modal de criação (usados pra montar o resumo
        // enviado aos fornecedores), mas somem depois — passam a ser salvos na
        // cotação pra continuarem editáveis/visíveis na aba Geral.
        pickup_address: form.pickup || null,
        delivery_address: form.delivery || null,
      }] as any).select('id').single();

      if (qErr) throw qErr;

      const itemsToInsert = items.map((item) => ({
        quote_id: quote.id,
        company_id: profile.company_id,
        container_type: item.container_type || null,
        container_qty: item.container_qty || null,
        weight_kg: parseFloat(item.weight_kg) || null,
        volume_cbm: parseFloat(item.volume_cbm) || null,
        chargeable_weight: parseFloat(item.chargeable_weight) || null,
        length_cm: parseFloat(item.length_cm) || null,
        width_cm: parseFloat(item.width_cm) || null,
        height_cm: parseFloat(item.height_cm) || null,
        packages: parseInt(item.packages) || null,
        ncm_code: item.ncm_code || null,
        commodity: item.commodity || null,
        dangerous_goods: item.dangerous_goods,
        vehicle_type: item.vehicle_type || null,
      }));

      const { error: iErr } = await supabase.from('quote_items' as any).insert(itemsToInsert);
      if (iErr) console.error('quote_items insert error:', iErr);

      toast.success(`${t('quotes.new')}: ${quoteNum}`);
      onCreated();
      handleClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const showPort = mode !== 'road';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? t('quotes.select_mode') : step === 2 ? t('quotes.step_details') : t('quotes.cargo_details')}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">{t('quotes.select_mode_desc')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeSelect(m)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all hover:border-primary/50',
                    mode === m
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border'
                  )}
                >
                  <ModeIcon mode={m} />
                  <span className="text-xs font-medium">{t(`mode.${m}`)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : step === 2 ? (
          <div className="space-y-5">
            {/* Mode indicator */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              <ModeIcon mode={mode} />
              <span className="font-medium">{t(`mode.${mode}`)}</span>
            </div>

            {/* Client – searchable autocomplete */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t('shipments.client')}</Label>
              <ClientAutocomplete value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })} />
            </div>

            {/* Manual reference (optional) */}
            <div className="space-y-1.5">
              <Label className="text-xs">Referência manual (opcional)</Label>
              <Input
                placeholder="Deixe em branco para gerar automaticamente"
                value={form.manual_reference}
                onChange={(e) => setForm({ ...form, manual_reference: e.target.value })}
              />
              <p className="text-[10px] text-muted-foreground">Use para importar processos já existentes com a referência original.</p>
            </div>

            {/* Incoterm */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('shipments.incoterm')}</Label>
                <Select value={form.incoterm} onValueChange={(v) => setForm({ ...form, incoterm: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {mode === 'road' && <SelectItem value="NONE">— Sem incoterm —</SelectItem>}
                    {incoterms.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Pickup / Origin / Destination / Delivery */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('shipments.pickup')}</Label>
                <Input
                  placeholder="Endereço de Coleta"
                  value={form.pickup}
                  onChange={(e) => setForm({ ...form, pickup: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('shipments.origin')}</Label>
                {showPort ? (
                  <PortSelect
                    value={form.origin}
                    onChange={(v) => setForm({ ...form, origin: v })}
                    transportMode={mode}
                    placeholder={t('quotes.search_port')}
                  />
                ) : (
                  <Input
                    placeholder="São Paulo, BR"
                    value={form.origin}
                    onChange={(e) => setForm({ ...form, origin: e.target.value })}
                  />
                )}
              </div>
            </div>

            {/* Transshipment port */}
            {showTransshipment ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1">
                    <Label className="text-xs">Transbordo</Label>
                    <button
                      type="button"
                      onClick={() => { setShowTransshipment(false); setForm({ ...form, transshipment: '' }); }}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {showPort ? (
                    <PortSelect
                      value={form.transshipment}
                      onChange={(v) => setForm({ ...form, transshipment: v })}
                      transportMode={mode}
                      placeholder={t('quotes.search_port')}
                    />
                  ) : (
                    <Input
                      placeholder="Porto de transbordo"
                      value={form.transshipment}
                      onChange={(e) => setForm({ ...form, transshipment: e.target.value })}
                    />
                  )}
                </div>
              </div>
            ) : showPort && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setShowTransshipment(true)}
                >
                  <Plus className="w-3 h-3 mr-1" /> Transbordo
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('shipments.destination')}</Label>
                {showPort ? (
                  <PortSelect
                    value={form.destination}
                    onChange={(v) => setForm({ ...form, destination: v })}
                    transportMode={mode}
                    placeholder={t('quotes.search_port')}
                  />
                ) : (
                  <Input
                    placeholder="Curitiba, BR"
                    value={form.destination}
                    onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('shipments.delivery')}</Label>
                <Input
                  placeholder="Endereço de Entrega"
                  value={form.delivery}
                  onChange={(e) => setForm({ ...form, delivery: e.target.value })}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> {t('quotes.back')}
              </Button>
              <Button onClick={() => setStep(3)}>
                {t('quotes.continue')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Mode indicator */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              <ModeIcon mode={mode} />
              <span className="font-medium">{t(`mode.${mode}`)}</span>
            </div>

            {/* Mode-specific cargo fields */}
            <div>
              <ModeFields mode={mode} items={items} onChange={setItems} />
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> {t('quotes.back')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCopySummary}>
                  <Copy className="w-4 h-4 mr-1" /> {t('common.copy_summary')}
                </Button>
                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                <Button onClick={handleCreate} disabled={loading}>
                  {loading ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

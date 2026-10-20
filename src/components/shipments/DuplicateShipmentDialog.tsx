import { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PortSelect } from '@/components/shared/PortSelect';
import { ModeIcon } from '@/components/shared/ModeIcon';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { findFreeQuoteNumber, quoteNumberExists } from '@/lib/referenceUtils';

const MODES = ['ocean_fcl', 'ocean_lcl', 'air', 'road'] as const;

const MODE_LETTER: Record<string, string> = {
  ocean_fcl: 'F', ocean_lcl: 'L', air: 'A', road: 'R', multimodal: 'M',
};
const DIRECTION_LETTER: Record<string, string> = { IMP: 'I', EXP: 'E' };

const INCOTERMS_BY_MODE: Record<string, string[]> = {
  ocean_fcl: ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'],
  ocean_lcl: ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'],
  air:       ['EXW','FCA','CPT','CIP','DAP','DPU','DDP'],
  road:      ['EXW','FCA','CPT','CIP','DAP','DPU','DDP'],
  multimodal:['EXW','FCA','CPT','CIP','DAP','DPU','DDP'],
};

interface Props {
  shipment: any | null;
  onClose: () => void;
  onDuplicated: (quoteId: string, quoteNumber: string) => void;
}

export function DuplicateShipmentDialog({ shipment, onClose, onDuplicated }: Props) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [mode, setMode] = useState('ocean_fcl');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [incoterm, setIncoterm] = useState('FOB');
  const [manualReference, setManualReference] = useState('');
  const [loading, setLoading] = useState(false);

  const direction = useMemo<'IMP' | 'EXP'>(() => {
    const originIsBR = origin?.startsWith('BR') || origin?.includes('(BR)') || origin?.includes(', BR');
    return originIsBR ? 'EXP' : 'IMP';
  }, [origin]);

  const incoterms = useMemo(() => INCOTERMS_BY_MODE[mode] || INCOTERMS_BY_MODE.ocean_fcl, [mode]);
  const showPort = mode !== 'road';

  useEffect(() => {
    if (shipment) {
      setMode(shipment.transport_mode || 'ocean_fcl');
      // Prefer port codes if present, fallback to "City, Country"
      const originStr = shipment.origin_port || [shipment.origin_city, shipment.origin_country].filter(Boolean).join(', ');
      const destStr = shipment.destination_port || [shipment.destination_city, shipment.destination_country].filter(Boolean).join(', ');
      setOrigin(originStr || '');
      setDestination(destStr || '');
      const valid = INCOTERMS_BY_MODE[shipment.transport_mode || 'ocean_fcl'] || [];
      setIncoterm(shipment.incoterm && valid.includes(shipment.incoterm) ? shipment.incoterm : (valid[0] || 'FOB'));
      setManualReference('');
    }
  }, [shipment]);

  function handleModeChange(newMode: string) {
    setMode(newMode);
    const wasPort = (shipment?.transport_mode || 'ocean_fcl') !== 'road';
    const isPort = newMode !== 'road';
    if (wasPort !== isPort) { setOrigin(''); setDestination(''); }
    const valid = INCOTERMS_BY_MODE[newMode] || [];
    if (!valid.includes(incoterm)) setIncoterm(valid[0] || 'EXW');
  }

  async function handleDuplicate() {
    if (!profile || !shipment) return;
    setLoading(true);
    try {
      let baseRef: string;
      let quoteNum: string;
      const manualRef = manualReference.trim();
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
        // Derive base_reference from shipment reference (strip trailing -XY sufix if present)
        baseRef = (shipment.reference_number || '').replace(/-[AFLRM][IE]$/, '') || shipment.reference_number;
        const modeLetter = MODE_LETTER[mode] || 'F';
        const dirLetter = DIRECTION_LETTER[direction] || 'I';
        // Garante que a referência gerada não colide com uma já existente
        // (ex: duplicar o mesmo embarque mais de uma vez no mesmo modo/direção).
        quoteNum = await findFreeQuoteNumber(profile.company_id, `${baseRef}-${modeLetter}${dirLetter}`);
      }

      const { data: newQuote, error: qErr } = await supabase.from('quotes').insert([{
        company_id: profile.company_id,
        quote_number: quoteNum,
        base_reference: baseRef,
        transport_mode: mode as any,
        client_id: shipment.client_id || null,
        origin: origin || null,
        destination: destination || null,
        currency: 'USD',
        notes: shipment.notes || null,
        created_by: profile.user_id,
        status: 'quoting' as any,
        direction: direction,
      }] as any).select('id, quote_number').single();

      if (qErr) throw qErr;

      // Try to copy items from the originally linked quote (if any)
      const { data: linkedQuote } = await supabase
        .from('quotes')
        .select('id')
        .eq('shipment_id', shipment.id)
        .maybeSingle();

      let itemsInserted = false;
      if (linkedQuote?.id) {
        const { data: items } = await supabase
          .from('quote_items' as any)
          .select('*')
          .eq('quote_id', linkedQuote.id);
        if (items && items.length > 0) {
          const newItems = items.map((item: any) => ({
            quote_id: newQuote.id,
            company_id: profile.company_id,
            container_type: item.container_type,
            container_qty: item.container_qty,
            weight_kg: item.weight_kg,
            volume_cbm: item.volume_cbm,
            chargeable_weight: item.chargeable_weight,
            length_cm: item.length_cm,
            width_cm: item.width_cm,
            height_cm: item.height_cm,
            packages: item.packages,
            package_type: item.package_type ?? null,
            pallets: item.pallets ?? null,
            ncm_code: item.ncm_code,
            commodity: item.commodity,
            dangerous_goods: item.dangerous_goods,
            vehicle_type: item.vehicle_type,
            notes: item.notes,
            cargo_value: item.cargo_value,
            cargo_value_currency: item.cargo_value_currency,
          }));
          await supabase.from('quote_items' as any).insert(newItems);
          itemsInserted = true;
        }
      }

      // Fallback: build a single item from shipment cargo fields
      if (!itemsInserted && (shipment.weight_kg || shipment.volume_cbm || shipment.packages || shipment.cargo_description)) {
        await supabase.from('quote_items' as any).insert([{
          quote_id: newQuote.id,
          company_id: profile.company_id,
          weight_kg: shipment.weight_kg,
          volume_cbm: shipment.volume_cbm,
          packages: shipment.packages,
          commodity: shipment.cargo_description,
        }]);
      }

      toast.success(`${t('shipments.duplicated_success')}: ${newQuote.quote_number}`);
      onDuplicated(newQuote.id, newQuote.quote_number);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!shipment} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('shipments.duplicate')}</DialogTitle>
          <DialogDescription>{t('shipments.duplicate_desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('shipments.mode')}</Label>
            <div className="grid grid-cols-4 gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeChange(m)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border-2 p-2.5 transition-all hover:border-primary/50',
                    mode === m ? 'border-primary bg-primary/5 shadow-sm' : 'border-border'
                  )}
                >
                  <ModeIcon mode={m} />
                  <span className="text-[10px] font-medium leading-tight text-center">{t(`mode.${m}`)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('shipments.origin')}</Label>
              {showPort ? (
                <PortSelect value={origin} onChange={setOrigin} transportMode={mode} placeholder={t('quotes.search_port')} />
              ) : (
                <Input placeholder="São Paulo, BR" value={origin} onChange={(e) => setOrigin(e.target.value)} />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('shipments.destination')}</Label>
              {showPort ? (
                <PortSelect value={destination} onChange={setDestination} transportMode={mode} placeholder={t('quotes.search_port')} />
              ) : (
                <Input placeholder="Curitiba, BR" value={destination} onChange={(e) => setDestination(e.target.value)} />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('shipments.incoterm')}</Label>
            <Select value={incoterm} onValueChange={setIncoterm}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {incoterms.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Manual reference (optional) */}
          <div className="space-y-1.5">
            <Label className="text-xs">Referência manual (opcional)</Label>
            <Input
              placeholder="Deixe em branco para gerar automaticamente"
              value={manualReference}
              onChange={(e) => setManualReference(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">Use para dar um número específico a esta cópia, em vez do sufixo automático.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button onClick={handleDuplicate} disabled={loading}>
              {loading ? t('common.loading') : t('shipments.duplicate')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
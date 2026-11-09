import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { computePercentCharge, collectPercentUpdates, isPercentCharge, type PercentChargeLike, type CollectFxRates } from '@/lib/collectFee';

interface Props {
  quoteId: string;
  chargeId: string | null;
  charges: any[];
  usdBrl: number | null;
  eurBrl: number | null;
  getChargeMultiplier: (unit: string) => number;
  onClose: () => void;
}

const LEG_LABELS: Record<string, string> = {
  origin: 'Origem',
  freight: 'Frete',
  destination: 'Destino',
};

export function PercentBaseDialog({ quoteId, chargeId, charges, usdBrl, eurBrl, getChargeMultiplier, onClose }: Props) {
  const qc = useQueryClient();
  const charge = useMemo(() => charges.find((c) => c.id === chargeId), [charges, chargeId]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (charge) setSelected(charge.percent_base_charge_ids || []);
  }, [charge]);

  const eligibleByLeg = useMemo(() => {
    const groups: Record<string, any[]> = { origin: [], freight: [], destination: [] };
    for (const c of charges) {
      if (!chargeId || c.id === chargeId) continue;
      if (isPercentCharge(c)) continue; // evita ciclo
      const leg = c.leg || 'freight';
      if (!groups[leg]) groups[leg] = [];
      groups[leg].push(c);
    }
    return groups;
  }, [charges, chargeId]);

  const fx: CollectFxRates = { USD: usdBrl, BRL: 1, EUR: eurBrl };

  const preview = useMemo(() => {
    if (!charge) return null;
    const tmp: PercentChargeLike = { ...(charge as any), percent_base_charge_ids: selected };
    return computePercentCharge(tmp, charges as PercentChargeLike[], fx, getChargeMultiplier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charge, charges, selected, usdBrl, eurBrl]);

  if (!chargeId || !charge) return null;

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const applyPreset = (fn: (c: any) => boolean) => {
    setSelected(charges.filter((c) => c.id !== chargeId && !isPercentCharge(c) && fn(c)).map((c) => c.id));
  };

  async function handleSave() {
    setSaving(true);
    try {
      const compBuy = preview?.computed_buy_amount ?? 0;
      const compSell = preview?.computed_sell_amount ?? 0;
      const { error } = await supabase.from('quote_charges').update({
        percent_base_charge_ids: selected,
        computed_buy_amount: compBuy,
        computed_sell_amount: compSell,
      } as any).eq('id', chargeId);
      if (error) throw error;

      // Recalcula toda cadeia
      const { data } = await supabase
        .from('quote_charges')
        .select('id, description, currency, billing_unit, buy_amount, sell_amount, buy_min_amount, sell_min_amount, percent_base_charge_ids, computed_buy_amount, computed_sell_amount')
        .eq('quote_id', quoteId);
      if (data) {
        const updates = collectPercentUpdates(data as unknown as PercentChargeLike[], fx, getChargeMultiplier);
        for (const u of updates) {
          await supabase.from('quote_charges').update({ computed_buy_amount: u.computed_buy_amount, computed_sell_amount: u.computed_sell_amount } as any).eq('id', u.id);
        }
      }

      qc.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
      qc.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
      qc.invalidateQueries({ queryKey: ['cost-estimate', quoteId] });
      toast.success('Taxas base atualizadas');
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const pBuy = Number(charge.buy_amount) || 0;
  const pSell = Number(charge.sell_amount) || 0;

  return (
    <Dialog open={!!chargeId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{charge.description} — Selecionar taxas base</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground -mt-2">
          Compra: {pBuy.toFixed(2)}% · Venda: {pSell.toFixed(2)}%
        </div>

        <div className="flex gap-1 flex-wrap mt-2">
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => applyPreset((c) => c.leg === 'origin')}>Todas Origem</Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => applyPreset((c) => c.leg === 'freight')}>Todas Frete</Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => applyPreset((c) => c.leg === 'origin' || c.leg === 'freight')}>Origem + Frete</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px] ml-auto" onClick={() => setSelected([])}>Limpar</Button>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-3 mt-2 border rounded p-2">
          {(['origin', 'freight', 'destination'] as const).map((leg) => {
            const items = eligibleByLeg[leg] || [];
            if (items.length === 0) return null;
            return (
              <div key={leg}>
                <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">{LEG_LABELS[leg]}</div>
                <div className="space-y-1">
                  {items.map((c) => {
                    const checked = selected.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-accent cursor-pointer text-xs">
                        <Checkbox checked={checked} onCheckedChange={() => toggle(c.id)} />
                        <span className="flex-1 truncate">{c.description}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {c.currency || 'USD'} {(Number(c.buy_amount) || 0).toFixed(2)} / {(Number(c.sell_amount) || 0).toFixed(2)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {Object.values(eligibleByLeg).every((arr) => arr.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhuma outra taxa disponível.</p>
          )}
        </div>

        {preview && (
          <div className="mt-2 p-3 rounded border bg-muted/30 font-mono text-xs space-y-1">
            <div>Base Compra: USD {preview.base_buy_usd.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} → Compra: USD {preview.computed_buy_amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div>Base Venda:&nbsp; USD {preview.base_sell_usd.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} → Venda:&nbsp; USD {preview.computed_sell_amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            {preview.missingRate && (
              <div className="text-amber-500">Alguma taxa base está em moeda sem câmbio no cabeçalho.</div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
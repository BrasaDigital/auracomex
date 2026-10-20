import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import {
  PACKAGE_TYPES, emptyCargoVolume, isEmptyVolume, volumeAsCalcItem, calcItemWeight, getEffectiveVolume,
  type CargoVolume,
} from './ModeFields';

interface Props {
  volumes: CargoVolume[];
  onChange: (v: CargoVolume[]) => void;
  readOnly?: boolean;
}

const labelCls = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';

/**
 * Volumes físicos do embarque (base do frete): uma linha por tipo de embalagem, com
 * quantidade, medidas e peso POR UNIDADE. Peso, cubagem e peso taxado dos totais vêm daqui.
 */
export function CargoVolumesEditor({ volumes, onChange, readOnly }: Props) {
  const update = (idx: number, patch: Partial<CargoVolume>) =>
    onChange(volumes.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  const add = () => onChange([...volumes, { ...emptyCargoVolume }]);
  const remove = (idx: number) => onChange(volumes.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Volumes (base do cálculo de frete)</p>
          <p className="text-[11px] text-muted-foreground">Informe a quantidade e o tipo; peso e medidas são por unidade. Se houver volumes com medidas diferentes, use outra linha: o total soma todas.</p>
        </div>
        {!readOnly && (
          <Button type="button" size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={add}>
            <Plus className="w-3.5 h-3.5" /> Adicionar volume
          </Button>
        )}
      </div>

      {volumes.length === 0 ? (
        <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-lg">
          Nenhum volume informado. Adicione as caixas/pallets com medidas e peso para calcular peso e cubagem.
        </div>
      ) : (
        <div className="space-y-2">
          {volumes.map((v, idx) => {
            const item = volumeAsCalcItem(v);
            const totalW = calcItemWeight(item);
            const totalC = getEffectiveVolume(item);
            const qtyMissing = !readOnly && !isEmptyVolume(v) && !(parseInt(v.qty) >= 1);
            return (
              <div key={idx} className="rounded-md border bg-muted/10 p-2.5 space-y-2">
                <div className="grid grid-cols-[90px_1fr_auto] md:grid-cols-[110px_220px_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className={labelCls}>Qtd <span className="text-destructive">*</span></Label>
                    <Input inputMode="numeric" placeholder="1" value={v.qty} disabled={readOnly}
                      className={qtyMissing ? 'border-destructive focus-visible:ring-destructive' : ''}
                      onChange={(e) => update(idx, { qty: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Tipo de volume</Label>
                    <Select value={v.package_type || '__none'} disabled={readOnly}
                      onValueChange={(val) => update(idx, { package_type: val === '__none' ? '' : val })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Volume</SelectItem>
                        {PACKAGE_TYPES.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.singular.charAt(0).toUpperCase() + p.singular.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="hidden md:block" />
                  <div className="flex items-end justify-end">
                    {!readOnly && (
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" title="Remover volume" onClick={() => remove(idx)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                  <div className="space-y-1">
                    <Label className={labelCls}>Comp. (cm)</Label>
                    <Input inputMode="decimal" placeholder="0" value={v.length_cm} disabled={readOnly}
                      onChange={(e) => update(idx, { length_cm: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Larg. (cm)</Label>
                    <Input inputMode="decimal" placeholder="0" value={v.width_cm} disabled={readOnly}
                      onChange={(e) => update(idx, { width_cm: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Alt. (cm)</Label>
                    <Input inputMode="decimal" placeholder="0" value={v.height_cm} disabled={readOnly}
                      onChange={(e) => update(idx, { height_cm: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Peso/un (kg)</Label>
                    <Input inputMode="decimal" placeholder="0" value={v.weight_kg} disabled={readOnly}
                      onChange={(e) => update(idx, { weight_kg: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Cubagem/un (m³)</Label>
                    {(() => {
                      const unit = (parseFloat(v.length_cm) || 0) * (parseFloat(v.width_cm) || 0) * (parseFloat(v.height_cm) || 0) / 1_000_000;
                      const isComputed = unit > 0;
                      return (
                        <Input inputMode="decimal" placeholder="0" disabled={readOnly}
                          value={isComputed ? unit.toFixed(5) : v.volume_cbm}
                          readOnly={isComputed} className={isComputed ? 'bg-muted/50' : ''}
                          onChange={(e) => { if (!isComputed) update(idx, { volume_cbm: e.target.value }); }} />
                      );
                    })()}
                  </div>
                </div>
                {!readOnly && (parseInt(v.qty) || 0) >= 2 && (
                  <p className="text-[11px] text-muted-foreground">
                    Medidas e peso acima valem para cada um dos {parseInt(v.qty)} volumes. Algum tem medidas diferentes?{' '}
                    <button type="button" className="text-primary underline underline-offset-2"
                      onClick={() => onChange([...volumes.slice(0, idx), { ...v, qty: String((parseInt(v.qty) || 2) - 1) }, { ...emptyCargoVolume, package_type: v.package_type }, ...volumes.slice(idx + 1)])}>
                      Separar 1 volume em nova linha
                    </button>
                  </p>
                )}
                {(totalW > 0 || totalC > 0) && (
                  <p className="text-[11px] text-muted-foreground">
                    Total desta linha: <strong>{totalW.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg</strong> · <strong>{totalC.toFixed(4)} m³</strong>
                  </p>
                )}
              </div>
            );
          })}
          {volumes.length > 1 && (() => {
            const tot = volumes.reduce((a, v) => { const it = volumeAsCalcItem(v); return { w: a.w + calcItemWeight(it), c: a.c + getEffectiveVolume(it), q: a.q + (parseInt(v.qty) || 0) }; }, { w: 0, c: 0, q: 0 });
            return (
              <p className="text-xs text-right pr-1">
                Total de todos os volumes: <strong>{tot.q} vol.</strong> · <strong>{tot.w.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg</strong> · <strong>{tot.c.toFixed(4)} m³</strong>
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}

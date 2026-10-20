import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import {
  PACKAGE_TYPES, emptyCargoVolume, volumeAsCalcItem, calcItemWeight, getEffectiveVolume,
  type CargoVolume,
} from './ModeFields';

interface Props {
  volumes: CargoVolume[];
  onChange: (v: CargoVolume[]) => void;
  readOnly?: boolean;
  /** Valor total da carga (invoice digitada ou soma dos itens), mostrado junto aos totais. */
  valueTotal?: { amount: number; currency: string; approx?: boolean };
}

const labelCls = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';
const newRow = (type: string): CargoVolume => ({ ...emptyCargoVolume, qty: '1', package_type: type });

/** Grupo = Quantidade + Tipo; cada unidade é uma linha (com suas próprias medidas). */
interface Group { idxs: number[]; type: string; legacy: boolean }

/** Linhas com qtd 1 e mesmo tipo, seguidas, formam um grupo. Linha com qtd >= 2 (formato antigo) é um grupo "legado". */
function buildGroups(volumes: CargoVolume[]): Group[] {
  const groups: Group[] = [];
  volumes.forEach((v, i) => {
    const q = parseInt(v.qty) || 1;
    const last = groups[groups.length - 1];
    if (q >= 2) groups.push({ idxs: [i], type: v.package_type, legacy: true });
    else if (last && !last.legacy && last.type === v.package_type) last.idxs.push(i);
    else groups.push({ idxs: [i], type: v.package_type, legacy: false });
  });
  return groups;
}

function QtyInput({ count, disabled, onCommit }: { count: number; disabled?: boolean; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(count));
  useEffect(() => setText(String(count)), [count]);
  return (
    <Input inputMode="numeric" value={text} disabled={disabled}
      onChange={(e) => {
        const t = e.target.value.replace(/\D/g, '');
        setText(t);
        const n = parseInt(t);
        if (n >= 1 && n <= 200) onCommit(n);
      }}
      onBlur={() => setText(String(count))} />
  );
}

/**
 * Volumes físicos do embarque (base do frete): Quantidade + Tipo; a quantidade abre uma linha por volume
 * (comprimento, largura, altura, peso e cubagem). Peso, cubagem e peso taxado dos totais vêm da soma das linhas.
 */
export function CargoVolumesEditor({ volumes, onChange, readOnly, valueTotal }: Props) {
  const groups = buildGroups(volumes);

  const patchRow = (idx: number, patch: Partial<CargoVolume>) =>
    onChange(volumes.map((v, i) => (i === idx ? { ...v, ...patch } : v)));

  const setType = (g: Group, type: string) =>
    onChange(volumes.map((v, i) => (g.idxs.includes(i) ? { ...v, package_type: type } : v)));

  // Muda a quantidade do grupo: acrescenta ou tira linhas no fim do grupo.
  const setCount = (g: Group, n: number) => {
    const cur = g.idxs.length;
    if (n === cur) return;
    if (n > cur) {
      const at = g.idxs[g.idxs.length - 1] + 1;
      onChange([...volumes.slice(0, at), ...Array.from({ length: n - cur }, () => newRow(g.type)), ...volumes.slice(at)]);
    } else {
      const drop = new Set(g.idxs.slice(n));
      onChange(volumes.filter((_, i) => !drop.has(i)));
    }
  };

  const removeGroup = (g: Group) => onChange(volumes.filter((_, i) => !g.idxs.includes(i)));
  const addGroup = () => onChange([...volumes, newRow('caixa')]);

  // Formato antigo (uma linha "N × medidas"): abre em N linhas iguais para poder ajustar cada uma.
  const explode = (g: Group) => {
    const v = volumes[g.idxs[0]];
    const n = Math.min(parseInt(v.qty) || 1, 200);
    onChange([...volumes.slice(0, g.idxs[0]), ...Array.from({ length: n }, () => ({ ...v, id: null, qty: '1' })), ...volumes.slice(g.idxs[0] + 1)]);
  };

  const sumOf = (list: CargoVolume[]) => list.reduce((a, v) => {
    const it = volumeAsCalcItem(v);
    return { w: a.w + calcItemWeight(it), c: a.c + getEffectiveVolume(it), q: a.q + (parseInt(v.qty) || 1) };
  }, { w: 0, c: 0, q: 0 });

  const fmtW = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carga física do embarque</p>
          <p className="text-[11px] text-muted-foreground">Informe a quantidade e o tipo; cada volume ganha uma linha com suas medidas. O total soma todos.</p>
        </div>
        {!readOnly && (
          <Button type="button" size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={addGroup}>
            <Plus className="w-3.5 h-3.5" /> Adicionar tipo de volume
          </Button>
        )}
      </div>

      {volumes.length === 0 ? (
        <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-lg">
          Nenhum volume informado. Adicione a quantidade e o tipo (caixa, pallet…) para preencher as medidas.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g, gi) => {
            const rows = g.idxs.map((i) => volumes[i]);
            const tot = sumOf(rows);
            return (
              <div key={gi} className="rounded-md border bg-muted/10 p-2.5 space-y-2">
                <div className="flex items-end gap-2">
                  <div className="space-y-1 w-24">
                    <Label className={labelCls}>Quantidade</Label>
                    {g.legacy ? (
                      <Input value={volumes[g.idxs[0]].qty} disabled />
                    ) : (
                      <QtyInput count={g.idxs.length} disabled={readOnly} onCommit={(n) => setCount(g, n)} />
                    )}
                  </div>
                  <div className="space-y-1 w-48">
                    <Label className={labelCls}>Tipo</Label>
                    <Select value={g.type || '__none'} disabled={readOnly}
                      onValueChange={(val) => setType(g, val === '__none' ? '' : val)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Volume</SelectItem>
                        {PACKAGE_TYPES.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.singular.charAt(0).toUpperCase() + p.singular.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1" />
                  {!readOnly && (
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9" title="Remover" onClick={() => removeGroup(g)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>

                {g.legacy && !readOnly && (
                  <p className="text-[11px] text-muted-foreground">
                    Medidas e peso abaixo valem para cada uma das {volumes[g.idxs[0]].qty} unidades.{' '}
                    <button type="button" className="text-primary underline underline-offset-2" onClick={() => explode(g)}>
                      Abrir em {volumes[g.idxs[0]].qty} linhas
                    </button>
                  </p>
                )}

                <div className="space-y-1.5">
                  {g.idxs.map((idx, n) => {
                    const v = volumes[idx];
                    const l = parseFloat(v.length_cm) || 0, w = parseFloat(v.width_cm) || 0, h = parseFloat(v.height_cm) || 0;
                    const hasDims = !!(v.length_cm || v.width_cm || v.height_cm);
                    const computed = l > 0 && w > 0 && h > 0 ? (l * w * h) / 1_000_000 : 0;
                    return (
                      <div key={idx} className="grid grid-cols-2 md:grid-cols-[48px_repeat(5,1fr)] gap-2 items-end">
                        <div className="hidden md:flex h-9 items-center text-[11px] text-muted-foreground">
                          {g.legacy ? 'cada' : `#${n + 1}`}
                        </div>
                        <div className="space-y-1">
                          {n === 0 && <Label className={labelCls}>Comprimento (cm)</Label>}
                          <Input inputMode="decimal" placeholder="0" value={v.length_cm} disabled={readOnly}
                            onChange={(e) => patchRow(idx, { length_cm: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          {n === 0 && <Label className={labelCls}>Largura (cm)</Label>}
                          <Input inputMode="decimal" placeholder="0" value={v.width_cm} disabled={readOnly}
                            onChange={(e) => patchRow(idx, { width_cm: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          {n === 0 && <Label className={labelCls}>Altura (cm)</Label>}
                          <Input inputMode="decimal" placeholder="0" value={v.height_cm} disabled={readOnly}
                            onChange={(e) => patchRow(idx, { height_cm: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          {n === 0 && <Label className={labelCls}>Peso (kg)</Label>}
                          <Input inputMode="decimal" placeholder="0" value={v.weight_kg} disabled={readOnly}
                            onChange={(e) => patchRow(idx, { weight_kg: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          {n === 0 && <Label className={labelCls}>Cubagem (m³)</Label>}
                          <Input inputMode="decimal" placeholder="0" disabled={readOnly}
                            value={hasDims ? (computed > 0 ? computed.toFixed(5) : '') : v.volume_cbm}
                            readOnly={hasDims} className={hasDims ? 'bg-muted/50' : ''}
                            onChange={(e) => { if (!hasDims) patchRow(idx, { volume_cbm: e.target.value }); }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(tot.w > 0 || tot.c > 0) && (
                  <p className="text-[11px] text-muted-foreground">
                    Total: <strong>{fmtW(tot.w)} kg</strong> · <strong>{tot.c.toFixed(4)} m³</strong>
                  </p>
                )}
              </div>
            );
          })}
          {(() => {
            const t = sumOf(volumes);
            return (
              <p className="text-xs text-right pr-1">
                Total da carga física: <strong>{t.q} vol.</strong> · <strong>{fmtW(t.w)} kg</strong> · <strong>{t.c.toFixed(4)} m³</strong>
                {valueTotal && valueTotal.amount > 0 && (
                  <> · Valor: <strong>{valueTotal.currency} {valueTotal.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>{valueTotal.approx && <span className="text-amber-600" title="Itens em outra moeda não estão somados">*</span>}</>
                )}
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}

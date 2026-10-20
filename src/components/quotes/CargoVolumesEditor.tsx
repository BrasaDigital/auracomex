import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  emptyCargoVolume, volumeAsCalcItem, calcItemWeight, getEffectiveVolume,
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
export const MAX_VOLUME_ROWS = 200;

/** Quantidade total de volumes (linha antiga "N ×" conta N; linha nova conta 1). */
export const totalVolumeQty = (volumes: CargoVolume[]) => volumes.reduce((s, v) => s + Math.max(parseInt(v.qty) || 1, 1), 0);

/** Ajusta a lista para `n` linhas (uma por volume). Linha no formato antigo "N ×" vira N linhas iguais. */
export function resizeVolumes(volumes: CargoVolume[], n: number, type: string): CargoVolume[] {
  const rows: CargoVolume[] = [];
  for (const v of volumes) {
    const q = parseInt(v.qty) || 1;
    if (q >= 2) for (let i = 0; i < Math.min(q, MAX_VOLUME_ROWS); i++) rows.push({ ...v, id: null, qty: '1' });
    else rows.push(v);
  }
  const target = Math.max(0, Math.min(n, MAX_VOLUME_ROWS));
  if (rows.length >= target) return rows.slice(0, target);
  return [...rows, ...Array.from({ length: target - rows.length }, () => ({ ...emptyCargoVolume, qty: '1', package_type: type }))];
}

/** Campo de quantidade que só confirma quando o número é válido (não apaga linhas enquanto digita). */
export function VolumeQtyInput({ count, disabled, onCommit }: { count: number; disabled?: boolean; onCommit: (n: number) => void }) {
  const [text, setText] = useState(count ? String(count) : '');
  useEffect(() => setText(count ? String(count) : ''), [count]);
  return (
    <Input inputMode="numeric" placeholder="0" value={text} disabled={disabled}
      onChange={(e) => {
        const t = e.target.value.replace(/\D/g, '');
        setText(t);
        const n = parseInt(t);
        if (n >= 1 && n <= MAX_VOLUME_ROWS) onCommit(n);
        else if (t === '0') onCommit(0);
      }}
      onBlur={() => setText(count ? String(count) : '')} />
  );
}

/**
 * Linhas de volume do embarque (base do frete). A Quantidade e o Tipo ficam no cabeçalho do bloco (QuoteDetail);
 * aqui há uma linha por volume (comprimento, largura, altura, peso e cubagem). O total soma todas as linhas.
 */
export function CargoVolumesEditor({ volumes, onChange, readOnly, valueTotal }: Props) {
  const patchRow = (idx: number, patch: Partial<CargoVolume>) =>
    onChange(volumes.map((v, i) => (i === idx ? { ...v, ...patch } : v)));

  const legacy = volumes.findIndex((v) => (parseInt(v.qty) || 1) >= 2);

  const tot = volumes.reduce((a, v) => {
    const it = volumeAsCalcItem(v);
    return { w: a.w + calcItemWeight(it), c: a.c + getEffectiveVolume(it) };
  }, { w: 0, c: 0 });
  const fmtW = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  if (volumes.length === 0) {
    return (
      <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-lg">
        Informe a quantidade para abrir uma linha de medidas por volume.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {legacy >= 0 && !readOnly && (
        <p className="text-[11px] text-muted-foreground">
          Esta carga usa medidas iguais para {volumes[legacy].qty} unidades (formato antigo). Altere a quantidade acima para abrir uma linha por volume.
        </p>
      )}
      <div className="space-y-1.5">
        {volumes.map((v, idx) => {
          const l = parseFloat(v.length_cm) || 0, w = parseFloat(v.width_cm) || 0, h = parseFloat(v.height_cm) || 0;
          const hasDims = !!(v.length_cm || v.width_cm || v.height_cm);
          const computed = l > 0 && w > 0 && h > 0 ? (l * w * h) / 1_000_000 : 0;
          const old = (parseInt(v.qty) || 1) >= 2;
          return (
            <div key={idx} className="grid grid-cols-2 md:grid-cols-[56px_repeat(5,1fr)] gap-2 items-end">
              <div className="hidden md:flex h-9 items-center text-[11px] text-muted-foreground">{old ? `cada (${v.qty})` : `#${idx + 1}`}</div>
              <div className="space-y-1">
                {idx === 0 && <Label className={labelCls}>Comprimento (cm)</Label>}
                <Input inputMode="decimal" placeholder="0" value={v.length_cm} disabled={readOnly}
                  onChange={(e) => patchRow(idx, { length_cm: e.target.value })} />
              </div>
              <div className="space-y-1">
                {idx === 0 && <Label className={labelCls}>Largura (cm)</Label>}
                <Input inputMode="decimal" placeholder="0" value={v.width_cm} disabled={readOnly}
                  onChange={(e) => patchRow(idx, { width_cm: e.target.value })} />
              </div>
              <div className="space-y-1">
                {idx === 0 && <Label className={labelCls}>Altura (cm)</Label>}
                <Input inputMode="decimal" placeholder="0" value={v.height_cm} disabled={readOnly}
                  onChange={(e) => patchRow(idx, { height_cm: e.target.value })} />
              </div>
              <div className="space-y-1">
                {idx === 0 && <Label className={labelCls}>Peso (kg)</Label>}
                <Input inputMode="decimal" placeholder="0" value={v.weight_kg} disabled={readOnly}
                  onChange={(e) => patchRow(idx, { weight_kg: e.target.value })} />
              </div>
              <div className="space-y-1">
                {idx === 0 && <Label className={labelCls}>Cubagem (m³)</Label>}
                <Input inputMode="decimal" placeholder="0" disabled={readOnly}
                  value={hasDims ? (computed > 0 ? computed.toFixed(5) : '') : v.volume_cbm}
                  readOnly={hasDims} className={hasDims ? 'bg-muted/50' : ''}
                  onChange={(e) => { if (!hasDims) patchRow(idx, { volume_cbm: e.target.value }); }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-right pr-1">
        Total da carga física: <strong>{totalVolumeQty(volumes)} vol.</strong> · <strong>{fmtW(tot.w)} kg</strong> · <strong>{tot.c.toFixed(4)} m³</strong>
        {valueTotal && valueTotal.amount > 0 && (
          <> · Valor: <strong>{valueTotal.currency} {valueTotal.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>{valueTotal.approx && <span className="text-amber-600" title="Itens em outra moeda não estão somados">*</span>}</>
        )}
      </p>
    </div>
  );
}

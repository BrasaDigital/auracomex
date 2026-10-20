import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Package, Pencil, AlertTriangle, ChevronUp, Loader2 } from 'lucide-react';
import { calcTotalCargoValueUsd } from '@/lib/cargoValue';

// Module-level cache for NCM descriptions (code -> description)
const ncmDescCache = new Map<string, string>();

async function fetchNcmDescription(code: string): Promise<string> {
  if (!code) return '';
  const cleanCode = code.replace(/\D/g, '');
  if (ncmDescCache.has(cleanCode)) return ncmDescCache.get(cleanCode)!;

  try {
    let res = await fetch(`https://brasilapi.com.br/api/ncm/v1/${cleanCode}`);
    if (res.ok) {
      const data = await res.json();
      let desc = (data.descricao || '').replace(/<[^>]*>/g, '').replace(/^[- ]+/, '').trim();

      // If description is generic "Outras" or "Outros", try to get more context from the search endpoint
      // for 4-digit or 6-digit codes which might have better names in a list
      if (desc.toLowerCase() === 'outras' || desc.toLowerCase() === 'outros') {
        const searchRes = await fetch(`https://brasilapi.com.br/api/ncm/v1?search=${cleanCode}`);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          // Look for a version of this code that might have more text
          const detailedMatch = searchData.find((d: any) =>
            d.codigo.replace(/\D/g, '') === cleanCode &&
            d.descricao.length > desc.length
          );
          if (detailedMatch) {
            desc = detailedMatch.descricao.replace(/<[^>]*>/g, '').replace(/^[- ]+/, '').trim();
          }
        }
      }

      ncmDescCache.set(cleanCode, desc);
      return desc;
    }

    const searchRes = await fetch(`https://brasilapi.com.br/api/ncm/v1?search=${cleanCode}`);
    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data && Array.isArray(data) && data.length > 0) {
        const match = data.find((d: any) => d.codigo.replace(/\D/g, '') === cleanCode);
        if (match) {
          const desc = (match.descricao || '').replace(/<[^>]*>/g, '').replace(/^[- ]+/, '').trim();
          ncmDescCache.set(cleanCode, desc);
          return desc;
        }
      }
    }

    return '';
  } catch {
    return '';
  }
}

async function fetchNcmHierarchy(code: string): Promise<string> {
  const digits = code.replace(/\D/g, '');
  if (digits.length < 2) return '';

  const levels: string[] = [];
  if (digits.length >= 2) levels.push(digits.slice(0, 2));
  if (digits.length >= 4) levels.push(digits.slice(0, 4));
  if (digits.length >= 6) levels.push(digits.slice(0, 6));
  if (digits.length >= 8) levels.push(digits.slice(0, 8));
  if (!levels.includes(digits)) levels.push(digits);

  const unique = Array.from(new Set(levels)).sort((a, b) => a.length - b.length);
  const results = await Promise.all(unique.map(fetchNcmDescription));

  const parts = results.filter(Boolean);

  const dedup: string[] = [];
  const genericTerms = ['outras', 'outros', '- outras', '- outros', '-- outras', '-- outros'];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const isGeneric = genericTerms.includes(p.toLowerCase());

    // Only add generic terms if it is the very last part of a multi-part hierarchy
    // or if we have no other choice. This avoids "Outras › Outras".
    if (isGeneric) {
      if (i === parts.length - 1 && dedup.length > 0) {
        // Keep it as the specific final classification
        if (dedup[dedup.length - 1].toLowerCase() !== p.toLowerCase()) {
          dedup.push(p);
        }
      }
      // Otherwise skip generic intermediate levels
      continue;
    }

    if (dedup.length === 0 || dedup[dedup.length - 1].toLowerCase() !== p.toLowerCase()) {
      dedup.push(p);
    }
  }

  return dedup.join(' › ');
}

interface CargoItem {
  id?: string | null;
  container_type: string;
  container_qty: number;
  container_number: string;
  weight_kg: string;
  volume_cbm: string;
  chargeable_weight: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  packages: string;
  /** Quantidade comercial do produto (ex.: 15000 pçs) — independe de caixas/pallets. */
  pieces?: string;
  pieces_unit?: string;
  ncm_code: string;
  commodity: string;
  dangerous_goods: boolean;
  vehicle_type: string;
  cargo_value: string;
  cargo_value_currency: string;
  notes: string;
}

interface ModeFieldsProps {
  mode: string;
  items: CargoItem[];
  onChange: (items: CargoItem[]) => void;
  readOnly?: boolean;
  /** Mostra um indicador de "salvando" ao lado do item em edição (auto-save). */
  saving?: boolean;
  /**
   * Linhas de volume do embarque. Quando informado (e o modal não é FCL), os itens passam a
   * ser só comerciais (mercadoria, NCM, peças, valor) e peso/cubagem vêm daqui.
   */
  volumes?: CargoVolume[];
  /** Valor total da carga digitado (invoice). Vazio = soma dos itens. */
  cargoValueTotal?: string;
  cargoValueCurrency?: string;
}

/** Tipos de embalagem contados em "Volumes" (packages). Chave gravada no banco. */
export const PACKAGE_TYPES: { value: string; singular: string; plural: string }[] = [
  { value: 'caixa', singular: 'caixa', plural: 'caixas' },
  { value: 'pallet', singular: 'pallet', plural: 'pallets' },
  { value: 'volume', singular: 'volume', plural: 'volumes' },
  { value: 'saco', singular: 'saco', plural: 'sacos' },
  { value: 'fardo', singular: 'fardo', plural: 'fardos' },
  { value: 'tambor', singular: 'tambor', plural: 'tambores' },
  { value: 'rolo', singular: 'rolo', plural: 'rolos' },
  { value: 'engradado', singular: 'engradado', plural: 'engradados' },
  { value: 'outro', singular: 'unidade', plural: 'unidades' },
];

/** "320 caixas", "1 caixa", "4 volumes" (sem tipo = "vol."). */
export function fmtPackages(n: number | string | null | undefined, type?: string | null): string {
  const q = Number(n) || 0;
  const pt = PACKAGE_TYPES.find((p) => p.value === type);
  if (!pt) return `${q} vol.`;
  return `${q} ${q === 1 ? pt.singular : pt.plural}`;
}

/** "4 pallets" / "1 pallet" */
export const fmtPallets = (n: number | string | null | undefined) => {
  const q = Number(n) || 0;
  return `${q} ${q === 1 ? 'pallet' : 'pallets'}`;
};

/** Unidades da quantidade comercial do item. */
export const PIECE_UNITS = ['pçs', 'un', 'par', 'jogo', 'kg', 'm', 'm²', 'litro'];

/** Carga física do embarque (totais), independente dos itens/produtos. */
export interface PhysicalCargo { pallets: string; packages: string; package_type: string }
export const emptyPhysicalCargo: PhysicalCargo = { pallets: '', packages: '', package_type: '' };

/** "4 pallets · 320 caixas" (vazio se nada preenchido). */
export function fmtPhysicalCargo(p?: Partial<PhysicalCargo> | null): string {
  if (!p) return '';
  const parts: string[] = [];
  if (parseInt(p.pallets || '') > 0) parts.push(fmtPallets(p.pallets));
  if (parseInt(p.packages || '') > 0) parts.push(fmtPackages(p.packages, p.package_type));
  return parts.join(' · ');
}

/**
 * Linha de VOLUME físico do embarque (o que viaja): quantidade, tipo, medidas e peso
 * POR UNIDADE. É a base de peso, cubagem e peso taxado (frete). Independe dos itens/
 * produtos da invoice — um volume pode misturar vários produtos.
 */
export interface CargoVolume {
  id?: string | null;
  qty: string;
  package_type: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  /** peso bruto por unidade (kg) */
  weight_kg: string;
  /** cubagem por unidade (m³), manual — ignorada quando há C/L/A */
  volume_cbm: string;
}

export const emptyCargoVolume: CargoVolume = {
  id: null, qty: '', package_type: 'caixa', length_cm: '', width_cm: '', height_cm: '', weight_kg: '', volume_cbm: '',
};

/** FCL cobra por container; nos demais modais o peso/cubagem vêm das linhas de volume. */
export const usesVolumes = (mode: string) => mode !== 'ocean_fcl';

export function isEmptyVolume(v: CargoVolume): boolean {
  return !v.qty && !v.length_cm && !v.width_cm && !v.height_cm && !v.weight_kg && !v.volume_cbm;
}

/** Linha de volume no formato que as funções de cálculo (calcItemWeight etc.) já entendem. */
export function volumeAsCalcItem(v: CargoVolume): CargoItem {
  return {
    ...emptyCargoItem,
    packages: v.qty, weight_kg: v.weight_kg, volume_cbm: v.volume_cbm,
    length_cm: v.length_cm, width_cm: v.width_cm, height_cm: v.height_cm,
  };
}

/**
 * Itens usados nos cálculos de peso/cubagem/peso taxado: se o embarque tem linhas de
 * volume, elas mandam; senão cai no formato antigo (medidas dentro do item).
 */
export function effectiveCalcItems(mode: string, items: CargoItem[], volumes?: CargoVolume[] | null): CargoItem[] {
  if (!usesVolumes(mode)) return items;
  const filled = (volumes || []).filter((v) => !isEmptyVolume(v));
  return filled.length > 0 ? filled.map(volumeAsCalcItem) : items;
}

/** Itens antigos (peso/medidas/volumes dentro do item) → linhas de volume. */
export function legacyItemsToVolumes(items: CargoItem[], mode: string): CargoVolume[] {
  if (!usesVolumes(mode)) return [];
  return items
    .filter((it) => parseInt(it.packages) > 0 || parseFloat(it.weight_kg) > 0 || parseFloat(it.volume_cbm) > 0 ||
      (parseFloat(it.length_cm) > 0 && parseFloat(it.width_cm) > 0 && parseFloat(it.height_cm) > 0))
    .map((it) => ({
      id: null, qty: it.packages || '', package_type: '', length_cm: it.length_cm || '', width_cm: it.width_cm || '',
      height_cm: it.height_cm || '', weight_kg: it.weight_kg || '', volume_cbm: it.volume_cbm || '',
    }));
}

/** Posições (1-based) das linhas de volume preenchidas sem quantidade. */
export function getVolumesMissingQty(volumes: CargoVolume[]): number[] {
  const out: number[] = [];
  volumes.forEach((v, i) => { if (!isEmptyVolume(v) && !(parseInt(v.qty) >= 1)) out.push(i + 1); });
  return out;
}

/** "100 caixas · 40×30×20 cm · 6,9 kg/un" */
export function describeVolume(v: CargoVolume): string {
  const parts = [fmtPackages(v.qty, v.package_type || null)];
  if (parseFloat(v.length_cm) > 0 && parseFloat(v.width_cm) > 0 && parseFloat(v.height_cm) > 0) parts.push(`${v.length_cm}×${v.width_cm}×${v.height_cm} cm`);
  else if (parseFloat(v.volume_cbm) > 0) parts.push(`${v.volume_cbm} m³/un`);
  if (parseFloat(v.weight_kg) > 0) parts.push(`${v.weight_kg} kg/un`);
  return parts.join(' · ');
}

const fmtPieces = (it: { pieces?: string; pieces_unit?: string }) =>
  parseFloat(it.pieces || '') > 0 ? `${Number(it.pieces).toLocaleString('pt-BR')} ${it.pieces_unit || 'pçs'}` : '';

const CONTAINER_TYPES = ['20GP', '20HC', '40GP', '40HC', '40NOR', '20RF', '40RF', '20OT', '40OT', '20FR', '40FR'];
const VEHICLE_TYPES = ['Truck', 'Carreta', 'Bitrem', 'Rodotrem', 'Sider', 'Baú', 'Graneleiro'];

// Max payload weight (kg) and internal volume (cbm) per container type
const CONTAINER_SPECS: Record<string, { maxWeight: number; maxVolume: number }> = {
  '20GP':  { maxWeight: 21770, maxVolume: 33.2 },
  '20HC':  { maxWeight: 21570, maxVolume: 37.4 },
  '40GP':  { maxWeight: 26680, maxVolume: 67.7 },
  '40HC':  { maxWeight: 26480, maxVolume: 76.3 },
  '40NOR': { maxWeight: 26280, maxVolume: 67.7 },
  '20RF':  { maxWeight: 21250, maxVolume: 28.3 },
  '40RF':  { maxWeight: 26080, maxVolume: 59.3 },
  '20OT':  { maxWeight: 21750, maxVolume: 32.0 },
  '40OT':  { maxWeight: 26630, maxVolume: 65.0 },
  '20FR':  { maxWeight: 21750, maxVolume: 32.0 },
  '40FR':  { maxWeight: 39200, maxVolume: 62.0 },
};

export const emptyCargoItem: CargoItem = {
  id: null,
  container_type: '20GP',
  container_qty: 1,
  container_number: '',
  weight_kg: '',
  volume_cbm: '',
  chargeable_weight: '',
  length_cm: '',
  width_cm: '',
  height_cm: '',
  packages: '',
  pieces: '',
  pieces_unit: 'pçs',
  ncm_code: '',
  commodity: '',
  dangerous_goods: false,
  vehicle_type: '',
  cargo_value: '',
  cargo_value_currency: 'USD',
  notes: '',
};

function NcmField({ value, description, onCodeChange, disabled }: { value: string; description: string; onCodeChange: (code: string, desc: string) => void, disabled?: boolean }) {
  const { t } = useLanguage();
  const [ncmInput, setNcmInput] = useState(value);
  const [ncmDesc, setNcmDesc] = useState(description);
  const [loading, setLoading] = useState(false);
  const lastFetchedRef = useRef<string>(value && description ? value : '');

  useEffect(() => {
    setNcmInput(value);
    setNcmDesc(description);
    if (value && description) {
      lastFetchedRef.current = value;
    }
  }, [value, description]);

  useEffect(() => {
    if (ncmInput.length < 4) {
      setNcmDesc('');
      return;
    }
    // Skip if we already fetched this exact code and have a description
    if (lastFetchedRef.current === ncmInput && ncmDesc) {
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const desc = await fetchNcmHierarchy(ncmInput);
        if (desc) {
          setNcmDesc(desc);
          onCodeChange(ncmInput, desc);
        } else {
          setNcmDesc('');
          onCodeChange(ncmInput, '');
        }
        lastFetchedRef.current = ncmInput;
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [ncmInput, ncmDesc]);

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('quotes.ncm_code')}</Label>
      <Input
        placeholder="0000.00.00"
        value={ncmInput}
        onChange={(e) => {
          setNcmInput(e.target.value);
          onCodeChange(e.target.value, ncmDesc);
        }}
        disabled={disabled}
      />
      {loading && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}
      {!loading && ncmDesc && (
        <p className="text-xs text-muted-foreground line-clamp-2" title={ncmDesc}>{ncmDesc}</p>
      )}
    </div>
  );
}

export function calcItemCbm(item: CargoItem): number {
  const l = parseFloat(item.length_cm) || 0;
  const w = parseFloat(item.width_cm) || 0;
  const h = parseFloat(item.height_cm) || 0;
  const pkgs = parseInt(item.packages) || 1;
  if (l > 0 && w > 0 && h > 0) return (l * w * h / 1_000_000) * pkgs;
  // No fallback - return 0 so the field stays editable for manual input
  return 0;
}

/** Returns the effective volume: computed from dimensions or manual fallback */
export function getEffectiveVolume(item: CargoItem): number {
  const computed = calcItemCbm(item);
  if (computed > 0) return computed;
  // Cubagem manual (sem L/W/H): mesma regra do peso — o valor digitado é "por
  // volume", então quando há mais de 1 volume (Volumes/packages >= 2) o total
  // precisa multiplicar pela quantidade, senão a cubagem total fica subestimada.
  const manual = parseFloat(item.volume_cbm) || 0;
  const pkgs = parseInt(item.packages) || 1;
  return pkgs >= 2 ? manual * pkgs : manual;
}

/** Total weight for an item: weight_per_volume × packages (when packages >= 2) */
export function calcItemWeight(item: CargoItem): number {
  const w = parseFloat(item.weight_kg) || 0;
  const pkgs = parseInt(item.packages) || 1;
  return pkgs >= 2 ? w * pkgs : w;
}

/** Arredonda pra no máx. 2 casas (evita 27.200000000000003 de soma em ponto flutuante). */
function fmtNum(n: number, decimals = 2): string {
  const f = 10 ** decimals;
  return String(Math.round(n * f) / f);
}

/**
 * Posições (1-based) dos itens preenchidos que estão sem Volumes (packages >= 1).
 * Volumes é obrigatório porque o peso digitado é POR VOLUME — sem a quantidade
 * o peso/cubagem totais ficam errados. FCL não exige (usa container_qty).
 */
export function getItemsMissingPackages(items: CargoItem[], mode: string): number[] {
  if (mode === 'ocean_fcl') return [];
  const missing: number[] = [];
  items.forEach((it, idx) => {
    if (isEmptyCargoItem(it, mode === 'multimodal')) return;
    if (!(parseInt(it.packages) >= 1)) missing.push(idx + 1);
  });
  return missing;
}

/** Mensagem padrão de erro quando faltam Volumes (ex: "Item 2"). */
export function missingPackagesMessage(positions: number[]): string {
  return positions.length === 1
    ? `Preencha os Volumes do item ${positions[0]}.`
    : `Preencha os Volumes dos itens ${positions.join(', ')}.`;
}

/**
 * Linhas "Totais da Carga" + "Detalhamento por Item" do resumo de cotação
 * (compartilhado entre QuoteCreateModal e QuoteDetail). Peso e cubagem totais
 * usam as mesmas regras da tela (peso por volume × volumes).
 */
export function buildCargoSummaryLines(mode: string, items: CargoItem[], physical?: Partial<PhysicalCargo> | null, volumes?: CargoVolume[] | null): string[] {
  const showContainers = mode === 'ocean_fcl' || mode === 'multimodal';
  const filledVolumes = usesVolumes(mode) ? (volumes || []).filter((v) => !isEmptyVolume(v)) : [];
  const volMode = filledVolumes.length > 0;
  const calcItems = effectiveCalcItems(mode, items, volumes);
  const totalWeight = calcItems.reduce((s, i) => s + calcItemWeight(i), 0);
  const totalVolume = calcItems.reduce((s, i) => s + getEffectiveVolume(i), 0);
  const totalPackages = calcItems.reduce((s, i) => s + (parseInt(i.packages) || 0), 0);
  const totalContainers = showContainers ? items.reduce((s, i) => s + (Number(i.container_qty) || 0), 0) : 0;

  const lines: string[] = ['📊 Totais da Carga:'];
  if (showContainers && totalContainers > 0) lines.push(`  Containers: ${totalContainers}`);
  if (totalWeight > 0) lines.push(`  Peso Total: ${fmtNum(totalWeight)} kg`);
  if (totalVolume > 0) lines.push(`  Volume Total: ${totalVolume.toFixed(4)} m³`);
  if (totalPackages > 0) lines.push(`  Total Volumes: ${totalPackages}`);
  const phys = fmtPhysicalCargo(physical);
  if (phys) lines.push(`  Carga física: ${phys}`);

  if (volMode) {
    lines.push('');
    lines.push('📐 Volumes:');
    filledVolumes.forEach((v) => lines.push(`  ${describeVolume(v)}`));
  }

  lines.push('');
  lines.push('📦 Detalhamento por Item:');
  items.forEach((item, idx) => {
    const pkgs = parseInt(item.packages) || 0;
    lines.push(`  Item ${idx + 1}:`);
    if (showContainers) lines.push(`    Container: ${item.container_type} x ${item.container_qty}`);
    if (volMode) {
      if (fmtPieces(item)) lines.push(`    Quantidade: ${fmtPieces(item)}`);
      if (item.commodity) lines.push(`    Mercadoria: ${item.commodity}`);
      if (item.ncm_code) lines.push(`    NCM: ${item.ncm_code}`);
      if (item.dangerous_goods) lines.push(`    ⚠️ Carga Perigosa`);
      return;
    }
    const w = parseFloat(item.weight_kg) || 0;
    if (w > 0) {
      lines.push(pkgs >= 2
        ? `    Peso: ${fmtNum(w)} kg/vol. (total ${fmtNum(calcItemWeight(item))} kg)`
        : `    Peso: ${fmtNum(w)} kg`);
    }
    const l = parseFloat(item.length_cm), wd = parseFloat(item.width_cm), h = parseFloat(item.height_cm);
    const hasDims = !!(l && wd && h);
    if (!hasDims && item.volume_cbm) {
      lines.push(pkgs >= 2
        ? `    Volume: ${item.volume_cbm} m³/vol. (total ${getEffectiveVolume(item).toFixed(4)} m³)`
        : `    Volume: ${item.volume_cbm} m³`);
    }
    if (hasDims) {
      lines.push(`    Dimensões: ${item.length_cm} x ${item.width_cm} x ${item.height_cm} cm`);
      lines.push(`    Volume calc.: ${calcItemCbm(item).toFixed(4)} m³`);
    }
    if (pkgs > 0) lines.push(`    Volumes: ${pkgs}`);
    if (fmtPieces(item)) lines.push(`    Quantidade: ${fmtPieces(item)}`);
    if (item.commodity) lines.push(`    Mercadoria: ${item.commodity}`);
    if (item.dangerous_goods) lines.push(`    ⚠️ Carga Perigosa`);
    if (mode === 'road' && item.vehicle_type) lines.push(`    Veículo: ${item.vehicle_type}`);
  });
  return lines;
}

export function calcChargeableWeight(items: CargoItem[], mode: string): number {
  const totalWeight = items.reduce((s, i) => s + calcItemWeight(i), 0);
  const totalCbm = items.reduce((s, i) => s + getEffectiveVolume(i), 0);
  return calcChargeableWeightFromTotals(totalWeight, totalCbm, mode);
}

/** Same formula as calcChargeableWeight, but from pre-aggregated totals
 *  (used when weight comes from another source, e.g. the Cost Estimate). */
export function calcChargeableWeightFromTotals(totalWeight: number, totalCbm: number, mode: string): number {
  if (mode === 'air') {
    return Math.max(totalWeight, totalCbm * 1_000_000 / 6000);
  }
  // Ocean LCL: 1 cbm = 1000 kg
  if (mode === 'ocean_lcl') {
    return Math.max(totalWeight, totalCbm * 1000);
  }
  return totalWeight;
}

function itemTitle(item: CargoItem, mode: string): string {
  if (mode === 'ocean_fcl' || mode === 'multimodal') {
    const qty = item.container_qty || 1;
    return `${qty}x ${item.container_type || '20GP'}`;
  }
  if (mode === 'road' && item.vehicle_type) return item.vehicle_type;
  return item.commodity || 'Item sem descrição';
}

function itemSubtitle(item: CargoItem, mode: string, commercialOnly = false): string {
  const parts: string[] = [];
  if (!commercialOnly) {
    const weight = calcItemWeight(item);
    if (weight > 0) parts.push(`${weight.toLocaleString('pt-BR')} kg`);
    const cbm = getEffectiveVolume(item);
    if (cbm > 0) parts.push(`${cbm.toFixed(3)} m³`);
    if (item.packages) parts.push(`${item.packages} vol.`);
  }
  if (fmtPieces(item)) parts.push(fmtPieces(item));
  if (item.cargo_value) parts.push(`${item.cargo_value_currency || 'USD'} ${item.cargo_value}`);
  if (mode !== 'ocean_fcl' && mode !== 'multimodal' && item.ncm_code) parts.push(`NCM ${item.ncm_code}`);
  return parts.length > 0 ? parts.join(' · ') : 'Sem detalhes preenchidos';
}

function isEmptyCargoItem(it: CargoItem, showContainers: boolean): boolean {
  if (showContainers && (it.container_qty > 1 || (it.container_type && it.container_type !== '20GP'))) return false;
  return !it.weight_kg && !it.volume_cbm && !it.packages && !it.pieces && !it.ncm_code && !it.commodity &&
    !it.cargo_value && !it.notes && !it.length_cm && !it.width_cm && !it.height_cm &&
    !it.vehicle_type && !it.dangerous_goods && !it.container_number;
}

export function ModeFields({ mode, items, onChange, readOnly, saving, volumes, cargoValueTotal, cargoValueCurrency }: ModeFieldsProps) {
  const { t } = useLanguage();
  // null = nenhuma linha expandida; >=0 = editando/preenchendo items[idx]
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const showContainers = mode === 'ocean_fcl' || mode === 'multimodal';
  // Itens só comerciais quando o embarque usa linhas de volume (medidas/peso/volumes não ficam mais no item).
  const commercialOnly = usesVolumes(mode) && volumes !== undefined;
  const showDimensions = mode !== 'ocean_fcl' && !commercialOnly;
  const showVehicle = mode === 'road';

  // Sem botão "Salvar": qualquer alteração já grava direto na lista de itens.
  const updateItem = (idx: number, patch: Partial<CargoItem>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const openAddInline = () => {
    if (readOnly) return;
    const next = [...items, { ...emptyCargoItem }];
    onChange(next);
    setEditingIndex(next.length - 1);
  };

  const openEditInline = (idx: number) => {
    if (readOnly) return;
    setEditingIndex(idx);
  };

  // Fecha a linha em edição. Se o item ficou vazio (usuário abriu "Adicionar
  // Carga" e não preencheu nada), remove — não faz sentido guardar item em branco.
  const collapseInline = (idx: number) => {
    const it = items[idx];
    if (it && isEmptyCargoItem(it, showContainers)) {
      onChange(items.filter((_, i) => i !== idx));
    }
    setEditingIndex(null);
  };

  const removeItem = (index: number) => {
    if (readOnly) return;
    onChange(items.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  const calcItems = effectiveCalcItems(mode, items, volumes);
  const totalCbm = calcItems.reduce((s, i) => s + getEffectiveVolume(i), 0);
  const totalWeight = calcItems.reduce((s, i) => s + calcItemWeight(i), 0);
  const totalChargeable = calcChargeableWeight(calcItems, mode);
  const { totalUsd: totalCargoValueUsd, hasNonUsd: hasNonUsdCargoValue } = calcTotalCargoValueUsd(items);
  const typedValueTotal = parseFloat(cargoValueTotal || '') || 0;

  // Formulário compacto, renderizado inline dentro da própria linha do item.
  // IMPORTANTE: isso é uma função comum que retorna JSX (não um componente
  // React separado) — se fosse um componente `<InlineForm/>` declarado aqui
  // dentro, ele seria recriado a cada digitação (novo tipo a cada render) e
  // o React remontaria o formulário inteiro, fazendo o campo perder o foco
  // a cada letra digitada.
  const renderInlineForm = (idx: number) => {
    const item = items[idx];
    const fieldLabelCls = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
    return (
      <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">Editando item</p>
            {saving && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />}
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Recolher item" onClick={() => collapseInline(idx)}>
            <ChevronUp className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Container (só FCL/multimodal) */}
        {showContainers && (
          <div className="space-y-1.5">
            <Label className={fieldLabelCls}>{t('quotes.container_type')}</Label>
            <div className="grid grid-cols-2 gap-2.5">
              <Select value={item.container_type} onValueChange={(v) => updateItem(idx, { container_type: v })}>
                <SelectTrigger><SelectValue placeholder="20GP" /></SelectTrigger>
                <SelectContent>
                  {CONTAINER_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                inputMode="numeric"
                placeholder="Quantidade"
                value={item.container_qty}
                onChange={(e) => updateItem(idx, { container_qty: parseInt(e.target.value) || 1 })}
              />
            </div>
            {CONTAINER_SPECS[item.container_type] && (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5 flex gap-4">
                <span>⚖️ Máx: <strong>{CONTAINER_SPECS[item.container_type].maxWeight.toLocaleString()} kg</strong></span>
                <span>📦 Máx: <strong>{CONTAINER_SPECS[item.container_type].maxVolume} m³</strong></span>
              </div>
            )}
          </div>
        )}

        {/* Vehicle type (só Rodoviário) */}
        {showVehicle && (
          <div className="space-y-1.5">
            <Label className={fieldLabelCls}>{t('quotes.vehicle_type')}</Label>
            <Select value={item.vehicle_type} onValueChange={(v) => updateItem(idx, { vehicle_type: v })}>
              <SelectTrigger><SelectValue placeholder={t('quotes.vehicle_type')} /></SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Linha 1: Comprimento - Largura - Altura */}
        {showDimensions && (
          <div className="grid grid-cols-3 gap-2.5">
            <div className="space-y-1.5">
              <Label className={fieldLabelCls}>{t('quotes.length_cm')}</Label>
              <Input inputMode="decimal" placeholder="0" value={item.length_cm} onChange={(e) => updateItem(idx, { length_cm: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className={fieldLabelCls}>{t('quotes.width_cm')}</Label>
              <Input inputMode="decimal" placeholder="0" value={item.width_cm} onChange={(e) => updateItem(idx, { width_cm: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className={fieldLabelCls}>{t('quotes.height_cm')}</Label>
              <Input inputMode="decimal" placeholder="0" value={item.height_cm} onChange={(e) => updateItem(idx, { height_cm: e.target.value })} />
            </div>
          </div>
        )}

        {/* Quantidade comercial do produto (peças) — independe de caixas/pallets, que são totais do embarque */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <Label className={fieldLabelCls}>Quantidade (peças)</Label>
            <Input
              inputMode="decimal"
              placeholder="0"
              value={item.pieces ?? ''}
              onChange={(e) => updateItem(idx, { pieces: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={fieldLabelCls}>Unidade</Label>
            <Select value={item.pieces_unit || 'pçs'} onValueChange={(v) => updateItem(idx, { pieces_unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PIECE_UNITS.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Linha 2: Quantidade - Peso - Cubagem (só no formato antigo; com linhas de volume ficam nos totais do embarque) */}
        {!commercialOnly && (
        <div className="grid grid-cols-3 gap-2.5">
          {mode !== 'ocean_fcl' && (
            <div className="space-y-1.5">
              <Label className={fieldLabelCls}>{t('quotes.packages')} <span className="text-destructive">*</span></Label>
              <Input
                inputMode="numeric"
                placeholder="1"
                value={item.packages}
                className={!readOnly && !isEmptyCargoItem(item, showContainers) && !(parseInt(item.packages) >= 1) ? 'border-destructive focus-visible:ring-destructive' : ''}
                onChange={(e) => updateItem(idx, { packages: e.target.value })}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className={fieldLabelCls}>
              {(parseInt(item.packages) || 0) >= 2 ? `${t('quotes.weight_kg')}/vol.` : t('quotes.weight_kg')}
            </Label>
            <Input
              inputMode="decimal"
              placeholder={showContainers && CONTAINER_SPECS[item.container_type] ? `Máx ${CONTAINER_SPECS[item.container_type].maxWeight.toLocaleString()}` : '0'}
              value={item.weight_kg}
              onChange={(e) => updateItem(idx, { weight_kg: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={fieldLabelCls}>{t('quotes.volume_cbm')}</Label>
            {(() => {
              const computed = calcItemCbm(item);
              const displayValue = computed > 0 ? computed.toFixed(4) : item.volume_cbm;
              const isComputed = computed > 0;
              return (
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={displayValue}
                  readOnly={isComputed}
                  className={isComputed ? 'bg-muted/50' : ''}
                  onChange={(e) => {
                    if (!isComputed) updateItem(idx, { volume_cbm: e.target.value });
                  }}
                />
              );
            })()}
          </div>
        </div>
        )}

        {/* Linha 3: Moeda/Valor da Carga - NCM - Carga Perigosa */}
        <div className="grid grid-cols-3 gap-2.5 items-start">
          <div className="space-y-1.5">
            <Label className={fieldLabelCls}>{commercialOnly ? 'Valor do item (invoice)' : 'Valor da Carga'}</Label>
            <div className="flex gap-1.5">
              <Select value={item.cargo_value_currency || 'USD'} onValueChange={(v) => updateItem(idx, { cargo_value_currency: v })}>
                <SelectTrigger className="w-16 shrink-0 px-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['USD', 'BRL', 'EUR', 'GBP', 'CNY'].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input inputMode="decimal" placeholder="0.00" value={item.cargo_value} onChange={(e) => updateItem(idx, { cargo_value: e.target.value })} />
            </div>
          </div>
          <NcmField
            value={item.ncm_code}
            description={item.commodity}
            onCodeChange={(code, desc) => updateItem(idx, { ncm_code: code, commodity: desc })}
          />
          <div className="space-y-1.5">
            <Label className={fieldLabelCls}>{t('quotes.dangerous_goods')}</Label>
            <label className="flex items-center gap-2 rounded-md border h-10 px-2.5 cursor-pointer select-none hover:bg-accent/40 transition-colors bg-background">
              <Checkbox
                checked={item.dangerous_goods}
                onCheckedChange={(v) => updateItem(idx, { dangerous_goods: !!v })}
              />
              <span className="text-sm">IMO</span>
            </label>
          </div>
        </div>

        {/* Notes / Observações */}
        <div className="space-y-1.5">
          <Label className={fieldLabelCls}>Observações</Label>
          <Input placeholder="Detalhes adicionais da carga..." value={item.notes} onChange={(e) => updateItem(idx, { notes: e.target.value })} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {commercialOnly && (
        <div className="rounded-lg border border-dashed bg-muted/10 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Itens da invoice · usados no desembaraço</p>
          <p className="text-[11px] text-muted-foreground">Mercadoria, NCM, quantidade de peças e valor de cada produto. Servem para a DUIMP e a Estimativa; o frete e a cotação usam a carga física acima.</p>
        </div>
      )}
      {/* Totais calculados + botão Adicionar, na mesma linha */}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm min-h-[20px]">
          {items.length > 0 || calcItems.length > 0 ? (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('quotes.totals')}</span>
              <span>{t('quotes.weight_kg')}: <strong className="font-mono">{totalWeight.toFixed(2)}</strong></span>
              <span>{t('quotes.total_cbm')}: <strong className="font-mono">{totalCbm.toFixed(4)}</strong> m³</span>
              {(mode === 'air' || mode === 'ocean_lcl') && (
                <span>{t('quotes.total_chargeable')}: <strong className="font-mono">{totalChargeable.toFixed(2)}</strong> kg</span>
              )}
              {typedValueTotal > 0 ? (
                <span>
                  Valor Total da Carga: <strong className="font-mono">{cargoValueCurrency || 'USD'} {typedValueTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </span>
              ) : totalCargoValueUsd > 0 && (
                <span title={hasNonUsdCargoValue ? 'Itens em outra moeda não estão somados aqui' : undefined}>
                  Valor Total da Carga: <strong className="font-mono">US$ {totalCargoValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  {hasNonUsdCargoValue && <span className="text-amber-600">*</span>}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Nenhuma carga adicionada ainda</span>
          )}
        </div>
        {!readOnly && editingIndex === null && (
          <Button type="button" size="sm" className="gap-2 shrink-0" onClick={openAddInline}>
            <Plus className="w-4 h-4" /> Adicionar Carga
          </Button>
        )}
      </div>

      {/* Lista organizada dos itens */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
            Nenhuma carga adicionada ainda. Clique em "Adicionar Carga" acima para começar.
          </div>
        ) : (
          items.map((item, idx) => (
            editingIndex === idx ? (
              <div key={idx}>{renderInlineForm(idx)}</div>
            ) : (
              <div key={idx} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary/50">
                <button
                  type="button"
                  onClick={() => openEditInline(idx)}
                  disabled={readOnly}
                  className="flex-1 min-w-0 flex items-center gap-3 text-left disabled:cursor-default"
                >
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary shrink-0">
                    <Package className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium truncate">{itemTitle(item, mode)}</p>
                      {item.dangerous_goods && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-destructive/40 text-destructive gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" /> IMO
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{itemSubtitle(item, mode, commercialOnly)}</p>
                  </div>
                </button>
                {!readOnly && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditInline(idx)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(idx)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            )
          ))
        )}
      </div>
    </div>
  );
}

export type { CargoItem };

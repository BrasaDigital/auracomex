import { createContext, useContext, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { addMonths, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface MonthSelectProps {
  /** 'yyyy-MM' ou 'todos' (quando allowAll). */
  value: string;
  onChange: (value: string) => void;
  /** Mostra a opção "Todos os meses" no topo. */
  allowAll?: boolean;
  /** Meses 'yyyy-MM' que já têm lançamento — entram na lista mesmo fora da janela padrão. */
  extraMonths?: string[];
  className?: string;
  title?: string;
}

/**
 * Posição fixa do seletor de mês: a página (Movimentações) provê o elemento da linha do submenu,
 * alinhado à direita. undefined = fora da página (renderiza no próprio lugar); null = página
 * montando o slot (não renderiza ainda); elemento = renderiza nele via portal.
 */
export const MonthSlotContext = createContext<HTMLElement | null | undefined>(undefined);

/**
 * Seletor de mês padrão do Financeiro (Valores a Pagar, Valores a Receber,
 * Geral e Visão Geral). Janela de 12 meses atrás até 2 à frente, mais qualquer
 * mês que já tenha lançamento (pra nunca esconder dado antigo).
 */
export function MonthSelect(props: MonthSelectProps) {
  const slot = useContext(MonthSlotContext);
  const el = <MonthSelectBase {...props} />;
  if (slot === undefined) return el;
  if (slot === null) return null;
  return createPortal(el, slot);
}

export interface MonthRange {
  /** 'yyyy-MM' ou 'todos'. */
  from: string;
  /** 'yyyy-MM' (igual a `from` quando 'todos'). */
  to: string;
}

/** Período de um único mês (o mês atual por padrão). */
export function currentMonthRange(): MonthRange {
  const m = format(new Date(), 'yyyy-MM');
  return { from: m, to: m };
}

/** `ym` ('yyyy-MM') está dentro do período? 'todos' = sempre. */
export function monthInRange(ym: string | null | undefined, range: MonthRange): boolean {
  if (range.from === 'todos') return true;
  if (!ym) return false;
  const k = ym.slice(0, 7);
  return k >= range.from && k <= range.to;
}

/** Rótulo curto pros cards: 'mês', 'período' ou 'todos os meses'. */
export function monthRangeLabel(range: MonthRange): string {
  if (range.from === 'todos') return 'todos os meses';
  return range.from === range.to ? 'mês' : 'período';
}

interface MonthRangeSelectProps {
  value: MonthRange;
  onChange: (value: MonthRange) => void;
  extraMonths?: string[];
  title?: string;
}

/**
 * Seletor de período de meses (De / Até). "Todos os meses" no "De" limpa o filtro.
 * Mantém sempre De <= Até (ajustando o outro lado quando cruzam).
 */
export function MonthRangeSelect(props: MonthRangeSelectProps) {
  const slot = useContext(MonthSlotContext);
  const el = <MonthRangeSelectBase {...props} />;
  if (slot === undefined) return el;
  if (slot === null) return null;
  return createPortal(el, slot);
}

function MonthRangeSelectBase({ value, onChange, extraMonths = [], title }: MonthRangeSelectProps) {
  const all = value.from === 'todos';
  function setFrom(v: string) {
    if (v === 'todos') return onChange({ from: 'todos', to: 'todos' });
    onChange({ from: v, to: all || value.to < v ? v : value.to });
  }
  function setTo(v: string) {
    onChange({ from: all || value.from > v ? v : value.from, to: v });
  }
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <span className="text-xs text-muted-foreground">De</span>
      <MonthSelectBase value={value.from} onChange={setFrom} allowAll extraMonths={extraMonths} className="w-40" />
      <span className="text-xs text-muted-foreground">até</span>
      {all ? (
        <div className="h-10 w-40 rounded-md border border-input bg-muted/40 px-3 flex items-center text-sm text-muted-foreground">Todos os meses</div>
      ) : (
        <MonthSelectBase value={value.to} onChange={setTo} extraMonths={extraMonths} className="w-40" />
      )}
    </div>
  );
}

function MonthSelectBase({ value, onChange, allowAll = false, extraMonths = [], className = 'w-44', title }: MonthSelectProps) {
  const extraKey = extraMonths.join(',');
  const options = useMemo(() => {
    const set = new Set<string>();
    const base = new Date();
    for (let i = -2; i <= 12; i++) set.add(format(addMonths(base, -i), 'yyyy-MM'));
    for (const ym of extraMonths) if (ym) set.add(ym);
    if (value && value !== 'todos') set.add(value);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((ym) => {
        const label = format(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1), 'MMMM/yyyy', { locale: ptBR });
        return { value: ym, label: label.charAt(0).toUpperCase() + label.slice(1) };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraKey, value]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value="todos">Todos os meses</SelectItem>}
        {options.map((m) => (
          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

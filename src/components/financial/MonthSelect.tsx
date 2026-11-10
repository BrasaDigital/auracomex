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

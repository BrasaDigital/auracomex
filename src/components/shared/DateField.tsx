import { useEffect, useState } from 'react';
import { format, isValid, parse } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Campo de data com DOIS jeitos de preencher: digitar (dd/mm/aaaa, com máscara)
// ou escolher no calendário (botão à direita). Substitui o padrão antigo de
// "botão que só abre o calendário".

function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

// Só aceita data completa e real (rejeita 31/02, ano < 1900 etc.).
function parseDate(text: string): Date | null {
  if (text.length !== 10) return null;
  const d = parse(text, 'dd/MM/yyyy', new Date());
  if (!isValid(d) || d.getFullYear() < 1900 || format(d, 'dd/MM/yyyy') !== text) return null;
  return d;
}

interface DateFieldProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  size?: 'default' | 'sm';
  disabled?: boolean;
  // Se false, apagar o texto não limpa o valor (volta ao anterior ao sair do campo).
  allowClear?: boolean;
}

export function DateField({ value, onChange, placeholder = 'dd/mm/aaaa', className, size = 'default', disabled, allowClear = true }: DateFieldProps) {
  const [text, setText] = useState(value ? format(value, 'dd/MM/yyyy') : '');
  const [open, setOpen] = useState(false);

  // Mantém o texto em sincronia quando o valor muda por fora (calendário, reset do form).
  const valueKey = value ? format(value, 'yyyy-MM-dd') : '';
  useEffect(() => {
    setText(value ? format(value, 'dd/MM/yyyy') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = maskDate(e.target.value);
    setText(masked);
    const parsed = parseDate(masked);
    if (parsed) onChange(parsed);
    else if (masked === '' && allowClear) onChange(undefined);
  }

  function handleBlur() {
    // Texto incompleto/inválido: volta para a última data válida.
    if (!parseDate(text)) setText(value ? format(value, 'dd/MM/yyyy') : '');
  }

  const sm = size === 'sm';
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Input
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        inputMode="numeric"
        maxLength={10}
        disabled={disabled}
        className={cn('flex-1 min-w-0', sm ? 'h-8 text-xs' : 'h-10')}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            title="Abrir calendário"
            className={cn('shrink-0', sm ? 'h-8 w-8' : 'h-10 w-10')}
          >
            <CalendarIcon className={sm ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value}
            onSelect={(d) => {
              if (d) { onChange(d); setOpen(false); }
              else if (allowClear) { onChange(undefined); setOpen(false); }
            }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

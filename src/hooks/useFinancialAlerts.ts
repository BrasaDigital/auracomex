import { useQuery } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

/** Dias à frente (contando hoje) considerados "a vencer" no alerta do menu Financeiro. */
export const DIAS_A_VENCER = 3;

/**
 * Alertas de contas a pagar do menu Financeiro:
 *  - overdueCount: em aberto e já vencidas (vencimento antes de hoje);
 *  - dueSoonCount: em aberto e que vencem de hoje até daqui a 3 dias.
 * As datas usam o dia local do usuário (não o dia UTC), para não virar o dia antes da hora à noite.
 */
export function useFinancialAlerts(companyId?: string | null) {
  const { data: overdueCount = 0 } = useQuery({
    queryKey: ['sidebar-overdue-payables', companyId],
    queryFn: async () => {
      const hoje = format(new Date(), 'yyyy-MM-dd');
      const { count } = await supabase
        .from('accounts_payable' as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'aberto')
        .lt('due_date', hoje);
      return count ?? 0;
    },
    enabled: !!companyId,
    refetchInterval: 60_000,
  });

  const { data: dueSoonCount = 0 } = useQuery({
    queryKey: ['sidebar-due-soon-payables', companyId],
    queryFn: async () => {
      const agora = new Date();
      const hoje = format(agora, 'yyyy-MM-dd');
      const limite = format(addDays(agora, DIAS_A_VENCER), 'yyyy-MM-dd');
      const { count } = await supabase
        .from('accounts_payable' as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'aberto')
        .gte('due_date', hoje)
        .lte('due_date', limite);
      return count ?? 0;
    },
    enabled: !!companyId,
    refetchInterval: 60_000,
  });

  return { overdueCount, dueSoonCount };
}

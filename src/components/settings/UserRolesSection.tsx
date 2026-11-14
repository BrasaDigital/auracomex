import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Power, PowerOff, KeyRound, Loader2 } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { ROLE_LABELS, getAssignableRolesForPlan } from '@/hooks/usePermissions';
import { useSubscription } from '@/hooks/useSubscription';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

const ALL_ASSIGNABLE_ROLES: AppRole[] = [
  'admin', 'diretor', 'gerente',
  'coordenador_comercial', 'inside',
  'coordenador_operacional', 'operator',
  'coordenador_financeiro', 'financeiro',
  'salesperson', 'viewer',
];

export function UserRolesSection() {
  const { t, language } = useLanguage();
  const { profile, user } = useAuth();
  const { data: sub } = useSubscription();
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState<string | null>(null);

  const ASSIGNABLE_ROLES = getAssignableRolesForPlan(ALL_ASSIGNABLE_ROLES, sub?.plan);
  const isBasicPlan = sub?.plan === 'starter';

  const { data: users = [] } = useQuery({
    queryKey: ['company-users', profile?.company_id],
    queryFn: async () => {
      if (!profile) return [];
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .eq('company_id', profile.company_id)
        .order('full_name');
      if (error) throw error;

      // Papéis: lidos pela função manage-user, porque o banco só deixa quem não é superadmin ler a PRÓPRIA linha de
      // user_roles (a leitura direta mostrava "operator" para todos os outros). Se a função falhar, cai na leitura
      // direta (comportamento antigo).
      const userIds = (profiles || []).map((p) => p.user_id);
      const roleMap: Record<string, string> = {};
      try {
        const { data: rolesData, error: rolesError } = await supabase.functions.invoke('manage-user', {
          body: { action: 'list_roles', user_ids: userIds },
        });
        if (rolesError || !rolesData?.roles) throw rolesError || new Error('sem papéis');
        Object.assign(roleMap, rolesData.roles);
      } catch {
        const { data: roles } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in('user_id', userIds);
        (roles || []).forEach((r) => { roleMap[r.user_id] = r.role; });
      }

      const filtered = (profiles || [])
        .filter((p) => roleMap[p.user_id] !== 'superadmin')
        .map((p) => ({
          ...p,
          role: roleMap[p.user_id] || 'operator',
        }));

      let statuses: Record<string, boolean> = {};
      try {
        const { data } = await supabase.functions.invoke('manage-user', {
          body: { action: 'list_status', user_ids: filtered.map((u) => u.user_id) },
        });
        statuses = data?.statuses || {};
      } catch {/* ignore */}

      return filtered.map((u) => ({ ...u, active: statuses[u.user_id] ?? true }));
    },
    enabled: !!profile,
  });

  async function handleRoleChange(userId: string, newRole: AppRole) {
    // A troca passa pela função manage-user (o banco só deixa o superadmin escrever em user_roles).
    try {
      const { data, error } = await supabase.functions.invoke('manage-user', {
        body: { action: 'set_role', user_id: userId, role: newRole },
      });
      if (error) {
        let msg = error.message;
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* mantém a mensagem genérica */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
    } catch (err: any) {
      toast.error(err.message);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['company-users'] });
    toast.success(t('settings.role_updated'));
  }

  async function handleToggleActive(userId: string, nextActive: boolean) {
    try {
      const { data, error } = await supabase.functions.invoke('manage-user', {
        body: { action: 'toggle_active', user_id: userId, active: nextActive },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(nextActive ? 'Usuário ativado' : 'Usuário desativado');
      queryClient.invalidateQueries({ queryKey: ['company-users'] });
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleResetPassword(email: string, userId: string) {
    setResetting(userId);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/first-access',
      });
      if (error) throw error;
      toast.success(`Email de recuperação enviado para ${email}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setResetting(null);
    }
  }

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>{t('settings.users')}</CardTitle>
        {isBasicPlan && (
          <p className="text-xs text-muted-foreground">
            Plano Básico oferece papéis simples. Faça upgrade para Professional para liberar coordenadores, diretoria e vendedor com comissão.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {users.map((u) => (
          <div key={u.user_id} className="flex items-center gap-3 justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {u.full_name}
                {!u.active && <span className="ml-2 text-xs text-destructive">(inativo)</span>}
              </p>
              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
            </div>
            <Select
              value={u.role}
              onValueChange={(v) => handleRoleChange(u.user_id, v as AppRole)}
            >
              <SelectTrigger className="w-48 shrink-0">
                <SelectValue placeholder={t('settings.select_role')} />
              </SelectTrigger>
              <SelectContent>
                {(ASSIGNABLE_ROLES.includes(u.role as AppRole) ? ASSIGNABLE_ROLES : [...ASSIGNABLE_ROLES, u.role as AppRole]).map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]?.[language] || role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {u.user_id !== user?.id && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  title={`Enviar recuperação de senha para ${u.email}`}
                  disabled={resetting === u.user_id}
                  onClick={() => handleResetPassword(u.email, u.user_id)}
                >
                  {resetting === u.user_id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <KeyRound className="w-4 h-4" />}
                </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0"
                    title={u.active ? 'Desativar usuário' : 'Ativar usuário'}
                  >
                    {u.active ? <PowerOff className="w-4 h-4 text-destructive" /> : <Power className="w-4 h-4 text-emerald-500" />}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{u.active ? 'Desativar usuário?' : 'Ativar usuário?'}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {u.active
                        ? `${u.full_name} não conseguirá mais fazer login até ser reativado.`
                        : `${u.full_name} voltará a ter acesso ao sistema.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleToggleActive(u.user_id, !u.active)}>
                      Confirmar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              </>
            )}
          </div>
        ))}
        {users.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('common.no_data')}</p>
        )}
      </CardContent>
    </Card>
  );
}

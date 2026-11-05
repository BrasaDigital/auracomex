import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { toast } from 'sonner';

function sessionMarkerKey(userId: string) {
  return `aura_session_marker:${userId}`;
}

interface Profile {
  id: string;
  user_id: string;
  company_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  language: string;
  department: string | null;
  must_change_password: boolean;
  estimateEnabled: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: string | null;
  loading: boolean;
  isSuperadmin: boolean;
  /** The company the superadmin is currently accessing (null = admin panel) */
  activeCompanyId: string | null;
  activeCompanyName: string | null;
  /** Switch superadmin into a company context (updates profile.company_id in DB) */
  switchCompany: (companyId: string, companyName: string) => Promise<void>;
  /** Return superadmin to admin panel (restores original company_id) */
  exitCompany: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [activeCompanyName, setActiveCompanyName] = useState<string | null>(null);
  const [originalCompanyId, setOriginalCompanyId] = useState<string | null>(null);
  const mySessionIdRef = useRef<string | null>(null);

  // Garante que esta aba/dispositivo tenha uma marca de sessão própria, e a reivindica
  // no banco se ainda não houver nenhuma marca local salva (ex: primeira carga após o
  // recurso ser ativado). Logins explícitos (signIn) sempre geram uma marca nova.
  async function claimSessionIfNeeded(userId: string) {
    const existing = localStorage.getItem(sessionMarkerKey(userId));
    if (existing) {
      mySessionIdRef.current = existing;
      return;
    }
    const marker = crypto.randomUUID();
    mySessionIdRef.current = marker;
    localStorage.setItem(sessionMarkerKey(userId), marker);
    await supabase.from('profiles').update({ active_session_id: marker } as any).eq('user_id', userId);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        claimSessionIfNeeded(session.user.id);
        fetchProfile(session.user.id);
      } else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        if (_event === 'SIGNED_IN') {
          // Registra o acesso em background (best-effort)
          supabase.functions.invoke('log-access').catch(() => {});
        }
      }
      else {
        setProfile(null);
        setRole(null);
        setActiveCompanyId(null);
        setActiveCompanyName(null);
        setOriginalCompanyId(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Escuta em tempo real a marca de sessão do próprio usuário. Se ela mudar para um
  // valor diferente do desta aba, significa que a conta foi logada em outro lugar —
  // encerra a sessão local imediatamente (sem revogar a sessão nova, que é a legítima).
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`profile-session-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const newMarker = (payload.new as any)?.active_session_id as string | null;
          if (newMarker && mySessionIdRef.current && newMarker !== mySessionIdRef.current) {
            toast.error('Sua conta foi acessada em outro lugar. Esta sessão foi encerrada.');
            localStorage.removeItem(sessionMarkerKey(user.id));
            mySessionIdRef.current = null;
            supabase.auth.signOut({ scope: 'local' });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  async function fetchProfile(userId: string) {
    // Fetch profile and role in parallel to reduce roundtrips
    const [profileResult, roleResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, user_id, company_id, full_name, email, avatar_url, language, department, must_change_password')
        .eq('user_id', userId)
        .single(),
      supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single(),
    ]);

    const data = profileResult.data;
    const roleData = roleResult.data;
    setRole(roleData?.role || null);

    // Fetch estimate-feature flag only if profile exists
    let estimateEnabled = false;
    if (data) {
      const { data: companyData } = await supabase
        .from('companies')
        .select('estimate_enabled')
        .eq('id', (data as any).company_id)
        .single();
      estimateEnabled = !!(companyData as any)?.estimate_enabled;
    }

    setProfile(data ? { ...(data as any), estimateEnabled } as Profile : null);

    // Store the original company_id for superadmin
    if (roleData?.role === 'superadmin' && data) {
      setOriginalCompanyId((data as any).company_id);
    }

    setLoading(false);
  }

  const switchCompany = useCallback(async (companyId: string, companyName: string) => {
    if (!profile || role !== 'superadmin') return;

    // Save original company_id if not already saved
    if (!originalCompanyId) {
      setOriginalCompanyId(profile.company_id);
    }

    // Update profile.company_id in DB so RLS policies work
    const { error } = await supabase
      .from('profiles')
      .update({ company_id: companyId })
      .eq('user_id', profile.user_id);

    if (error) throw error;

    setProfile({ ...profile, company_id: companyId });
    setActiveCompanyId(companyId);
    setActiveCompanyName(companyName);
  }, [profile, role, originalCompanyId]);

  const exitCompany = useCallback(async () => {
    if (!profile || !originalCompanyId) return;

    const { error } = await supabase
      .from('profiles')
      .update({ company_id: originalCompanyId })
      .eq('user_id', profile.user_id);

    if (error) throw error;

    setProfile({ ...profile, company_id: originalCompanyId });
    setActiveCompanyId(null);
    setActiveCompanyName(null);
  }, [profile, originalCompanyId]);

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      // Nova marca de sessão para esta aba/dispositivo — grava no perfil e
      // dispara o evento em tempo real que derruba qualquer sessão antiga
      // aberta em outro lugar com a mesma conta.
      const marker = crypto.randomUUID();
      mySessionIdRef.current = marker;
      localStorage.setItem(sessionMarkerKey(data.user.id), marker);
      await supabase.from('profiles').update({ active_session_id: marker } as any).eq('user_id', data.user.id);
      // Defesa extra: revoga os refresh tokens das outras sessões WEB dessa conta,
      // para que não consigam renovar o login depois. Usa uma função própria em vez
      // de signOut({ scope: 'others' }) porque esta derrubava também as sessões do
      // conector MCP/agentes (OAuth), que precisam continuar ativas.
      await supabase.rpc('revoke_other_web_sessions' as any).then(() => {}, () => {});
    }
    return { error: error as Error | null };
  }

  async function signOut() {
    // Estas chamadas ao banco são "best-effort": se qualquer uma delas falhar
    // (RLS, rede, etc.), o logout em si (auth.signOut) não pode ficar preso —
    // por isso cada uma tem seu próprio catch, em vez de deixar a exceção
    // subir e abortar a função antes de chegar no signOut de verdade.

    // Restore original company_id before signing out
    if (originalCompanyId && profile) {
      await supabase
        .from('profiles')
        .update({ company_id: originalCompanyId })
        .eq('user_id', profile.user_id)
        .then(() => {}, () => {});
    }
    if (user) {
      localStorage.removeItem(sessionMarkerKey(user.id));
      await supabase.from('profiles').update({ active_session_id: null } as any).eq('user_id', user.id).then(() => {}, () => {});
    }
    mySessionIdRef.current = null;

    try {
      // 'local': encerra só esta sessão. O signOut() padrão é global e revogaria
      // também as sessões do conector MCP/agentes dessa conta.
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Mesmo se a revogação no servidor falhar (ex: sem rede), limpa a sessão local.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }

    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
    setActiveCompanyId(null);
    setActiveCompanyName(null);
    setOriginalCompanyId(null);
  }

  const isSuperadmin = role === 'superadmin';

  return (
    <AuthContext.Provider value={{
      user, session, profile, role, loading, isSuperadmin,
      activeCompanyId, activeCompanyName,
      switchCompany, exitCompany,
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

import { useState, useEffect, Fragment } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown, ArrowLeft, LifeBuoy } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { cn } from '@/lib/utils';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SupportSheet } from '@/components/support/SupportButton';
import { useReleases } from '@/hooks/useReleases';
import { allNavItems } from './AppSidebar';

/**
 * Barra lateral do "visual Porto" (versão de teste). Mesmas rotas, permissões e
 * comportamentos da barra atual; muda a forma: marca compacta no topo, itens em
 * três grupos separados por filete, marcador âmbar no item ativo e o câmbio sai
 * daqui (vai para a barra de cima).
 */
const GRUPOS: string[][] = [
  ['nav.dashboard', 'nav.quotes', 'nav.shipments'],
  ['nav.financial', 'nav.registrations'],
  ['nav.settings'],
];

export function AppSidebarPorto() {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1024,
  );
  const [supportOpen, setSupportOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setCollapsed(true);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const { t } = useLanguage();
  const { isSuperadmin, activeCompanyName, exitCompany, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const queryClient = useQueryClient();
  const { buildVersion } = useReleases();

  useEffect(() => {
    if (location.pathname.startsWith('/financial')) setFinancialOpen(true);
  }, [location.pathname]);

  const { data: company } = useQuery({
    queryKey: ['company', profile?.company_id],
    queryFn: async () => {
      if (!profile) return null;
      const { data } = await supabase.from('companies').select('*').eq('id', profile.company_id).single();
      return data;
    },
    enabled: !!profile,
  });

  const { data: overdueCount = 0 } = useQuery({
    queryKey: ['sidebar-overdue-payables', profile?.company_id],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { count } = await supabase
        .from('accounts_payable' as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'aberto')
        .lt('due_date', today);
      return count ?? 0;
    },
    enabled: !!profile?.company_id,
    refetchInterval: 60_000,
  });

  const logoUrl = (company as any)?.logo_url as string | undefined;
  const companyName = company?.name || 'Aura Comex';
  const navItems = allNavItems.filter((item) => (permissions as any)[item.permission]);

  async function handleExitCompany() {
    await exitCompany();
    queryClient.clear();
    navigate('/admin');
  }

  const path = location.pathname;
  const itemClass = (ativo: boolean) =>
    cn(
      'relative flex items-center gap-3 h-10 text-sm font-medium transition-colors',
      collapsed ? 'justify-center px-0' : 'px-4',
      ativo
        ? 'bg-sidebar-accent text-sidebar-foreground'
        : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
    );
  const marcador = (ativo: boolean) =>
    ativo ? <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-sidebar-primary" /> : null;

  return (
    <aside
      data-tour="sidebar"
      className={cn(
        'flex flex-col h-screen bg-sidebar text-sidebar-foreground transition-all duration-300 shrink-0',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Marca */}
      <div
        className={cn(
          'border-b border-sidebar-border flex flex-col justify-center',
          collapsed ? 'items-center h-16 px-2' : 'px-4 py-4 min-h-[5rem]',
        )}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={companyName}
            title={companyName}
            className={cn('object-contain object-left', collapsed ? 'w-10 h-10' : 'max-h-14 max-w-full')}
          />
        ) : collapsed ? (
          <span className="porto-display text-2xl font-extrabold text-sidebar-primary leading-none">A</span>
        ) : (
          <span className="porto-display text-3xl font-extrabold uppercase leading-none tracking-wide">
            Aura <span className="text-sidebar-primary">Comex</span>
          </span>
        )}
        {!collapsed && buildVersion && (
          <span className="text-[10px] text-sidebar-foreground/45 mt-2 tabular-nums">v{buildVersion}</span>
        )}
      </div>

      {/* Superadmin dentro de uma empresa */}
      {isSuperadmin && activeCompanyName && (
        <button
          onClick={handleExitCompany}
          title={`Voltar ao Painel (${activeCompanyName})`}
          className={cn(
            'flex items-center gap-2 border-b border-sidebar-border bg-sidebar-primary/10 text-sidebar-primary hover:bg-sidebar-primary/20 transition-colors',
            collapsed ? 'justify-center h-10' : 'px-4 py-2.5 text-left',
          )}
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          {!collapsed && (
            <span className="min-w-0">
              <span className="block text-[11px] text-sidebar-foreground/60">Acessando</span>
              <span className="block text-xs font-medium truncate">{activeCompanyName}</span>
            </span>
          )}
        </button>
      )}

      {/* Navegação */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {GRUPOS.map((grupo, gi) => {
          const itens = navItems.filter((i) => grupo.includes(i.key));
          if (itens.length === 0) return null;
          return (
            <Fragment key={gi}>
              {gi > 0 && <div className="my-2 mx-4 border-t border-sidebar-border" />}
              {itens.map((item) => {
                const filhos = (item as any).children as { key: string; path: string }[] | undefined;
                if (filhos) {
                  const paiAtivo = path.startsWith('/financial');
                  return (
                    <div key={item.key}>
                      <button
                        type="button"
                        onClick={() => {
                          navigate(item.path);
                          if (!collapsed) setFinancialOpen(true);
                        }}
                        title={collapsed ? t(item.key) : undefined}
                        className={cn(itemClass(paiAtivo), 'w-full')}
                      >
                        {marcador(paiAtivo)}
                        <item.icon className="w-[18px] h-[18px] shrink-0" />
                        {!collapsed && <span className="flex-1 text-left">{t(item.key)}</span>}
                        {!collapsed && (
                          <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 transition-transform', financialOpen && 'rotate-180')} />
                        )}
                        {overdueCount > 0 && (
                          <span
                            className={cn(
                              'text-[10px] font-bold bg-destructive text-white tabular-nums',
                              collapsed
                                ? 'absolute top-1.5 right-2 min-w-4 h-4 px-1 flex items-center justify-center rounded-sm'
                                : 'px-1.5 py-0.5 min-w-[20px] text-center rounded-sm',
                            )}
                            title={`${overdueCount} conta(s) vencida(s)`}
                          >
                            {overdueCount}
                          </span>
                        )}
                      </button>
                      {!collapsed && financialOpen && (
                        <div className="ml-[26px] border-l border-sidebar-border">
                          {filhos.map((child) => {
                            const ativo = path === child.path;
                            return (
                              <Link
                                key={child.key}
                                to={child.path}
                                className={cn(
                                  'flex items-center gap-2 h-9 pl-4 pr-4 text-sm transition-colors',
                                  ativo
                                    ? 'text-sidebar-primary font-medium'
                                    : 'text-sidebar-foreground/70 hover:text-sidebar-foreground',
                                )}
                              >
                                <span className="flex-1">{t(child.key)}</span>
                                {child.path === '/financial/processo' && overdueCount > 0 && (
                                  <span
                                    className="text-[10px] font-bold bg-destructive text-white px-1.5 py-0.5 min-w-[20px] text-center rounded-sm tabular-nums"
                                    title={`${overdueCount} conta(s) vencida(s)`}
                                  >
                                    {overdueCount}
                                  </span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                // O painel mora em /dashboard; "/" também abre o painel.
                const ativo =
                  item.path === '/'
                    ? path === '/' || path.startsWith('/dashboard')
                    : path === item.path || path.startsWith(item.path);
                return (
                  <Link
                    key={item.key}
                    to={item.path}
                    title={collapsed ? t(item.key) : undefined}
                    className={itemClass(ativo)}
                  >
                    {marcador(ativo)}
                    <item.icon className="w-[18px] h-[18px] shrink-0" />
                    {!collapsed && <span className="flex-1">{t(item.key)}</span>}
                  </Link>
                );
              })}
            </Fragment>
          );
        })}
      </nav>

      {/* Rodapé */}
      <div className="border-t border-sidebar-border">
        <button
          data-tour="support"
          onClick={() => setSupportOpen(true)}
          title={collapsed ? t('nav.support') : undefined}
          className={cn(itemClass(false), 'w-full')}
        >
          <LifeBuoy className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && <span>{t('nav.support')}</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className="flex items-center justify-center w-full h-9 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        {!collapsed && (
          <p className="px-4 pb-3 pt-1 text-[11px] text-sidebar-foreground/40">Aura Comex by Brasa Digital</p>
        )}
      </div>
      <SupportSheet open={supportOpen} onOpenChange={setSupportOpen} />
    </aside>
  );
}

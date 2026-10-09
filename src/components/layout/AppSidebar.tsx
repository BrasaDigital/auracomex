import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Ship, FileText, DollarSign, Database,
  Settings, ChevronLeft, ChevronRight, ChevronDown, Anchor, ArrowLeft, CreditCard, LifeBuoy, RefreshCw
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { cn } from '@/lib/utils';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SupportSheet } from '@/components/support/SupportButton';
import { useReleases } from '@/hooks/useReleases';

export const allNavItems = [
  { key: 'nav.dashboard', icon: LayoutDashboard, path: '/', permission: 'canAccessDashboard' as const },
  { key: 'nav.quotes', icon: FileText, path: '/quotes', permission: 'canAccessQuotes' as const },
  { key: 'nav.shipments', icon: Ship, path: '/shipments', permission: 'canAccessShipments' as const },
  {
    // Clicar em "Financeiro" abre direto a Visão Geral (/financial/empresa,
    // só os KPIs consolidados). O submenu "Movimentações" reúne os
    // lançamentos: Despesa/Receita por Processo e Geral (despesas/receitas
    // da empresa sem vínculo com processo, ex-"Despesas Fixas").
    key: 'nav.financial', icon: DollarSign, path: '/financial/empresa', permission: 'canAccessFinancial' as const,
    children: [
      { key: 'nav.financial_process', path: '/financial/processo' },
    ],
  },
  { key: 'nav.registrations', icon: Database, path: '/registrations', permission: 'canAccessRegistrations' as const },
  { key: 'nav.settings', icon: Settings, path: '/settings', permission: 'canAccessSettings' as const },
];

export function AppSidebar() {
  // Auto-colapsa em telas menores que 1024px (notebooks pequenos/tablets)
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1024,
  );
  const [supportOpen, setSupportOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => {
      // Colapsa automaticamente ao encolher a janela; ao expandir, o usuário decide
      if (e.matches) setCollapsed(true);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  const { t } = useLanguage();
  const { isSuperadmin, activeCompanyName, exitCompany, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Mantém "Financeiro" expandido enquanto o usuário estiver em alguma das
  // suas duas sub-páginas (evita fechar sozinho ao trocar de aba).
  useEffect(() => {
    if (location.pathname.startsWith('/financial')) setFinancialOpen(true);
  }, [location.pathname]);
  const permissions = usePermissions();
  const queryClient = useQueryClient();
  const { usdBrl, eurBrl, source: ratesSource, loading: ratesLoading, refetch: refetchRates } = useExchangeRate();
  // Puxa a versão de BUILD (app_build_version) — atualizada em todo deploy,
  // inclusive os intermediários com letra (26.8.64b), não só quando um
  // assunto fecha em Novidades (app_releases). Assim dá pra conferir na
  // hora se o último deploy já subiu.
  const { buildVersion } = useReleases();
  const appVersion = buildVersion;

  const { data: company } = useQuery({
    queryKey: ['company', profile?.company_id],
    queryFn: async () => {
      if (!profile) return null;
      const { data } = await supabase
        .from('companies')
        .select('*')
        .eq('id', profile.company_id)
        .single();
      return data;
    },
    enabled: !!profile,
  });

  // Fase 3: badge de contas a pagar vencidas
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

  const logoUrl = (company as any)?.logo_url;
  const companyName = company?.name || 'Aura Comex';

  const navItems = allNavItems.filter(item => (permissions as any)[item.permission]);

  async function handleExitCompany() {
    await exitCompany();
    queryClient.clear();
    navigate('/admin');
  }

  return (
    <aside
      data-tour="sidebar"
      className={cn(
        "flex flex-col h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className={cn(
        "flex border-b border-sidebar-border",
        collapsed ? "items-center justify-center p-3" : "flex-col items-center gap-2 px-2 py-4"
      )}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={companyName}
            title={companyName}
            className={cn(
              "object-contain shrink-0",
              collapsed ? "w-10 h-10" : "w-full h-auto max-h-40"
            )}
          />
        ) : (
          <div className={cn(
            "flex items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shrink-0",
            collapsed ? "w-10 h-10" : "w-full h-32"
          )}>
            <Anchor className={collapsed ? "w-5 h-5" : "w-10 h-10"} />
          </div>
        )}
        {!collapsed && appVersion && (
          <span className="text-[10px] font-mono text-sidebar-foreground/50 mt-1">
            v{appVersion}
          </span>
        )}
      </div>

      {/* Superadmin company banner */}
      {isSuperadmin && activeCompanyName && (
        <div className={cn(
          "border-b border-sidebar-border",
          collapsed ? "px-2 py-2" : "px-3 py-3"
        )}>
          {!collapsed ? (
            <button
              onClick={handleExitCompany}
              className="flex items-center gap-2 w-full px-2 py-2 rounded-lg bg-sidebar-primary/10 text-sidebar-primary hover:bg-sidebar-primary/20 transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Acessando</p>
                <p className="font-medium truncate text-xs">{activeCompanyName}</p>
              </div>
            </button>
          ) : (
            <button
              onClick={handleExitCompany}
              className="flex items-center justify-center w-full py-2 rounded-lg bg-sidebar-primary/10 text-sidebar-primary hover:bg-sidebar-primary/20 transition-colors"
              title={`Voltar ao Painel (${activeCompanyName})`}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Nav + Quick Notes */}
      <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden py-4 px-2">
        <nav className="space-y-1">
          {navItems.map((item) => {
            const hasChildren = !!(item as any).children;
            const isActive = !hasChildren && (location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path)));
            const isParentActive = hasChildren && location.pathname.startsWith('/financial');

            if (hasChildren) {
              return (
                <div key={item.key}>
                  <button
                    type="button"
                    onClick={() => {
                      // Sempre navega pro destino do item pai (Visão Geral) — o
                      // menu expande junto (useEffect abaixo já cuida disso pra
                      // qualquer rota /financial/*), sem precisar de um segundo
                      // clique só pra abrir os submenus.
                      navigate(item.path);
                      if (!collapsed) setFinancialOpen(true);
                    }}
                    className={cn(
                      "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                      isParentActive
                        ? "bg-sidebar-primary/10 text-sidebar-primary"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <item.icon className="w-5 h-5 shrink-0" />
                    {!collapsed && <span className="flex-1 text-left">{t(item.key)}</span>}
                    {!collapsed && (
                      <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 transition-transform", financialOpen && "rotate-180")} />
                    )}
                    {overdueCount > 0 && (
                      <span
                        className={cn(
                          "text-[10px] font-bold rounded-full bg-red-500 text-white",
                          collapsed ? "absolute -mt-6 ml-4 w-4 h-4 flex items-center justify-center" : "px-1.5 py-0.5 min-w-[20px] text-center"
                        )}
                        title={`${overdueCount} conta(s) vencida(s)`}
                      >
                        {overdueCount}
                      </span>
                    )}
                  </button>
                  {!collapsed && financialOpen && (
                    <div className="ml-4 pl-3 border-l border-sidebar-border space-y-1 mt-1">
                      {(item as any).children.map((child: { key: string; path: string }) => {
                        const childActive = location.pathname === child.path;
                        return (
                          <Link
                            key={child.key}
                            to={child.path}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                              childActive
                                ? "bg-sidebar-primary/10 text-sidebar-primary"
                                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            )}
                          >
                            <span className="flex-1">{t(child.key)}</span>
                            {child.path === '/financial/processo' && overdueCount > 0 && (
                              <span
                                className="text-[10px] font-bold rounded-full bg-red-500 text-white px-1.5 py-0.5 min-w-[20px] text-center"
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

            return (
              <Link
                key={item.key}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-sidebar-primary/10 text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span className="flex-1">{t(item.key)}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Câmbio do dia — fixo no menu, evita repetir em várias páginas */}
      {collapsed ? (
        <div className="px-2 pb-2">
          <button
            onClick={() => refetchRates()}
            title={`USD/BRL ${usdBrl ? usdBrl.toFixed(4) : '—'} · EUR/BRL ${eurBrl ? eurBrl.toFixed(4) : '—'}${ratesSource ? ` · Fonte: ${ratesSource}` : ''}`}
            className="flex items-center justify-center w-full py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground/70"
          >
            <RefreshCw className={cn('w-4 h-4', ratesLoading && 'animate-spin')} />
          </button>
        </div>
      ) : (
        <div className="px-2 pb-2">
          <div className="rounded-lg bg-sidebar-accent/50 px-3 py-2.5 text-xs text-sidebar-foreground">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold">Câmbio</span>
              <button
                onClick={() => refetchRates()}
                title="Atualizar câmbio"
                className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
              >
                <RefreshCw className={cn('w-3 h-3', ratesLoading && 'animate-spin')} />
              </button>
            </div>
            <div className="flex items-center justify-between font-mono">
              <span className="text-sidebar-foreground/70">USD/BRL</span>
              <span className="font-semibold">{usdBrl ? usdBrl.toFixed(4) : '—'}</span>
            </div>
            <div className="flex items-center justify-between font-mono">
              <span className="text-sidebar-foreground/70">EUR/BRL</span>
              <span className="font-semibold">{eurBrl ? eurBrl.toFixed(4) : '—'}</span>
            </div>
            {ratesSource && (
              <p className="text-[9px] text-sidebar-foreground/40 mt-1.5 truncate" title={`Fonte: ${ratesSource}`}>
                Fonte: {ratesSource}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border space-y-1">
        <button
          data-tour="support"
          onClick={() => setSupportOpen(true)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors w-full"
        >
          <LifeBuoy className="w-5 h-5 shrink-0" />
          {!collapsed && <span>{t('nav.support')}</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full py-2 rounded-lg hover:bg-sidebar-accent transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
      
      {!collapsed && (
        <div className="px-4 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-center text-sidebar-foreground/40 font-medium uppercase tracking-wider">
            Aura Comex by Brasa Digital
          </p>
        </div>
      )}
      <SupportSheet open={supportOpen} onOpenChange={setSupportOpen} />
    </aside>
  );
}


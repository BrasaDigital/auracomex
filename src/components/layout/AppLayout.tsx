import { AppSidebar } from './AppSidebar';
import { AppSidebarPorto } from './AppSidebarPorto';
import { TopBar } from './TopBar';
import { useTemaPorto } from '@/hooks/useTemaPorto';
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { ativo: porto } = useTemaPorto();
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {porto ? <AppSidebarPorto /> : <AppSidebar />}
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
      {/* Sem popup automático de novidades ao entrar (ficava forçando ver
          release por release, "um por um"). O aviso agora é só a bolinha no
          botão "Novidades" da TopBar — a pessoa abre quando quiser. */}
    </div>
  );
}

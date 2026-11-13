import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, LogOut, LayoutDashboard, LifeBuoy, Megaphone, Palette, PiggyBank, MessageCircle, Landmark } from 'lucide-react';
import { PlatformLogo } from '@/components/shared/PlatformLogo';
import { toast } from 'sonner';

import { CompanyCreateDialog } from '@/components/superadmin/CompanyCreateDialog';
import { CompanyEditDialog } from '@/components/superadmin/CompanyEditDialog';
import { PlatformLogoUpload } from '@/components/superadmin/PlatformLogoUpload';
import { ReleasesPanel } from '@/components/superadmin/ReleasesPanel';
import { SupportTicketsPanel } from '@/components/superadmin/SupportTicketsPanel';
import { PlatformMetrics } from '@/components/superadmin/PlatformMetrics';
import { CompanyPlansTable } from '@/components/superadmin/CompanyPlansTable';
import { AuraFinanceTab } from '@/components/superadmin/AuraFinanceTab';
import { C6BillingPanel } from '@/components/superadmin/C6BillingPanel';

const ADMIN_TABS = ['visao-geral', 'empresas', 'financeiro', 'cobrancas', 'suporte', 'releases', 'marca'] as const;
type AdminTab = typeof ADMIN_TABS[number];

export default function SuperAdmin() {
  const { signOut, switchCompany } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ id: '', name: '', cnpj: '', email: '', phone: '', address: '', isForeign: false, estimateEnabled: false });

  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const hash = window.location.hash.replace('#', '');
    return (ADMIN_TABS as readonly string[]).includes(hash) ? (hash as AdminTab) : 'visao-geral';
  });

  function handleTabChange(value: string) {
    setActiveTab(value as AdminTab);
    window.history.replaceState(null, '', `#${value}`);
  }

  function invalidateCompanies() {
    queryClient.invalidateQueries({ queryKey: ['superadmin-company-plans'] });
    queryClient.invalidateQueries({ queryKey: ['platform-metrics'] });
  }

  async function handleResetPassword(companyId: string, adminEmail: string) {
    setResettingPassword(companyId);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(adminEmail, {
        redirectTo: window.location.origin + '/first-access',
      });
      if (error) throw error;
      toast.success(`Email de recuperação enviado para ${adminEmail}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setResettingPassword(null);
    }
  }

  async function handleAccessCompany(companyId: string, companyName: string) {
    try {
      await switchCompany(companyId, companyName);
      queryClient.clear();
      navigate('/');
    } catch (err: any) {
      toast.error('Erro ao acessar empresa: ' + err.message);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('companies')
        .delete()
        .eq('id', deleteTarget.id);
      if (error) throw error;
      toast.success(`Empresa "${deleteTarget.name}" excluída.`);
      invalidateCompanies();
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  function openEdit(company: any) {
    setEditForm({
      id: company.id,
      name: company.name || '',
      cnpj: company.cnpj || '',
      email: company.email || '',
      phone: company.phone || '',
      address: company.address || '',
      isForeign: company.is_foreign || false,
      estimateEnabled: !!company.estimate_enabled,
    });
    setEditOpen(true);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <PlatformLogo size={44} className="rounded-lg" iconClassName="w-5 h-5" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin/whatsapp')} className="text-muted-foreground">
              <MessageCircle className="w-4 h-4 mr-2" />WhatsApp
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
              <LogOut className="w-4 h-4 mr-2" />Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="flex h-auto justify-start gap-1 p-1 w-full overflow-x-auto overflow-y-hidden flex-nowrap">
            <TabsTrigger value="visao-geral" className="gap-1.5"><LayoutDashboard className="w-4 h-4" />Visão Geral</TabsTrigger>
            <TabsTrigger value="empresas" className="gap-1.5"><Building2 className="w-4 h-4" />Empresas</TabsTrigger>
            <TabsTrigger value="financeiro" className="gap-1.5"><PiggyBank className="w-4 h-4" />Financeiro</TabsTrigger>
            <TabsTrigger value="cobrancas" className="gap-1.5"><Landmark className="w-4 h-4" />Cobranças C6</TabsTrigger>
            <TabsTrigger value="suporte" className="gap-1.5"><LifeBuoy className="w-4 h-4" />Suporte</TabsTrigger>
            <TabsTrigger value="releases" className="gap-1.5"><Megaphone className="w-4 h-4" />Releases</TabsTrigger>
            <TabsTrigger value="marca" className="gap-1.5"><Palette className="w-4 h-4" />Marca</TabsTrigger>
          </TabsList>

          {/* Visão Geral */}
          <TabsContent value="visao-geral" className="space-y-4 mt-4">
            <PlatformMetrics />
          </TabsContent>

          {/* Empresas + Planos */}
          <TabsContent value="empresas" className="space-y-6 mt-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Empresas</h2>
                <p className="text-muted-foreground text-sm">Gerencie empresas, planos e assinaturas.</p>
              </div>

              <CompanyCreateDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSuccess={invalidateCompanies}
              />
            </div>

            <CompanyPlansTable
              resettingPassword={resettingPassword}
              onAccess={handleAccessCompany}
              onEdit={openEdit}
              onDelete={(id, name) => setDeleteTarget({ id, name })}
              onResetPassword={handleResetPassword}
            />
          </TabsContent>

          {/* Financeiro do Aura */}
          <TabsContent value="financeiro" className="space-y-6 mt-4">
            <AuraFinanceTab />
          </TabsContent>

          {/* Suporte */}
          <TabsContent value="cobrancas" className="space-y-6 mt-4">
            <C6BillingPanel />
          </TabsContent>

          <TabsContent value="suporte" className="space-y-6 mt-4">
            <SupportTicketsPanel />
          </TabsContent>

          {/* Releases */}
          <TabsContent value="releases" className="space-y-6 mt-4">
            <ReleasesPanel />
          </TabsContent>

          {/* Marca */}
          <TabsContent value="marca" className="space-y-6 mt-4">
            <PlatformLogoUpload />
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Dialog */}
      <CompanyEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editForm={editForm}
        setEditForm={setEditForm}
        onSuccess={invalidateCompanies}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a empresa <strong>{deleteTarget?.name}</strong>? Esta ação não pode ser desfeita e todos os dados associados serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Upload, Trash2, Search, Sparkles, CreditCard, Palette, Database, Users, HardDriveDownload, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { DataManagementSection } from '@/components/settings/DataManagementSection';
import { UserRolesSection } from '@/components/settings/UserRolesSection';
import { InviteUserSection } from '@/components/settings/InviteUserSection';
import { ReopenShipmentsSection } from '@/components/settings/ReopenShipmentsSection';
import { SiscomexConfigWizard } from '@/components/settings/SiscomexConfigWizard';
import { PortalUnicoConfigWizard } from '@/components/settings/PortalUnicoConfigWizard';
import { BankAccountsSection } from '@/components/settings/BankAccountsSection';
import { BackupSection } from '@/components/settings/BackupSection';
import Billing from './Billing';


function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function cleanCnpj(value: string) {
  return value.replace(/\D/g, '');
}

const VALID_TABS = ['plano', 'design', 'dados', 'usuarios', 'backup', 'referencias'] as const;
type SettingsTab = typeof VALID_TABS[number];

export default function SettingsPage() {
  const { t, language } = useLanguage();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [savingColors, setSavingColors] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: '',
    cnpj: '',
    email: '',
    phone: '',
    address: '',
    quotePrefix: '',
    quoteStartNumberRaw: '1',
    quoteIncludeMode: true,
    accountabilityShowBudget: true,
    brandPrimary: '#1a1a2e',
    brandSecondary: '#1e40af',
    documentAlertEmail: '',
    seguroTaxaPctDefault: '0.16',
  });

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'assinatura') return 'plano';
    return (VALID_TABS as readonly string[]).includes(hash) ? (hash as SettingsTab) : 'plano';
  });

  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'assinatura') setActiveTab('plano');
      else if ((VALID_TABS as readonly string[]).includes(hash)) setActiveTab(hash as SettingsTab);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function handleTabChange(value: string) {
    setActiveTab(value as SettingsTab);
    window.history.replaceState(null, '', `#${value}`);
  }

  const { data: company } = useQuery({
    queryKey: ['company', profile?.company_id],
    queryFn: async () => {
      if (!profile) return null;
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', profile.company_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  useEffect(() => {
    if (company) {
      const c: any = company;
      const startNum = c.quote_start_number || 1;
      const width = Math.max(1, c.quote_number_width || 5);
      const raw = String(startNum).padStart(width, '0');
      setForm({
        name: company.name || '',
        cnpj: c.cnpj || '',
        email: c.email || '',
        phone: c.phone || '',
        address: c.address || '',
        quotePrefix: c.quote_prefix === 'FF' ? '' : (c.quote_prefix || ''),
        quoteStartNumberRaw: raw,
        quoteIncludeMode: c.quote_include_mode !== false,
        accountabilityShowBudget: c.accountability_show_budget !== false,
        brandPrimary: c.brand_primary_color || '#1a1a2e',
        brandSecondary: c.brand_secondary_color || '#1e40af',
        documentAlertEmail: c.document_alert_email || '',
        seguroTaxaPctDefault: String(c.seguro_taxa_pct_default ?? 0.16),
      });
    }
  }, [company]);

  async function handleCnpjLookup() {
    const cnpj = cleanCnpj(form.cnpj);
    if (cnpj.length !== 14) {
      toast.error('CNPJ deve ter 14 dígitos');
      return;
    }
    setLookingUp(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const address = [
        data.logradouro, data.numero, data.complemento, data.bairro,
        data.municipio ? `${data.municipio}/${data.uf}` : '', data.cep,
      ].filter(Boolean).join(', ');
      setForm((prev) => ({
        ...prev,
        name: data.razao_social || data.nome_fantasia || prev.name,
        email: data.email || prev.email,
        phone: data.ddd_telefone_1
          ? `(${data.ddd_telefone_1.slice(0, 2)}) ${data.ddd_telefone_1.slice(2)}`
          : prev.phone,
        address,
      }));
      toast.success(t('registrations.cnpj_found'));
    } catch {
      toast.error(t('registrations.cnpj_not_found'));
    } finally {
      setLookingUp(false);
    }
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    try {
      const rawNum = form.quoteStartNumberRaw.replace(/\D/g, '') || '1';
      const startNumber = Math.max(1, parseInt(rawNum, 10) || 1);
      const width = Math.max(1, rawNum.length);
      const { error } = await supabase
        .from('companies')
        .update({
          name: form.name.trim(),
          cnpj: cleanCnpj(form.cnpj) || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
          quote_prefix: form.quotePrefix.trim().toUpperCase() || 'FF',
          quote_start_number: startNumber,
          quote_number_width: width,
          quote_include_mode: form.quoteIncludeMode,
          accountability_show_budget: form.accountabilityShowBudget,
          brand_primary_color: form.brandPrimary,
          brand_secondary_color: form.brandSecondary,
          document_alert_email: form.documentAlertEmail.trim() || null,
          seguro_taxa_pct_default: Math.max(0, parseFloat(form.seguroTaxaPctDefault.replace(',', '.')) || 0),
        } as any)
        .eq('id', profile.company_id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['company', profile.company_id] });
      toast.success(t('common.save'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveColors() {
    if (!profile) return;
    setSavingColors(true);
    try {
      const { error } = await supabase
        .from('companies')
        .update({
          brand_primary_color: form.brandPrimary,
          brand_secondary_color: form.brandSecondary,
        } as any)
        .eq('id', profile.company_id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['company', profile.company_id] });
      toast.success(language === 'pt' ? 'Cores salvas' : 'Colors saved');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingColors(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Max 2MB');
      return;
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('PNG, JPG ou WebP');
      return;
    }

    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${profile.company_id}/logo.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('company-logos')
        .getPublicUrl(path);

      const logoUrl = urlData.publicUrl + '?t=' + Date.now();

      const { error: updateError } = await supabase
        .from('companies')
        .update({ logo_url: logoUrl } as any)
        .eq('id', profile.company_id);
      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ['company', profile.company_id] });
      toast.success('Logo atualizado!');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemoveLogo() {
    if (!profile) return;
    setUploadingLogo(true);
    try {
      // List and remove files in the company folder
      const { data: files } = await supabase.storage
        .from('company-logos')
        .list(profile.company_id);
      if (files && files.length > 0) {
        await supabase.storage
          .from('company-logos')
          .remove(files.map(f => `${profile.company_id}/${f.name}`));
      }

      await supabase
        .from('companies')
        .update({ logo_url: null } as any)
        .eq('id', profile.company_id);

      queryClient.invalidateQueries({ queryKey: ['company', profile.company_id] });
      toast.success('Logo removido');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploadingLogo(false);
    }
  }

  const logoUrl = (company as any)?.logo_url;

  return (
    <div className="space-y-6 animate-slide-in">
      <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex h-auto justify-start gap-1 p-1 w-full overflow-x-auto overflow-y-hidden flex-nowrap">
          <TabsTrigger value="plano" className="gap-1.5"><CreditCard className="w-4 h-4" />Plano</TabsTrigger>
          <TabsTrigger value="design" className="gap-1.5"><Palette className="w-4 h-4" />Design</TabsTrigger>
          <TabsTrigger value="dados" className="gap-1.5"><Database className="w-4 h-4" />Dados</TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-1.5"><Users className="w-4 h-4" />Usuários</TabsTrigger>
          <TabsTrigger value="backup" className="gap-1.5"><HardDriveDownload className="w-4 h-4" />Backup</TabsTrigger>
          <TabsTrigger value="referencias" className="gap-1.5"><Hash className="w-4 h-4" />Referências</TabsTrigger>
        </TabsList>

        {/* Plano */}
        <TabsContent value="plano" className="space-y-6 mt-4">
          <Billing />
        </TabsContent>

        {/* Design */}
        <TabsContent value="design" className="space-y-6 mt-4 max-w-2xl">
          <Card className="glass">
            <CardHeader><CardTitle>{t('settings.company_logo')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-16 w-16 object-contain rounded-lg border border-border bg-background p-1" />
                ) : (
                  <div className="h-16 w-16 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">
                    Logo
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingLogo}
                    >
                      {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
                      {t('settings.upload_logo')}
                    </Button>
                    {logoUrl && (
                      <Button variant="ghost" size="sm" onClick={handleRemoveLogo} disabled={uploadingLogo}>
                        <Trash2 className="w-4 h-4 mr-1" />
                        {t('settings.remove_logo')}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('settings.logo_hint')}</p>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoUpload} />
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle>{language === 'pt' ? 'Identidade Visual dos Documentos' : 'Document Brand Colors'}</CardTitle>
              <CardDescription>
                {language === 'pt'
                  ? 'Personalize as cores usadas nas propostas e documentos gerados pelo Aura. Não afeta o tema da plataforma.'
                  : 'Customize the colors used in proposals and documents generated by Aura. Does not affect the platform theme.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{language === 'pt' ? 'Cor Primária (cabeçalho, títulos)' : 'Primary color (header, titles)'}</Label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={form.brandPrimary}
                      onChange={(e) => setForm({ ...form, brandPrimary: e.target.value })}
                      className="h-10 w-14 rounded border border-border cursor-pointer bg-transparent"
                    />
                    <Input
                      value={form.brandPrimary}
                      onChange={(e) => setForm({ ...form, brandPrimary: e.target.value })}
                      maxLength={7}
                      className="font-mono uppercase"
                      placeholder="#1a1a2e"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{language === 'pt' ? 'Cor Secundária (destaques)' : 'Secondary color (accents)'}</Label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={form.brandSecondary}
                      onChange={(e) => setForm({ ...form, brandSecondary: e.target.value })}
                      className="h-10 w-14 rounded border border-border cursor-pointer bg-transparent"
                    />
                    <Input
                      value={form.brandSecondary}
                      onChange={(e) => setForm({ ...form, brandSecondary: e.target.value })}
                      maxLength={7}
                      className="font-mono uppercase"
                      placeholder="#1e40af"
                    />
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-md border border-border overflow-hidden bg-white">
                <div style={{ height: 4, background: form.brandSecondary }} />
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid #e2e8f0` }}>
                  <div>
                    <div style={{ color: form.brandPrimary, fontWeight: 700, fontSize: 14 }}>{form.name || 'Sua Empresa'}</div>
                    <div style={{ color: '#64748b', fontSize: 10 }}>Prévia do cabeçalho da proposta</div>
                  </div>
                  <span style={{ background: form.brandSecondary, color: '#fff', padding: '4px 12px', borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    Marítimo FCL
                  </span>
                </div>
                <div className="px-4 py-3">
                  <div style={{ background: form.brandPrimary, color: '#fff', padding: '6px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Descrição
                  </div>
                  <div className="text-xs text-black px-2 py-2" style={{ borderBottom: '1px solid #eee' }}>Frete Marítimo</div>
                  <div style={{ background: form.brandSecondary, color: '#fff', padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontSize: 12 }}>
                    TOTAL &nbsp; USD 1.250,00
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveColors} disabled={savingColors}>
                  {savingColors ? (language === 'pt' ? 'Salvando…' : 'Saving…') : (language === 'pt' ? 'Salvar cores' : 'Save colors')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm({ ...form, brandPrimary: '#1a1a2e', brandSecondary: '#1e40af' })}
                >
                  {language === 'pt' ? 'Restaurar padrão Aura' : 'Restore Aura default'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dados */}
        <TabsContent value="dados" className="space-y-6 mt-4 max-w-2xl">
          <Card className="glass">
            <CardHeader><CardTitle>{t('settings.company')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* CNPJ + Lookup */}
              <div className="space-y-2">
                <Label>CNPJ</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="00.000.000/0000-00"
                    value={formatCnpj(form.cnpj)}
                    onChange={(e) => setForm({ ...form, cnpj: cleanCnpj(e.target.value) })}
                    className="font-mono"
                    maxLength={18}
                  />
                  <Button
                    variant="outline"
                    onClick={handleCnpjLookup}
                    disabled={lookingUp || cleanCnpj(form.cnpj).length !== 14}
                    className="shrink-0"
                  >
                    {lookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : t('registrations.lookup_cnpj')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('auth.company_name')}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={200}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('registrations.email')}</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    maxLength={255}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('registrations.phone')}</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    maxLength={30}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('registrations.address')}</Label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  maxLength={500}
                />
              </div>

              <div className="space-y-2">
                <Label>E-mail para alertas de documentos</Label>
                <Input
                  type="email"
                  placeholder="financeiro@suaempresa.com"
                  value={form.documentAlertEmail}
                  onChange={(e) => setForm({ ...form, documentAlertEmail: e.target.value })}
                  maxLength={255}
                />
                <p className="text-xs text-muted-foreground">
                  Recebe um aviso quando um documento cadastrado num cliente/fornecedor estiver a 7 dias do vencimento.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Taxa padrão do Seguro Internacional (%)</Label>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  className="max-w-[160px]"
                  placeholder="0.16"
                  value={form.seguroTaxaPctDefault}
                  onChange={(e) => setForm({ ...form, seguroTaxaPctDefault: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Usada no cálculo automático do seguro na aba Taxas somente quando o processo não tem uma Seguradora vinculada na aba Parceiros. Para uma taxa específica, cadastre-a na Seguradora (Cadastros &gt; Parceiros, categoria "Seguradora").
                </p>
              </div>

              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            </CardContent>
          </Card>

          <BankAccountsSection />

          <Card className="glass overflow-hidden border-primary/20">
            <CardHeader className="bg-primary/5 pb-6">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Integração Siscomex (Aura Sync)</CardTitle>
              </div>
              <CardDescription>
                Configure seu certificado digital e credenciais do Serpro para automatizar o cálculo de impostos por NCM.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {profile?.company_id && (
                <SiscomexConfigWizard
                  companyId={profile.company_id}
                  onComplete={() => queryClient.invalidateQueries({ queryKey: ['company', profile.company_id] })}
                />
              )}
            </CardContent>
          </Card>

          <Card className="glass overflow-hidden border-primary/20">
            <CardHeader className="bg-primary/5 pb-6">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Integração Portal Único Siscomex (Desembaraço)</CardTitle>
              </div>
              <CardDescription>
                Consulte canal de parametrização e status de DI/DUIMP direto do Portal Único, usando a Chave de Acesso da sua própria empresa (gerada com seu certificado digital). Diferente da integração Serpro acima.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {profile?.company_id && <PortalUnicoConfigWizard companyId={profile.company_id} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Usuários */}
        <TabsContent value="usuarios" className="space-y-6 mt-4 max-w-2xl">
          <InviteUserSection />
          <UserRolesSection />
          <ReopenShipmentsSection />
        </TabsContent>

        {/* Backup */}
        <TabsContent value="backup" className="space-y-6 mt-4 max-w-2xl">
          <BackupSection />
        </TabsContent>

        {/* Referências */}
        <TabsContent value="referencias" className="space-y-6 mt-4 max-w-2xl">
          <Card className="glass">
            <CardHeader>
              <CardTitle>{language === 'pt' ? 'Numeração das Referências' : 'Reference Numbering'}</CardTitle>
              <CardDescription>
                {language === 'pt'
                  ? 'Define como os números de cotações e embarques são gerados.'
                  : 'Defines how quote and shipment numbers are generated.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('settings.quote_prefix')}</Label>
                  <Input
                    value={form.quotePrefix}
                    onChange={(e) => setForm({ ...form, quotePrefix: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase() })}
                    placeholder={new Date().getFullYear().toString().slice(-2)}
                    maxLength={5}
                    className="font-mono uppercase"
                  />
                  <p className="text-xs text-muted-foreground">
                    {language === 'pt' ? 'Se vazio, usa o ano atual automaticamente' : 'If empty, uses the current year automatically'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>{language === 'pt' ? 'Número Inicial' : 'Starting Number'}</Label>
                  <Input
                    value={form.quoteStartNumberRaw}
                    onChange={(e) => setForm({ ...form, quoteStartNumberRaw: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                    placeholder="00001"
                    inputMode="numeric"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    {language === 'pt'
                      ? 'A quantidade de zeros à esquerda define a largura (ex: 012 → 26-012, 26-013...).'
                      : 'Leading zeros define the width (e.g. 012 → 26-012, 26-013...).'}
                  </p>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
                <div className="space-y-1">
                  <Label className="text-sm">
                    {language === 'pt' ? 'Incluir modal na referência' : 'Include mode in reference'}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {language === 'pt'
                      ? 'Quando ativo, adiciona o modal ao final (ex: 26-00001-FI). Desligado, exibe apenas 26-00001.'
                      : 'When on, appends the mode (e.g. 26-00001-FI). When off, shows only 26-00001.'}
                  </p>
                </div>
                <Switch
                  checked={form.quoteIncludeMode}
                  onCheckedChange={(v) => setForm({ ...form, quoteIncludeMode: v })}
                />
              </div>

              <div className="flex items-start justify-between gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
                <div className="space-y-1">
                  <Label className="text-sm">
                    {language === 'pt' ? 'Mostrar valor previsto na Prestação de Contas' : 'Show budgeted amount in the Accountability report'}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {language === 'pt'
                      ? 'Ligado, o PDF enviado ao cliente traz o valor orçado no Numerário, o pago e a diferença. Desligado, traz só o pago e o saldo dos depósitos do cliente.'
                      : 'On, the PDF sent to the client shows budgeted, paid and difference. Off, it shows only paid amounts and the balance of the client deposits.'}
                  </p>
                </div>
                <Switch
                  checked={form.accountabilityShowBudget}
                  onCheckedChange={(v) => setForm({ ...form, accountabilityShowBudget: v })}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                {language === 'pt' ? 'Formato' : 'Format'}:{' '}
                <span className="font-mono">
                  {(form.quotePrefix || new Date().getFullYear().toString().slice(-2))}
                  -
                  {(form.quoteStartNumberRaw || '1').padStart(Math.max(1, form.quoteStartNumberRaw.length || 1), '0')}
                  {form.quoteIncludeMode ? '-FI' : ''}
                </span>{' '}
                ({language === 'pt'
                  ? (form.quoteIncludeMode ? 'prefixo-sequencial-modal' : 'prefixo-sequencial')
                  : (form.quoteIncludeMode ? 'prefix-sequence-mode' : 'prefix-sequence')})
              </p>

              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            </CardContent>
          </Card>

          <DataManagementSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

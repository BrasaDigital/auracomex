import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Loader2, Pencil, Copy, Trash2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ChargeCatalogTab } from '@/components/registrations/ChargeCatalogTab';
import { PortsTab } from '@/components/registrations/PortsTab';
import { ClientDocumentsSection } from '@/components/registrations/ClientDocumentsSection';
import { TrackingVisibilityDialog } from '@/components/registrations/TrackingVisibilityDialog';
import { formatCpf, isValidCpf, onlyDigits, formatTaxId } from '@/lib/utils';

const CLIENT_TYPES = ['client', 'carrier', 'agent', 'shipper'] as const;
type ClientType = typeof CLIENT_TYPES[number];

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

type CnpjLookupResult = { name: string; email: string; phone: string; address: string };

// A consulta roda numa Edge Function (servidor), não direto do navegador:
// a ReceitaWS bloqueia CORS pra chamadas de browser no plano gratuito, e
// rodando no servidor conseguimos tentar os dois provedores com retry sem
// depender da rede/latência de quem está usando o sistema.
async function fetchCnpjWithFallback(cnpj: string): Promise<CnpjLookupResult | 'not_found'> {
  const { data, error } = await supabase.functions.invoke('lookup-cnpj', { body: { cnpj } });
  if (error) throw error;
  if (data?.not_found) return 'not_found';
  if (data?.error) throw new Error(data.error);
  if (!data?.data) throw new Error('Resposta inesperada da consulta de CNPJ');
  return data.data as CnpjLookupResult;
}

export default function Registrations() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('client');
  const [showAdd, setShowAdd] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [trackingClient, setTrackingClient] = useState<any>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [isAddingNewType, setIsAddingNewType] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    contact_person: '',
    address: '',
    tax_id: '',
    tax_id_type: 'CNPJ' as 'CNPJ' | 'CPF' | 'FOREIGN',
    type: 'client' as ClientType,
    salesperson_id: '',
    commission_rate: '',
    is_foreign: false,
    partner_category: '',
    storage_rebate_percent: '',
    storage_fixed_value: '',
    insurance_rate_pct: '',
    exchange_spread_pct: '',
  });

  function getClientTrackingLink(taxId: string | null) {
    if (!taxId) return '';
    // Domínio público oficial (evita gerar link com .vercel.app ao copiar de ambientes diferentes)
    const base = import.meta.env.VITE_PUBLIC_APP_URL || 'https://auracomex.app';
    return `${base}/tracking/${taxId}`;
  }

  function copyTrackingLink(taxId: string | null) {
    const link = getClientTrackingLink(taxId);
    if (link) {
      navigator.clipboard.writeText(link);
      toast.success(t('registrations.link_copied'));
    }
  }

  // Fetch company users excluding superadmins to populate vendor selector
  const { data: salespersons = [] } = useQuery({
    queryKey: ['salespersons', profile?.company_id],
    queryFn: async () => {
      if (!profile) return [];
      // Get superadmin user IDs to exclude
      const { data: superadminRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'superadmin' as any);
      const superadminIds = (superadminRoles || []).map((r: any) => r.user_id);

      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .eq('company_id', profile.company_id)
        .order('full_name');
      if (error) throw error;
      return (data || []).filter((p: any) => !superadminIds.includes(p.user_id));
    },
    enabled: !!profile,
  });

  const { data: registrations = [] } = useQuery({
    queryKey: ['registrations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*, profiles!clients_salesperson_id_fkey(full_name)' as any)
        .order('name');
      if (error) {
        // Fallback without join if FK not recognized
        const { data: fallback, error: e2 } = await supabase
          .from('clients')
          .select('*')
          .order('name');
        if (e2) throw e2;
        return fallback;
      }
      return data;
    },
  });

  const { data: existingCategories = [] } = useQuery({
    queryKey: ['partner-categories', profile?.company_id],
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from('clients')
        .select('partner_category')
        .eq('company_id', profile.company_id)
        .not('partner_category', 'is', null);
      if (error) throw error;
      
      const categories = Array.from(new Set(data.map((c: any) => c.partner_category)));
      return categories.sort();
    },
    enabled: !!profile,
  });

  const addRegistration = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Not authenticated');
      const cleanedTaxId = form.is_foreign ? '' : onlyDigits(form.tax_id);

      if (!form.is_foreign && cleanedTaxId) {
        if (form.tax_id_type === 'CPF') {
          if (!isValidCpf(cleanedTaxId)) throw new Error('CPF inválido');
        } else if (form.tax_id_type === 'CNPJ') {
          if (cleanedTaxId.length !== 14) throw new Error('CNPJ deve ter 14 dígitos');
        }
      }

      // Check for duplicate CNPJ (skip if editing same record)
      if (cleanedTaxId) {
        const { data: existing } = await supabase
          .from('clients')
          .select('id, name')
          .eq('company_id', profile.company_id)
          .eq('tax_id', cleanedTaxId)
          .maybeSingle();

        if (existing && existing.id !== editingId) {
          throw new Error(t('registrations.cnpj_already_exists') + `: ${existing.name}`);
        }
      }

      const payload = {
        company_id: profile.company_id,
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        contact_person: form.contact_person.trim() || null,
        address: form.address.trim() || null,
        tax_id: form.is_foreign ? null : (cleanedTaxId || null),
        tax_id_type: form.is_foreign ? 'FOREIGN' : form.tax_id_type,
        type: form.type as any,
        salesperson_id: form.salesperson_id || null,
        commission_rate: form.commission_rate ? parseFloat(form.commission_rate) : null,
        is_foreign: form.is_foreign,
        partner_category: form.type === 'client' || form.type === 'shipper' ? null : (form.partner_category || null),
        storage_rebate_percent: form.partner_category === 'co_loader' && form.storage_rebate_percent
          ? parseFloat(form.storage_rebate_percent)
          : null,
        storage_fixed_value: form.partner_category === 'terminal' && form.storage_fixed_value
          ? parseFloat(form.storage_fixed_value)
          : null,
        insurance_rate_pct: form.partner_category === 'insurance' && form.insurance_rate_pct
          ? parseFloat(form.insurance_rate_pct)
          : null,
        exchange_spread_pct: form.type === 'client' && form.exchange_spread_pct
          ? parseFloat(form.exchange_spread_pct)
          : null,
      };

      if (editingId) {
        const { error } = await supabase.from('clients').update(payload as any).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('clients').insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
      queryClient.invalidateQueries({ queryKey: ['partner-categories'] });
      setShowAdd(false);
      setEditingId(null);
      resetForm();
      toast.success(editingId ? t('common.save') : t('common.create'));
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteRegistration = useMutation({
    mutationFn: async (id: string) => {
      const [{ count: qCount }, { count: sCount }] = await Promise.all([
        supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('client_id', id),
        supabase.from('shipments').select('id', { count: 'exact', head: true }).eq('client_id', id),
      ]);

      if ((qCount ?? 0) > 0 || (sCount ?? 0) > 0) {
        throw new Error(
          `Não é possível excluir: cadastro vinculado a ${qCount ?? 0} cotação(ões) e ${sCount ?? 0} embarque(s).`
        );
      }

      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) {
        if ((error as any).code === '23503') {
          throw new Error('Cadastro vinculado a outros registros e não pode ser excluído.');
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
      queryClient.invalidateQueries({ queryKey: ['partner-categories'] });
      setDeleteId(null);
      toast.success('Cadastro excluído');
    },
    onError: (err: any) => {
      setDeleteId(null);
      toast.error(err.message ?? 'Erro ao excluir cadastro');
    },
  });

  function openEdit(client: any) {
    setForm({
      name: client.name || '',
      email: client.email || '',
      phone: client.phone || '',
      contact_person: client.contact_person || '',
      address: client.address || '',
      tax_id: client.tax_id || '',
      tax_id_type: (client.tax_id_type as any) || 'CNPJ',
      type: client.type || 'client',
      salesperson_id: client.salesperson_id || '',
      commission_rate: client.commission_rate != null ? String(client.commission_rate) : '',
      is_foreign: client.is_foreign || false,
      partner_category: client.partner_category || '',
      storage_rebate_percent: client.storage_rebate_percent != null ? String(client.storage_rebate_percent) : '',
      storage_fixed_value: (client as any).storage_fixed_value != null ? String((client as any).storage_fixed_value) : '',
      insurance_rate_pct: client.insurance_rate_pct != null ? String(client.insurance_rate_pct) : '',
      exchange_spread_pct: (client as any).exchange_spread_pct != null ? String((client as any).exchange_spread_pct) : '',
    });
    setEditingId(client.id);
    setShowAdd(true);
  }

  function resetForm() {
    setIsAddingNewType(false);
    setForm({ 
      name: '', 
      email: '', 
      phone: '', 
      contact_person: '', 
      address: '', 
      tax_id: '', 
      tax_id_type: 'CNPJ',
      type: (activeTab === 'client' ? 'client' : activeTab === 'shipper' ? 'shipper' : 'supplier') as ClientType,
      salesperson_id: '',
      commission_rate: '',
      is_foreign: false,
      partner_category: '',
      storage_rebate_percent: '',
      storage_fixed_value: '',
      insurance_rate_pct: '',
      exchange_spread_pct: '',
    });
  }

  function hasFormData() {
    return form.name.trim() || form.email.trim() || form.phone.trim() || form.contact_person.trim() || form.address.trim() || form.tax_id.trim();
  }

  function handleDialogClose(open: boolean) {
    if (!open) {
      if (hasFormData()) {
        setShowCloseConfirm(true);
      } else {
        setShowAdd(false);
        setEditingId(null);
        resetForm();
      }
    }
  }

  async function handleCnpjLookup() {
    const cnpj = cleanCnpj(form.tax_id);
    if (cnpj.length !== 14) {
      toast.error('CNPJ deve ter 14 dígitos');
      return;
    }

    // Check duplicate first
    if (profile) {
      const { data: existing } = await supabase
        .from('clients')
        .select('id, name')
        .eq('company_id', profile.company_id)
        .eq('tax_id', cnpj)
        .maybeSingle();

      if (existing) {
        toast.error(t('registrations.cnpj_already_exists') + `: ${existing.name}`);
        return;
      }
    }

    setLookingUp(true);
    try {
      const result = await fetchCnpjWithFallback(cnpj);
      if (result === 'not_found') {
        toast.error(t('registrations.cnpj_not_found'));
        return;
      }

      setForm((prev) => ({
        ...prev,
        name: result.name || prev.name,
        email: result.email || prev.email,
        phone: result.phone || prev.phone,
        address: result.address || prev.address,
      }));
      toast.success(t('registrations.cnpj_found'));
    } catch {
      // Falha real de rede/timeout/erro dos dois provedores — diferente de
      // "não encontrado" (404/erro genuíno de CNPJ inexistente).
      toast.error(t('registrations.cnpj_lookup_error'));
    } finally {
      setLookingUp(false);
    }
  }

  const typeLabels: Record<string, string> = {
    client: t('registrations.type_client'),
    supplier: t('registrations.type_supplier'),
    carrier: t('registrations.type_carrier'),
    agent: t('registrations.type_agent'),
    shipper: t('registrations.type_shipper'),
  };

  const typeColors: Record<string, string> = {
    client: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    supplier: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    carrier: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    agent: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    shipper: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
  };

  const filtered = registrations.filter((c: any) => {
    const matchesSearch =
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.tax_id?.includes(cleanCnpj(search)) ||
      c.email?.toLowerCase().includes(search.toLowerCase());
    if (activeTab === 'all') return matchesSearch;
    if (activeTab === 'client') return matchesSearch && c.type === 'client';
    if (activeTab === 'shipper') return matchesSearch && c.type === 'shipper';
    if (activeTab === 'supplier') return matchesSearch && c.type !== 'client' && c.type !== 'shipper';
    return matchesSearch;
  });

  const showClientControls = activeTab === 'client' || activeTab === 'supplier' || activeTab === 'shipper';

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Tabs + Search + Novo Cadastro (só faz sentido pra Clientes/Fornecedores) */}
      <Tabs value={activeTab} onValueChange={(v) => {
        setActiveTab(v);
        if (!editingId) {
          const nextType = v === 'client' ? 'client' : v === 'shipper' ? 'shipper' : 'supplier';
          setForm(prev => ({ ...prev, type: nextType as ClientType }));
        }
      }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <TabsList className="bg-secondary/50">
              <TabsTrigger value="client">{t('registrations.clients')}</TabsTrigger>
              <TabsTrigger value="supplier">{t('registrations.suppliers')}</TabsTrigger>
              <TabsTrigger value="shipper">{t('registrations.shippers')}</TabsTrigger>
              <TabsTrigger value="charges">{t('charges.tab')}</TabsTrigger>
              <TabsTrigger value="ports">Portos</TabsTrigger>
            </TabsList>
            {showClientControls && (
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t('registrations.search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            )}
          </div>
          {showClientControls && (
            <Button onClick={() => { resetForm(); setEditingId(null); setShowAdd(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              {t('registrations.new')}
            </Button>
          )}
        </div>

        {/* Charges catalog tab */}
        <TabsContent value="charges" className="mt-4">
          <ChargeCatalogTab />
        </TabsContent>

        <TabsContent value="ports" className="mt-4">
          <PortsTab />
        </TabsContent>

        {(['client', 'supplier', 'shipper'] as const).map((tabValue) => (
          <TabsContent key={tabValue} value={tabValue} className="mt-4">
            <Card className="glass">
              <CardContent className="p-0">
                <Table className="text-sm">
                  <TableHeader>
                  <TableRow>
                      <TableHead className="h-9 px-3 text-xs">{t('registrations.name')}</TableHead>
                      <TableHead className="h-9 px-3 text-xs">
                        Categoria
                      </TableHead>
                      <TableHead className="h-9 px-3 text-xs">{t('registrations.tax_id')}</TableHead>
                      <TableHead className="h-9 px-3 text-xs">{t('registrations.contact')}</TableHead>
                      <TableHead className="h-9 px-3 text-xs">{t('registrations.email')}</TableHead>
                      <TableHead className="h-9 px-3 text-xs">{t('registrations.phone')}</TableHead>
                      <TableHead className="h-9 px-3 text-xs min-w-[150px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                          {t('common.no_data')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((c: any) => (
                        <TableRow key={c.id} className="hover:bg-secondary/50 whitespace-nowrap">
                          <TableCell className="py-2 px-3 font-medium max-w-[180px] truncate">
                            {c.name}
                            {!c.company_id && <Badge variant="secondary" className="ml-2 text-[10px]">Padrão Aura</Badge>}
                          </TableCell>
                          <TableCell className="py-2 px-3">
                            <div className="flex flex-col gap-1">
                              {activeTab === 'client' ? (
                                <Badge variant="outline" className={typeColors[c.type as ClientType] || ''}>
                                  {typeLabels[c.type as ClientType] || c.type}
                                </Badge>
                              ) : (
                                c.partner_category ? (
                                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                                    {t(`registrations.category_${c.partner_category}`) !== `registrations.category_${c.partner_category}`
                                      ? t(`registrations.category_${c.partner_category}`)
                                      : c.partner_category}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className={typeColors[c.type as ClientType] || ''}>
                                    {typeLabels[c.type as ClientType] || c.type}
                                  </Badge>
                                )
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2 px-3 font-mono text-xs">
                            {c.tax_id ? formatTaxId(c.tax_id, c.tax_id_type) : '-'}
                          </TableCell>
                          <TableCell className="py-2 px-3">{c.contact_person || '-'}</TableCell>
                          <TableCell className="py-2 px-3">{c.email || '-'}</TableCell>
                          <TableCell className="py-2 px-3">{c.phone || '-'}</TableCell>
                          <TableCell className="py-1 px-2 text-right">
                            <div className="flex justify-end gap-1">
                              {activeTab === 'client' && c.type === 'client' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1 text-xs px-2"
                                  onClick={() => setTrackingClient(c)}
                                  title="Configurar o que esse cliente vê no Portal de Tracking"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  Tracking
                                </Button>
                              )}
                              {c.company_id && <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs px-2" onClick={() => openEdit(c)} title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                                Editar
                              </Button>}
                              {c.company_id && <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs px-2 text-destructive hover:text-destructive"
                                onClick={() => setDeleteId(c.id)}
                                title="Excluir"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Excluir
                              </Button>}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={handleDialogClose}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? t('registrations.edit') : t('registrations.new')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Foreign company toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="is-foreign" className="cursor-pointer">{t('registrations.foreign_company')}</Label>
              <Switch
                id="is-foreign"
                checked={form.is_foreign}
                onCheckedChange={(checked) => setForm({ ...form, is_foreign: checked, tax_id: checked ? '' : form.tax_id })}
              />
            </div>

            {/* CNPJ + Lookup — hidden for foreign companies */}
            {!form.is_foreign && (
            <>
            <div className="space-y-2">
              <Label>Tipo de Documento</Label>
              <div className="flex gap-2">
                {(['CNPJ','CPF'] as const).map((op) => (
                  <Button
                    key={op}
                    type="button"
                    variant={form.tax_id_type === op ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setForm({ ...form, tax_id_type: op, tax_id: '' })}
                  >
                    {op}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{form.tax_id_type === 'CPF' ? 'CPF' : t('registrations.tax_id')}</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={form.tax_id_type === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'}
                  value={form.tax_id_type === 'CPF' ? formatCpf(form.tax_id) : formatCnpj(form.tax_id)}
                  onChange={(e) => setForm({ ...form, tax_id: onlyDigits(e.target.value) })}
                  className="font-mono"
                  maxLength={form.tax_id_type === 'CPF' ? 14 : 18}
                />
                {form.tax_id_type === 'CNPJ' && (
                <Button
                  variant="outline"
                  onClick={handleCnpjLookup}
                  disabled={lookingUp || cleanCnpj(form.tax_id).length !== 14}
                  className="shrink-0"
                >
                  {lookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : t('registrations.lookup_cnpj')}
                </Button>
                )}
              </div>
            </div>
            </>
            )}

            {/* Type - Hidden as it is inferred from tab but kept in state */}
            {/* Partner Category - Only for non-client, non-shipper types */}
            {form.type !== 'client' && form.type !== 'shipper' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label>{t('registrations.partner_category')}</Label>
                {isAddingNewType ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder={t('registrations.new_type_placeholder')}
                      value={form.partner_category}
                      onChange={(e) => setForm({ ...form, partner_category: e.target.value })}
                      autoFocus
                    />
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => setIsAddingNewType(false)}
                      type="button"
                    >
                      <Plus className="w-4 h-4 rotate-45" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Select 
                      value={form.partner_category} 
                      onValueChange={(v) => {
                        if (v === 'ADD_NEW') {
                          setIsAddingNewType(true);
                          setForm({ ...form, partner_category: '' });
                        } else {
                          setForm({ ...form, partner_category: v });
                        }
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t('common.select') || 'Selecionar...'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="road_carrier">{t('registrations.category_road_carrier')}</SelectItem>
                        <SelectItem value="ocean_carrier">{t('registrations.category_ocean_carrier')}</SelectItem>
                        <SelectItem value="air_carrier">{t('registrations.category_air_carrier')}</SelectItem>
                        <SelectItem value="insurance">{t('registrations.category_insurance')}</SelectItem>
                        <SelectItem value="co_loader">{t('registrations.category_co_loader')}</SelectItem>
                        <SelectItem value="terminal">{t('registrations.category_terminal')}</SelectItem>
                        <SelectItem value="other">{t('registrations.category_other')}</SelectItem>
                        {/* Dynamic categories */}
                        {existingCategories
                          .filter((cat: string) => !['road_carrier', 'ocean_carrier', 'air_carrier', 'insurance', 'co_loader', 'terminal', 'other'].includes(cat))
                          .map((cat: string) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))
                        }
                        <div className="h-px bg-muted my-1" />
                        <SelectItem value="ADD_NEW" className="text-primary font-medium">
                          {t('registrations.add_new_type')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {form.partner_category && (
                      <Button 
                        variant="outline" 
                        size="icon"
                        onClick={() => {
                          const currentVal = form.partner_category;
                          // If it's a key from translation, use the translated value as the editable text
                          const translated = t(`registrations.category_${currentVal}`);
                          const editableValue = (translated !== `registrations.category_${currentVal}`) ? translated : currentVal;
                          
                          setIsAddingNewType(true);
                          setForm({ ...form, partner_category: editableValue });
                        }}
                        type="button"
                        title={t('common.edit') || 'Editar'}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Rebate de armazenagem - só para Co-loaders */}
            {form.partner_category === 'co_loader' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label>Rebate de armazenagem (%)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    placeholder="0"
                    value={form.storage_rebate_percent}
                    onChange={(e) => setForm({ ...form, storage_rebate_percent: e.target.value })}
                    className="pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Percentual do valor da armazenagem que este Co-loader repassa como rebate. É esse valor que vai para Contas a Receber quando armazenagem é lançada em um embarque LCL.
                </p>
              </div>
            )}

            {/* Valor fixo de armazenagem - só para Terminais */}
            {form.partner_category === 'terminal' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label>Valor fixo de armazenagem (R$)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    value={form.storage_fixed_value}
                    onChange={(e) => setForm({ ...form, storage_fixed_value: e.target.value })}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Valor fixo (não percentual) que este Terminal repassa como rebate de armazenagem. É esse valor que vai para Contas a Receber quando armazenagem é lançada em um embarque FCL.
                </p>
              </div>
            )}

            {/* Taxa de Seguro - só para Seguradoras */}
            {form.partner_category === 'insurance' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label>Taxa de Seguro (%)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.0001"
                    placeholder="0.16"
                    value={form.insurance_rate_pct}
                    onChange={(e) => setForm({ ...form, insurance_rate_pct: e.target.value })}
                    className="pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Taxa cobrada por esta seguradora sobre a soma das verbas (Custo + Frete + Despesas + Lucro Esperado + Impostos). Usada no cálculo automático do Seguro Internacional na aba Taxas do processo.
                </p>
              </div>
            )}

            {/* Name */}
            <div className="space-y-2">
              <Label>{t('registrations.name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={200}
              />
            </div>

            {/* Email + Phone */}
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

            {/* Contact person */}
            <div className="space-y-2">
              <Label>{t('registrations.contact')}</Label>
              <Input
                value={form.contact_person}
                onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                maxLength={100}
              />
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label>{t('registrations.address')}</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                maxLength={500}
              />
            </div>

            {/* Tracking Link - only show when editing and client has tax_id */}
            {editingId && form.tax_id && (
              <div className="space-y-2">
                <Label>{t('registrations.tracking_link')}</Label>
                <div className="flex gap-2">
                  <Input
                    value={getClientTrackingLink(cleanCnpj(form.tax_id))}
                    readOnly
                    className="font-mono text-xs bg-muted"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => copyTrackingLink(cleanCnpj(form.tax_id))}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}


            {form.type === 'client' && (
              <div className="space-y-2">
                <Label>{t('registrations.salesperson')}</Label>
                <Select value={form.salesperson_id} onValueChange={(v) => setForm({ ...form, salesperson_id: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder={t('registrations.select_salesperson')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-</SelectItem>
                    {salespersons.map((sp: any) => (
                      <SelectItem key={sp.user_id} value={sp.user_id}>{sp.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Commission Rate - only for clients */}
            {form.type === 'client' && (
              <div className="space-y-2">
                <Label>{t('registrations.commission_rate')}</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    placeholder="0"
                    value={form.commission_rate}
                    onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                    className="pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                </div>
              </div>
            )}

            {/* Spread cambial - só para clientes */}
            {form.type === 'client' && (
              <div className="space-y-2">
                <Label>Spread Cambial (%)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={form.exchange_spread_pct}
                    onChange={(e) => setForm({ ...form, exchange_spread_pct: e.target.value })}
                    className="pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Percentual somado sobre a taxa de câmbio fiscal para calcular a Taxa Câmbio Agência na Estimativa deste cliente.
                </p>
              </div>
            )}

            {/* Documentos - só depois que o cadastro existe (precisa de um ID pra anexar) */}
            {editingId && profile?.company_id && (
              <ClientDocumentsSection clientId={editingId} companyId={profile.company_id} />
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => handleDialogClose(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => addRegistration.mutate()}
                disabled={!form.name.trim() || addRegistration.isPending}
              >
                {addRegistration.isPending ? t('common.loading') : editingId ? t('common.save') : t('common.create')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close confirmation */}
      <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('registrations.close_confirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowAdd(false); setEditingId(null); resetForm(); }}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cadastro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Cadastros vinculados a cotações ou embarques não poderão ser excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteRegistration.mutate(deleteId)} disabled={deleteRegistration.isPending}>
              {deleteRegistration.isPending ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TrackingVisibilityDialog client={trackingClient} onClose={() => setTrackingClient(null)} />
    </div>
  );
}

import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { formatCnpj, formatCpf, formatTaxId, isValidCpf, onlyDigits } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function Clients() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', contact_person: '', address: '',
    tax_id: '', tax_id_type: 'CNPJ' as 'CNPJ' | 'CPF' | 'FOREIGN',
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const emptyForm = { name: '', email: '', phone: '', contact_person: '', address: '', tax_id: '', tax_id_type: 'CNPJ' as const };

  const saveClient = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Not authenticated');
      const cleanTaxId = form.tax_id_type === 'FOREIGN' ? form.tax_id.trim() : onlyDigits(form.tax_id);
      if (form.tax_id_type === 'CPF' && cleanTaxId && !isValidCpf(cleanTaxId)) {
        throw new Error('CPF inválido');
      }
      if (form.tax_id_type === 'CNPJ' && cleanTaxId && cleanTaxId.length !== 14) {
        throw new Error('CNPJ deve ter 14 dígitos');
      }
      if (editingId) {
        const { error } = await supabase.from('clients').update({
          ...form,
          tax_id: cleanTaxId,
        } as any).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('clients').insert({
          company_id: profile.company_id,
          ...form,
          tax_id: cleanTaxId,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setShowAdd(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success(editingId ? 'Cadastro atualizado' : 'Cadastro criado');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteClient = useMutation({
    mutationFn: async (id: string) => {
      // Verifica vínculos antes: quotes e shipments impedem exclusão (FK RESTRICT)
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
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setDeleteId(null);
      toast.success('Cadastro excluído');
    },
    onError: (err: any) => {
      setDeleteId(null);
      toast.error(err.message ?? 'Erro ao excluir');
    },
  });

  function openEdit(c: any) {
    setEditingId(c.id);
    setForm({
      name: c.name ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      contact_person: c.contact_person ?? '',
      address: c.address ?? '',
      tax_id: c.tax_id ?? '',
      tax_id_type: (c.tax_id_type ?? 'CNPJ') as any,
    });
    setShowAdd(true);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowAdd(true);
  }

  const filtered = clients.filter((c: any) =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-end">
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />{t('clients.new')}</Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Card className="glass">
        <CardContent className="p-0">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 px-3 text-xs">{t('clients.name')}</TableHead>
                <TableHead className="h-9 px-3 text-xs">{t('clients.contact')}</TableHead>
                <TableHead className="h-9 px-3 text-xs">{t('clients.email')}</TableHead>
                <TableHead className="h-9 px-3 text-xs">{t('clients.phone')}</TableHead>
                <TableHead className="h-9 px-3 text-xs">Documento</TableHead>
                <TableHead className="h-9 px-3 text-xs text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">{t('common.no_data')}</TableCell></TableRow>
              ) : (
                filtered.map((c: any) => (
                  <TableRow key={c.id} className="hover:bg-secondary/50 whitespace-nowrap">
                    <TableCell className="py-2 px-3 font-medium">{c.name}</TableCell>
                    <TableCell className="py-2 px-3">{c.contact_person || '-'}</TableCell>
                    <TableCell className="py-2 px-3">{c.email || '-'}</TableCell>
                    <TableCell className="py-2 px-3">{c.phone || '-'}</TableCell>
                    <TableCell className="py-2 px-3">
                      {c.tax_id ? (
                        <div className="flex items-center gap-2">
                          <span>{formatTaxId(c.tax_id, c.tax_id_type)}</span>
                          {c.tax_id_type && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{c.tax_id_type === 'FOREIGN' ? 'EXT' : c.tax_id_type}</Badge>
                          )}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="py-1 px-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)} title="Editar">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={() => setDeleteId(c.id)} title="Excluir">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={(o) => { setShowAdd(o); if (!o) { setEditingId(null); setForm(emptyForm); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? 'Editar cadastro' : t('clients.new')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t('clients.name')}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>{t('clients.email')}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-2"><Label>{t('clients.phone')}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>{t('clients.contact')}</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Tipo de Documento</Label>
              <RadioGroup
                value={form.tax_id_type}
                onValueChange={(v) => setForm({ ...form, tax_id_type: v as any, tax_id: '' })}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2"><RadioGroupItem value="CNPJ" id="t-cnpj" /><Label htmlFor="t-cnpj" className="cursor-pointer font-normal">CNPJ</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="CPF" id="t-cpf" /><Label htmlFor="t-cpf" className="cursor-pointer font-normal">CPF</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="FOREIGN" id="t-ext" /><Label htmlFor="t-ext" className="cursor-pointer font-normal">Estrangeiro</Label></div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label>{form.tax_id_type === 'CPF' ? 'CPF' : form.tax_id_type === 'CNPJ' ? 'CNPJ' : 'Documento'}</Label>
              <Input
                value={
                  form.tax_id_type === 'CPF' ? formatCpf(form.tax_id) :
                  form.tax_id_type === 'CNPJ' ? formatCnpj(form.tax_id) :
                  form.tax_id
                }
                onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                placeholder={form.tax_id_type === 'CPF' ? '000.000.000-00' : form.tax_id_type === 'CNPJ' ? '00.000.000/0000-00' : ''}
                maxLength={form.tax_id_type === 'CPF' ? 14 : form.tax_id_type === 'CNPJ' ? 18 : 30}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAdd(false)}>{t('common.cancel')}</Button>
              <Button onClick={() => saveClient.mutate()} disabled={!form.name || saveClient.isPending}>
                {editingId ? 'Salvar' : t('common.create')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cadastro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Se o cadastro estiver vinculado a cotações ou embarques, a exclusão pode falhar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteClient.mutate(deleteId)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

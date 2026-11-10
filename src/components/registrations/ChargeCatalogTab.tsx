import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

const LEG_OPTIONS = [
  { value: 'origin', labelPt: 'Origem', labelEn: 'Origin' },
  { value: 'freight', labelPt: 'Frete', labelEn: 'Freight' },
  { value: 'destination', labelPt: 'Destino', labelEn: 'Destination' },
] as const;

const legColors: Record<string, string> = {
  origin: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  freight: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  destination: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
};

interface ChargeForm {
  name: string;
  legs: string[];
}

const emptyForm: ChargeForm = { name: '', legs: ['freight'] };

export function ChargeCatalogTab() {
  const { t, language } = useLanguage();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ChargeForm>(emptyForm);

  const { data: charges = [] } = useQuery({
    queryKey: ['charge-catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('charge_catalog' as any)
        .select('*')
        .order('name');
      if (error) throw error;
      return data as any[];
    },
  });

  const upsertCharge = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Not authenticated');
      if (editingId) {
        const { error } = await supabase.from('charge_catalog' as any).update({
          name: form.name.trim().toUpperCase(),
          legs: form.legs,
        } as any).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('charge_catalog' as any).insert({
          company_id: profile.company_id,
          name: form.name.trim().toUpperCase(),
          legs: form.legs,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charge-catalog'] });
      closeDialog();
      toast.success(editingId ? t('common.save') : t('common.create'));
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteCharge = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('charge_catalog' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charge-catalog'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const closeDialog = () => {
    setShowDialog(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowDialog(true);
  };

  const openEdit = (c: any) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      legs: Array.isArray(c.legs) && c.legs.length > 0 ? c.legs : ['freight'],
    });
    setShowDialog(true);
  };

  const toggleLeg = (leg: string) => {
    setForm(prev => {
      const has = prev.legs.includes(leg);
      const next = has ? prev.legs.filter(l => l !== leg) : [...prev.legs, leg];
      return { ...prev, legs: next.length > 0 ? next : prev.legs };
    });
  };

  const getLegLabel = (leg: string) => {
    const opt = LEG_OPTIONS.find(o => o.value === leg);
    return opt ? (language === 'pt' ? opt.labelPt : opt.labelEn) : leg;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('charges.catalog')}</h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          {t('charges.new')}
        </Button>
      </div>

      <Card className="glass">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('charges.name')}</TableHead>
                <TableHead>{language === 'pt' ? 'Trecho' : 'Leg'}</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {charges.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">
                    {t('common.no_data')}
                  </TableCell>
                </TableRow>
              ) : (
                charges.map((c: any) => (
                  <TableRow key={c.id} className={c.company_id ? 'cursor-pointer hover:bg-muted/50' : 'hover:bg-muted/50'} onClick={() => { if (c.company_id) openEdit(c); }}>
                    <TableCell className="font-medium">
                      {c.name}
                      {!c.company_id && <Badge variant="secondary" className="ml-2 text-[10px]">Padrão Aura</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {(Array.isArray(c.legs) ? c.legs : ['freight']).map((leg: string) => (
                          <Badge key={leg} variant="outline" className={legColors[leg] || ''}>
                            {getLegLabel(leg)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.company_id && <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(c); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteCharge.mutate(c.id); }}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? (language === 'pt' ? 'Editar Taxa' : 'Edit Charge') : t('charges.new')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('charges.name')}</Label>
              <Input
                placeholder="THC, BL FEE, OCEAN FREIGHT..."
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })}
                maxLength={100}
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'pt' ? 'Trecho' : 'Leg'}</Label>
              <div className="flex gap-4">
                {LEG_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={form.legs.includes(opt.value)}
                      onCheckedChange={() => toggleLeg(opt.value)}
                    />
                    <span className="text-sm">{language === 'pt' ? opt.labelPt : opt.labelEn}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog}>{t('common.cancel')}</Button>
              <Button onClick={() => upsertCharge.mutate()} disabled={!form.name.trim() || form.legs.length === 0 || upsertCharge.isPending}>
                {upsertCharge.isPending ? t('common.loading') : (editingId ? t('common.save') : t('common.create'))}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

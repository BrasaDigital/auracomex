import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

function cleanCnpj(value: string) { return value.replace(/\D/g, ''); }

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

interface EditForm {
  id: string; name: string; cnpj: string; email: string; phone: string; address: string; isForeign: boolean; estimateEnabled: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editForm: EditForm;
  setEditForm: (form: EditForm) => void;
  onSuccess: () => void;
}

export function CompanyEditDialog({ open, onOpenChange, editForm, setEditForm, onSuccess }: Props) {
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  async function lookupCnpj() {
    const clean = cleanCnpj(editForm.cnpj);
    if (clean.length !== 14) { toast.error('CNPJ deve ter 14 dígitos'); return; }
    setLookingUp(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const address = [data.logradouro, data.numero, data.complemento, data.bairro,
        data.municipio ? `${data.municipio}/${data.uf}` : '', data.cep].filter(Boolean).join(', ');
      const phone = data.ddd_telefone_1 ? `(${data.ddd_telefone_1.slice(0, 2)}) ${data.ddd_telefone_1.slice(2)}` : '';
      setEditForm({
        ...editForm,
        name: data.razao_social || data.nome_fantasia || editForm.name,
        email: data.email || editForm.email,
        phone: phone || editForm.phone,
        address: address || editForm.address,
      });
      toast.success('Dados do CNPJ encontrados!');
    } catch { toast.error('CNPJ não encontrado na base da Receita Federal'); }
    finally { setLookingUp(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase.from('companies').update({
        name: editForm.name.trim(),
        cnpj: editForm.isForeign ? null : (cleanCnpj(editForm.cnpj) || null),
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        address: editForm.address.trim() || null,
        is_foreign: editForm.isForeign,
        estimate_enabled: editForm.estimateEnabled,
      } as any).eq('id', editForm.id);
      if (error) throw error;
      toast.success('Empresa atualizada!');
      onSuccess();
      onOpenChange(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Editar Empresa</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={editForm.isForeign} onCheckedChange={(v) => setEditForm({ ...editForm, isForeign: v, cnpj: v ? '' : editForm.cnpj })} />
            <Label className="cursor-pointer">Empresa do Exterior</Label>
          </div>
          {!editForm.isForeign && (
            <div className="space-y-2">
              <Label>CNPJ</Label>
              <div className="flex gap-2">
                <Input value={formatCnpj(editForm.cnpj)} onChange={(e) => setEditForm({ ...editForm, cnpj: cleanCnpj(e.target.value) })} placeholder="00.000.000/0000-00" className="font-mono" maxLength={18} />
                <Button type="button" variant="outline" onClick={lookupCnpj} disabled={lookingUp || cleanCnpj(editForm.cnpj).length !== 14} className="shrink-0">
                  {lookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4 mr-1" />Consultar</>}
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Nome *</Label>
            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Endereço</Label>
            <Input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/30 px-3 py-2">
            <div>
              <Label className="cursor-pointer">Aba Desembaraço (custo estimado)</Label>
              <p className="text-xs text-muted-foreground">Habilita a aba Desembaraço (antes Estimativa) dentro das cotações desta empresa.</p>
            </div>
            <Switch checked={editForm.estimateEnabled} onCheckedChange={(v) => setEditForm({ ...editForm, estimateEnabled: v })} />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

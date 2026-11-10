import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Trash2, Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { useOverheadCategories, OverheadKind } from '@/hooks/useOverhead';

// Categorias usadas nos lançamentos "Geral" (despesas/receitas da empresa,
// sem vínculo com processo) — cada categoria é de despesa OU de receita,
// pra não misturar nos seletores das duas telas.
export default function CategoriesTab() {
  const categories = useOverheadCategories();
  const despesas = (categories.data || []).filter((c) => c.kind === 'despesa');
  const receitas = (categories.data || []).filter((c) => c.kind === 'receita');

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="w-4 h-4 text-destructive" /> Categorias de Despesa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <NewCategoryForm kind="despesa" onCreate={(name, color) => categories.upsert.mutate({ name, color, active: true, kind: 'despesa' } as any)} />
          <CategoryList categories={despesas} onUpdate={(c) => categories.upsert.mutate(c as any)} onRemove={(id) => categories.remove.mutate(id)} />
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-4 h-4 text-emerald-500" /> Categorias de Receita
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <NewCategoryForm kind="receita" onCreate={(name, color) => categories.upsert.mutate({ name, color, active: true, kind: 'receita' } as any)} />
          <CategoryList categories={receitas} onUpdate={(c) => categories.upsert.mutate(c as any)} onRemove={(id) => categories.remove.mutate(id)} />
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryList({ categories, onUpdate, onRemove }: { categories: any[]; onUpdate: (c: any) => void; onRemove: (id: string) => void }) {
  if (categories.length === 0) {
    return <div className="text-sm text-muted-foreground text-center py-6">Nenhuma categoria cadastrada.</div>;
  }
  return (
    <div className="space-y-2">
      {categories.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/10 p-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color || '#007BFF' }} />
          <Input className="max-w-xs" value={c.name} onChange={(e) => onUpdate({ ...c, name: e.target.value })} />
          <Input type="color" className="w-14 p-1" value={c.color || '#007BFF'} onChange={(e) => onUpdate({ ...c, color: e.target.value })} />
          <Switch checked={c.active} onCheckedChange={(v) => onUpdate({ ...c, active: v })} />
          <Button size="icon" variant="ghost" onClick={() => onRemove(c.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function NewCategoryForm({ kind, onCreate }: { kind: OverheadKind; onCreate: (name: string, color: string) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(kind === 'receita' ? '#10B981' : '#007BFF');
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <Label>Nova categoria</Label>
        <Input
          placeholder={kind === 'receita' ? 'Ex.: Serviços, Comissões' : 'Ex.: Software, Aluguel, Salários'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Input type="color" className="w-14 p-1" value={color} onChange={(e) => setColor(e.target.value)} />
      <Button onClick={() => { if (name.trim()) { onCreate(name.trim(), color); setName(''); } }}>
        <Plus className="w-4 h-4 mr-1" /> Adicionar
      </Button>
    </div>
  );
}

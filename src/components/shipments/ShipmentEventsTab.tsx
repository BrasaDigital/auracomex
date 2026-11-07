import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Plus, Trash2, Radio, CalendarIcon, NotebookPen } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DateField } from '@/components/shared/DateField';

interface Props {
  shipmentId: string;
  companyId: string;
  /** Processo Finalizado — trava novas entradas/edições no diário. */
  isFinalized?: boolean;
}

const CATEGORY_OPTIONS: { value: string; label: string; badgeClass: string }[] = [
  { value: 'booking', label: 'Reserva', badgeClass: 'bg-indigo-500/10 text-indigo-600' },
  { value: 'origin', label: 'Origem', badgeClass: 'bg-blue-500/10 text-blue-600' },
  { value: 'transit', label: 'Trânsito', badgeClass: 'bg-amber-500/10 text-amber-600' },
  { value: 'customs', label: 'Desembaraço', badgeClass: 'bg-purple-500/10 text-purple-600' },
  { value: 'delivery', label: 'Entrega', badgeClass: 'bg-green-500/10 text-green-600' },
  { value: 'billing', label: 'Faturamento', badgeClass: 'bg-emerald-500/10 text-emerald-600' },
  { value: 'update', label: 'Atualização', badgeClass: 'bg-secondary text-secondary-foreground' },
];

function categoryMeta(value: string) {
  return CATEGORY_OPTIONS.find((c) => c.value === value) || CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1];
}

/**
 * Diário do processo — reproduz a lógica da coluna "OBS." da planilha de
 * follow-up: uma lista de atualizações datadas (booking confirmado, draft
 * aprovado, embarque confirmado, DI registrada, entrega, faturamento...),
 * cada uma podendo ser marcada como visível no portal de tracking do
 * cliente (mesmo padrão do toggle de documentos).
 */
export function ShipmentEventsTab({ shipmentId, companyId, isFinalized }: Props) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const locked = !!isFinalized;
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('update');
  const [eventDate, setEventDate] = useState<Date>(new Date());
  const [visibleTracking, setVisibleTracking] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ['shipment-events', shipmentId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('shipment_events') as any)
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('event_date', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!shipmentId,
  });

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ['shipment-events', shipmentId] });
  }

  async function handleAdd() {
    if (locked) { toast.error('Processo finalizado — não é possível adicionar atualizações.'); return; }
    if (!note.trim()) return;
    setSaving(true);
    try {
      const { error } = await (supabase.from('shipment_events') as any).insert({
        shipment_id: shipmentId,
        company_id: companyId,
        event_date: eventDate.toISOString(),
        category,
        note: note.trim(),
        visible_tracking: visibleTracking,
        created_by: profile?.user_id || null,
      });
      if (error) throw error;
      toast.success('Atualização registrada');
      setNote('');
      setCategory('update');
      setEventDate(new Date());
      setVisibleTracking(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleVisible(id: string, current: boolean) {
    if (locked) { toast.error('Processo finalizado — não é possível editar.'); return; }
    const { error } = await (supabase.from('shipment_events') as any).update({ visible_tracking: !current }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(current ? 'Removido do tracking' : 'Disponível no tracking');
    refetch();
  }

  async function handleDelete(id: string) {
    if (locked) { toast.error('Processo finalizado — não é possível excluir.'); return; }
    const { error } = await (supabase.from('shipment_events') as any).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Atualização removida');
    refetch();
  }

  return (
    <fieldset disabled={locked} className="contents">
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <NotebookPen className="w-4 h-4" /> Diário do Processo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {locked && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Processo finalizado — somente leitura. Para editar, reabra o processo em Admin &gt; Reabrir Processos.
          </div>
        )}
        {/* Nova atualização */}
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data</Label>
              <DateField value={eventDate} onChange={(d) => d && setEventDate(d)} allowClear={false} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Atualização</Label>
            <Textarea
              placeholder="Ex.: Booking confirmado, draft aprovado, DI registrada..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setVisibleTracking((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Radio className={cn('w-3.5 h-3.5', visibleTracking && 'text-emerald-500')} />
              {visibleTracking ? 'Visível no tracking do cliente' : 'Interno (não aparece no tracking)'}
            </button>
            <Button size="sm" onClick={handleAdd} disabled={!note.trim() || saving}>
              <Plus className="w-4 h-4 mr-1" /> Adicionar
            </Button>
          </div>
        </div>

        {/* Linha do tempo */}
        <div className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma atualização registrada ainda.</p>
          ) : (
            events.map((ev: any) => {
              const meta = categoryMeta(ev.category);
              return (
                <div key={ev.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="text-xs text-muted-foreground shrink-0 w-20 pt-0.5">
                      {format(new Date(ev.event_date), 'dd/MM/yyyy')}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <Badge className={meta.badgeClass}>{meta.label}</Badge>
                      <p className="text-sm whitespace-pre-wrap">{ev.note}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={ev.visible_tracking ? 'Visível no Tracking' : 'Oculto no Tracking'}
                      onClick={() => handleToggleVisible(ev.id, ev.visible_tracking)}
                    >
                      <Radio className={cn('w-4 h-4', ev.visible_tracking ? 'text-emerald-500' : 'text-muted-foreground')} />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(ev.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
    </fieldset>
  );
}

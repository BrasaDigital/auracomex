import { formatMoney } from '@/lib/money';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles, Upload, FileText, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, format } from 'date-fns';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';

const MODE_LETTER: Record<string, string> = { ocean_fcl: 'F', ocean_lcl: 'L', air: 'A', road: 'R' };
const DIRECTION_LETTER: Record<string, string> = { IMP: 'I', EXP: 'E' };

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (quoteId: string) => void;
}

interface UploadedFile {
  file: File;
  base64: string;
}

interface Extracted {
  shipper_name?: string;
  shipper_country?: string;
  shipper_address?: string;
  shipper_tax_id?: string;
  consignee_name?: string;
  consignee_country?: string;
  consignee_address?: string;
  consignee_tax_id?: string;
  invoice_number?: string;
  invoice_date?: string;
  incoterm?: string;
  origin_port?: string;
  destination_port?: string;
  currency?: string;
  transport_mode_guess: 'ocean_fcl' | 'ocean_lcl' | 'air' | 'road';
  direction: 'IMP' | 'EXP';
  total_amount?: number;
  total_weight_kg?: number;
  total_volume_cbm?: number;
  total_packages?: number;
  items: Array<{
    commodity: string;
    ncm_code?: string;
    specification?: string;
    quantity?: number;
    unit?: string;
    unit_price?: number;
    total_amount?: number;
    weight_kg?: number;
    volume_cbm?: number;
    packages?: number;
  }>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip data:...;base64, prefix
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function AiImportQuoteModal({ open, onClose, onCreated }: Props) {
  const { profile } = useAuth();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [matchedClient, setMatchedClient] = useState<{ id: string; name: string } | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<{ id: string; name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFiles([]); setExtracted(null); setMatchedClient(null);
    setClientSearch(''); setClientResults([]); setAnalyzing(false); setCreating(false);
  }

  function handleClose() {
    reset(); onClose();
  }

  async function handleFilesPicked(picked: FileList | null) {
    if (!picked) return;
    const arr = Array.from(picked);
    if (files.length + arr.length > 4) {
      toast.error('Máximo 4 arquivos');
      return;
    }
    for (const f of arr) {
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name}: máximo 8 MB`);
        return;
      }
    }
    const converted = await Promise.all(arr.map(async (f) => ({ file: f, base64: await fileToBase64(f) })));
    setFiles((prev) => [...prev, ...converted]);
  }

  async function suggestClient(data: Extracted) {
    if (!profile) return;
    const name = data.direction === 'IMP' ? data.consignee_name : data.shipper_name;
    if (!name) return;
    const norm = normalize(name);
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, tax_id')
      .eq('company_id', profile.company_id)
      .eq('type', 'client')
      .eq('is_active', true);
    if (!clients) return;
    const taxId = data.direction === 'IMP' ? data.consignee_tax_id : data.shipper_tax_id;
    let match = taxId
      ? clients.find((c: any) => c.tax_id && normalize(c.tax_id).includes(normalize(taxId)))
      : null;
    if (!match) {
      match = clients.find((c: any) => {
        const cn = normalize(c.name);
        return cn.includes(norm) || norm.includes(cn);
      });
    }
    if (match) {
      setMatchedClient({ id: match.id, name: match.name });
      setClientSearch(match.name);
    }
  }

  async function searchClients(term: string) {
    setClientSearch(term);
    if (term.length < 2) { setClientResults([]); return; }
    const { data } = await supabase
      .from('clients')
      .select('id, name')
      .eq('type', 'client')
      .eq('is_active', true)
      .ilike('name', `%${term}%`)
      .order('name')
      .limit(8);
    setClientResults(data || []);
  }

  async function handleAnalyze() {
    if (files.length === 0) {
      toast.error('Adicione ao menos 1 arquivo');
      return;
    }
    setAnalyzing(true);
    try {
      const payload = {
        files: files.map((f) => ({
          name: f.file.name,
          mime: f.file.type || 'application/pdf',
          base64: f.base64,
        })),
      };
      const { data, error } = await supabase.functions.invoke('ai-parse-quote', { body: payload });
      if (error) throw error;
      if (!data?.data) throw new Error('Resposta vazia');
      setExtracted(data.data as Extracted);
      await suggestClient(data.data as Extracted);
      toast.success('Documentos analisados!');
    } catch (err: any) {
      const msg = err?.message || String(err);
      toast.error(msg);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCreate() {
    if (!profile || !extracted) return;
    setCreating(true);
    try {
      const { data: baseRef, error: rpcErr } = await supabase.rpc('next_reference', { p_company_id: profile.company_id });
      if (rpcErr) throw rpcErr;
      const { data: companyRow } = await supabase
        .from('companies')
        .select('quote_include_mode')
        .eq('id', profile.company_id)
        .single();
      const includeMode = (companyRow as any)?.quote_include_mode !== false;
      const mode = extracted.transport_mode_guess || 'ocean_fcl';
      const dir = extracted.direction || 'IMP';
      const quoteNum = includeMode
        ? `${baseRef}-${MODE_LETTER[mode] || 'F'}${DIRECTION_LETTER[dir] || 'I'}`
        : baseRef;

      const { data: quote, error: qErr } = await (supabase.from('quotes') as any).insert([{
        company_id: profile.company_id,
        quote_number: quoteNum,
        transport_mode: mode,
        client_id: matchedClient?.id || null,
        origin: extracted.origin_port || null,
        destination: extracted.destination_port || null,
        currency: extracted.currency || 'USD',
        valid_until: format(addDays(new Date(), 15), 'yyyy-MM-dd'),
        notes: extracted.invoice_number ? `Invoice: ${extracted.invoice_number}` : null,
        created_by: profile.user_id,
        status: 'quoting',
        base_reference: baseRef,
        direction: dir,
        incoterm: extracted.incoterm || null,
      }]).select('id').single();
      if (qErr) throw qErr;

      const itemsToInsert = (extracted.items || []).map((it) => ({
        quote_id: quote.id,
        company_id: profile.company_id,
        container_type: mode === 'ocean_fcl' ? '20GP' : null,
        container_qty: mode === 'ocean_fcl' ? 1 : null,
        weight_kg: it.weight_kg ?? null,
        volume_cbm: it.volume_cbm ?? null,
        packages: it.packages ?? null,
        ncm_code: it.ncm_code || null,
        commodity: [it.commodity, it.specification].filter(Boolean).join(' — ') || null,
        cargo_value: it.total_amount ?? null,
        cargo_value_currency: extracted.currency || 'USD',
        dangerous_goods: false,
      }));
      if (itemsToInsert.length > 0) {
        const { error: iErr } = await (supabase.from('quote_items') as any).insert(itemsToInsert);
        if (iErr) console.error('quote_items insert error:', iErr);
      }

      // Upload files as documents linked to quote
      try {
        for (const f of files) {
          const path = `${profile.company_id}/${quote.id}/${Date.now()}-${sanitizeStorageFileName(f.file.name)}`;
          const { error: upErr } = await supabase.storage
            .from('shipment-documents')
            .upload(path, f.file, { contentType: f.file.type, upsert: false });
          if (upErr) { console.error(upErr); continue; }
          await (supabase.from('documents') as any).insert({
            company_id: profile.company_id,
            quote_id: quote.id,
            uploaded_by: profile.user_id,
            name: f.file.name,
            document_type: 'invoice',
            file_url: path,
            file_size: f.file.size,
            visible_tracking: false,
          });
        }
      } catch (e) {
        console.error('Upload de documentos falhou:', e);
      }

      toast.success(`Cotação criada: ${quoteNum}`);
      onCreated(quote.id);
      handleClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Importar Invoice / Packing List com IA
          </DialogTitle>
          <DialogDescription>
            Faça upload da Commercial Invoice e/ou Packing List. A IA vai extrair os dados e abrir uma nova cotação pré-preenchida.
          </DialogDescription>
        </DialogHeader>

        {!extracted ? (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFilesPicked(e.dataTransfer.files); }}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">Clique ou arraste arquivos aqui</p>
              <p className="text-xs text-muted-foreground mt-1">PDF, JPG ou PNG • até 4 arquivos • 8 MB cada</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(e) => handleFilesPicked(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-secondary/50 text-sm">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{f.file.name}</span>
                    <span className="text-xs text-muted-foreground">{(f.file.size / 1024).toFixed(0)} KB</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => setFiles(files.filter((_, idx) => idx !== i))}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={handleAnalyze} disabled={analyzing || files.length === 0}>
                {analyzing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisando...</> : <><Sparkles className="w-4 h-4 mr-2" />Analisar com IA</>}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Card className="glass">
              <CardContent className="p-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Modal sugerido</Label>
                    <p className="font-medium uppercase">{extracted.transport_mode_guess}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Direção</Label>
                    <p className="font-medium">{extracted.direction}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Incoterm</Label>
                    <p className="font-medium">{extracted.incoterm || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Moeda</Label>
                    <p className="font-medium">{extracted.currency || 'USD'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Origem</Label>
                    <p className="font-medium">{extracted.origin_port || `${extracted.shipper_name || ''} (${extracted.shipper_country || '-'})`}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Destino</Label>
                    <p className="font-medium">{extracted.destination_port || `${extracted.consignee_name || ''} (${extracted.consignee_country || '-'})`}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Invoice</Label>
                    <p className="font-medium">{extracted.invoice_number || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Valor Total</Label>
                    <p className="font-medium">{formatMoney(extracted.total_amount ?? 0, extracted.currency || 'USD')}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Peso Bruto</Label>
                    <p className="font-medium">{(extracted.total_weight_kg ?? 0).toFixed(2)} kg</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Volume</Label>
                    <p className="font-medium">{(extracted.total_volume_cbm ?? 0).toFixed(2)} CBM</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-1.5 relative">
              <Label className="text-xs">
                Cliente {matchedClient && <span className="text-status-completed">(sugestão automática)</span>}
              </Label>
              <Input
                value={clientSearch}
                onChange={(e) => { searchClients(e.target.value); if (!e.target.value) setMatchedClient(null); }}
                placeholder="Buscar cliente cadastrado..."
              />
              {clientResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-md border bg-popover shadow-lg">
                  {clientResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setMatchedClient(c); setClientSearch(c.name); setClientResults([]); }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {!matchedClient && extracted && (
                <p className="text-xs text-muted-foreground">
                  Nenhum cliente vinculado — você pode deixar em branco e ajustar depois.
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs mb-2 block">Itens extraídos ({extracted.items?.length || 0})</Label>
              <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border p-2">
                {(extracted.items || []).map((it, i) => (
                  <div key={i} className="text-xs flex justify-between gap-2">
                    <span className="truncate">
                      {it.commodity}{it.specification ? ` — ${it.specification}` : ''}
                      {it.ncm_code ? ` [NCM ${it.ncm_code}]` : ''}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {it.quantity ?? '-'} × {formatMoney(it.unit_price ?? 0, extracted.currency || 'USD')} = {(it.total_amount ?? 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setExtracted(null)} disabled={creating}>
                ← Voltar
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} disabled={creating}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Criando...</> : 'Criar Cotação'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
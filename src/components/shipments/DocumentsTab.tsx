import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { openSignedDoc } from '@/lib/storage';
import { useLanguage } from '@/contexts/LanguageContext';
import { Upload, FileText, Download, Eye, Trash2, Radio, CalendarIcon, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useCallback, useState } from 'react';
import { format, differenceInCalendarDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { DOC_TYPE_LABELS } from '@/lib/documentCategory';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';
import { DateField } from '@/components/shared/DateField';

// Valor especial do Select que abre o campo de texto para digitar uma
// categoria nova (não confundir com o document_type "other" salvo no banco).
const NEW_CATEGORY_VALUE = '__new_category__';
const CUSTOM_PREFIX = 'custom:';

interface Props {
  shipmentId: string;
  companyId: string;
  isQuoteMode?: boolean;
  quoteId?: string;
  onGeneratePdf?: () => void;
  /** Empresas (fornecedores) vinculadas ao processo — mantido por compatibilidade
   *  com quem chama este componente; não é mais usado aqui (DN vai direto ao
   *  Financeiro, a partir da aba Taxas). */
  dnPartners?: Array<{ id: string; name: string; partner_category?: string | null }>;
  /** Cliente do processo — idem, não é mais usado aqui. */
  dnClientId?: string | null;
  /** Processo Finalizado — trava upload/exclusão/alterações, somente leitura. */
  isFinalized?: boolean;
}

export function DocumentsTab({ shipmentId, companyId, isQuoteMode, quoteId, onGeneratePdf, isFinalized }: Props) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const locked = !!isFinalized;
  // Arquivo(s) escolhidos (via botão ou arraste) aguardando a categoria
  // obrigatória antes do envio efetivo.
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
  const [uploadCategory, setUploadCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [saveNewCategory, setSaveNewCategory] = useState(true);
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Categorias personalizadas já cadastradas pela empresa (opção "Outro" com
  // "adicionar à lista" marcado em uploads anteriores).
  const { data: customCategories = [], refetch: refetchCustomCategories } = useQuery({
    queryKey: ['document-custom-categories', companyId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('document_custom_categories' as any)
        .select('id, name') as any)
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
    enabled: !!companyId,
  });

  const { data: documents = [], refetch } = useQuery({
    queryKey: ['documents', shipmentId, isQuoteMode ? 'quote' : 'shipment'],
    queryFn: async () => {
      if (isQuoteMode) {
        const { data, error } = await (supabase
          .from('documents')
          .select('*') as any)
          .eq('quote_id', shipmentId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
      }
      let query = supabase
        .from('documents')
        .select('*');
      if (quoteId) {
        query = query.or(`shipment_id.eq.${shipmentId},quote_id.eq.${quoteId}`);
      } else {
        query = query.eq('shipment_id', shipmentId);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Envio de arquivo(s) — em vez de subir na hora, guarda os arquivos e abre
  // o diálogo pedindo a categoria (obrigatória) antes de efetivar o envio.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (locked) { toast.error('Processo finalizado — não é possível anexar documentos.'); return; }
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    setUploadCategory('');
    setNewCategoryName('');
    setSaveNewCategory(true);
    setExpiresAt(undefined);
    setPendingUploadFiles(files);
  }, [locked]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Importante: converter para array ANTES de limpar e.target.value — o
    // FileList de e.target.files é "vivo" e esvazia junto com o input, então
    // limpar o value primeiro fazia o array sair vazio e nada subia.
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    if (locked) { toast.error('Processo finalizado — não é possível anexar documentos.'); return; }
    setUploadCategory('');
    setNewCategoryName('');
    setSaveNewCategory(true);
    setExpiresAt(undefined);
    setPendingUploadFiles(files);
  };

  // Categoria digitada é válida apenas quando "Outro" está selecionado e o
  // campo de texto foi preenchido.
  const trimmedNewCategory = newCategoryName.trim();
  const isNewCategorySelected = uploadCategory === NEW_CATEGORY_VALUE;
  const canConfirmUpload = isNewCategorySelected ? !!trimmedNewCategory : !!uploadCategory;

  async function confirmUpload() {
    if (locked) { toast.error('Processo finalizado — não é possível anexar documentos.'); return; }
    if (!pendingUploadFiles || !canConfirmUpload) return;
    setUploading(true);
    try {
      // Resolve a categoria escolhida para (document_type, custom_category):
      // - item fixo do enum -> document_type = valor, custom_category = null
      // - categoria personalizada já salva -> document_type = 'other', custom_category = nome
      // - "Outro" digitado agora -> document_type = 'other', custom_category = texto digitado
      let documentType: string;
      let customCategory: string | null;
      if (isNewCategorySelected) {
        documentType = 'other';
        customCategory = trimmedNewCategory;
      } else if (uploadCategory.startsWith(CUSTOM_PREFIX)) {
        documentType = 'other';
        customCategory = uploadCategory.slice(CUSTOM_PREFIX.length);
      } else {
        documentType = uploadCategory;
        customCategory = null;
      }

      // Se o usuário digitou uma categoria nova e marcou para salvá-la, guarda
      // na lista da empresa para aparecer como opção nos próximos uploads.
      if (isNewCategorySelected && saveNewCategory && trimmedNewCategory) {
        const alreadyExists = customCategories.some(
          (c) => c.name.toLowerCase() === trimmedNewCategory.toLowerCase()
        );
        if (!alreadyExists) {
          const { error: categoryError } = await supabase
            .from('document_custom_categories' as any)
            .insert({ company_id: companyId, name: trimmedNewCategory, created_by: profile?.user_id } as any);
          if (categoryError) toast.error(categoryError.message);
          else refetchCustomCategories();
        }
      }

      for (const file of pendingUploadFiles) {
        const path = `${companyId}/${shipmentId}/${Date.now()}_${sanitizeStorageFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from('shipment-documents').upload(path, file);
        if (uploadError) { toast.error(uploadError.message); continue; }
        await supabase.from('documents').insert({
          shipment_id: isQuoteMode ? null : shipmentId,
          quote_id: isQuoteMode ? shipmentId : (quoteId ?? null),
          company_id: companyId,
          name: file.name,
          file_url: path,
          file_size: file.size,
          uploaded_by: profile?.user_id,
          document_type: documentType as any,
          custom_category: customCategory,
          expires_at: expiresAt ? format(expiresAt, 'yyyy-MM-dd') : null,
        } as any);
      }
      refetch();
      toast.success(`${pendingUploadFiles.length} arquivo(s) enviado(s)`);
      setPendingUploadFiles(null);
      setUploadCategory('');
      setNewCategoryName('');
      setSaveNewCategory(true);
      setExpiresAt(undefined);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold">{t('shipments.documents')}</CardTitle>
        <div className="flex gap-2">
          {onGeneratePdf && (
            <Button variant="outline" size="sm" onClick={onGeneratePdf}>
              <FileText className="w-4 h-4 mr-2" />
              Gerar PDF
            </Button>
          )}
          <label>
            <Button variant="outline" size="sm" asChild disabled={locked}>
              <span><Upload className="w-4 h-4 mr-2" /> {t('common.upload')}</span>
            </Button>
            <input type="file" className="hidden" multiple onChange={handleFileInput} />
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {locked && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 mb-4">
            Processo finalizado — somente leitura. Para editar, reabra o processo em Admin &gt; Reabrir Processos.
          </div>
        )}
        {/* Drop zone */}
        {!locked && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border-2 border-dashed border-border rounded-xl p-8 text-center mb-4 hover:border-primary/50 transition-colors"
        >
          <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Arraste os arquivos aqui</p>
        </div>
        )}

        {/* Document list */}
        <div className="space-y-2">
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t('common.no_data')}</p>
          ) : (
            documents.map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{doc.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{doc.custom_category || DOC_TYPE_LABELS[doc.document_type] || doc.document_type} • {doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} KB` : ''}</p>
                    {doc.expires_at && <ExpiryBadge expiresAt={doc.expires_at} />}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {doc.file_url && (
                    <>
                      <Button variant="ghost" size="icon" title="Visualizar"
                        onClick={() => openSignedDoc(doc.file_url).catch((e) => toast.error(e.message))}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Baixar"
                        onClick={() => openSignedDoc(doc.file_url, true).catch((e) => toast.error(e.message))}>
                        <Download className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title={doc.visible_tracking ? 'Visível no Tracking' : 'Oculto no Tracking'}
                    onClick={async () => {
                      const { error } = await (supabase.from('documents').update({ visible_tracking: !doc.visible_tracking } as any).eq('id', doc.id) as any);
                      if (error) { toast.error(error.message); return; }
                      refetch();
                      toast.success(doc.visible_tracking ? 'Removido do tracking' : 'Disponível no tracking');
                    }}
                  >
                    <Radio className={`w-4 h-4 ${doc.visible_tracking ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" disabled={locked} title="Excluir" onClick={async () => {
                    if (locked) { toast.error('Processo finalizado — não é possível excluir documentos.'); return; }
                    const { error } = await supabase.from('documents').delete().eq('id', doc.id);
                    if (error) { toast.error(error.message); return; }
                    refetch();
                    toast.success('Documento excluído');
                  }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>

      {/* Categoria obrigatória antes de efetivar o envio. */}
      <Dialog open={!!pendingUploadFiles} onOpenChange={(o) => {
        if (!o && !uploading) {
          setPendingUploadFiles(null);
          setUploadCategory('');
          setNewCategoryName('');
          setSaveNewCategory(true);
          setExpiresAt(undefined);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Categoria do documento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {pendingUploadFiles?.length === 1
                ? pendingUploadFiles[0].name
                : `${pendingUploadFiles?.length ?? 0} arquivo(s) selecionado(s)`}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Categoria *</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bl">BL</SelectItem>
                  <SelectItem value="invoice">Invoice</SelectItem>
                  <SelectItem value="packing_list">Packing List</SelectItem>
                  <SelectItem value="certificate_origin">Certificado de Origem</SelectItem>
                  <SelectItem value="customs_declaration">Declaração Aduaneira</SelectItem>
                  <SelectItem value="insurance">Seguro</SelectItem>
                  <SelectItem value="dta">DTA</SelectItem>
                  <SelectItem value="outros">Outros</SelectItem>
                  {customCategories.map((c) => (
                    <SelectItem key={c.id} value={`${CUSTOM_PREFIX}${c.name}`}>{c.name}</SelectItem>
                  ))}
                  <SelectItem value={NEW_CATEGORY_VALUE}>Outro (digitar categoria)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isNewCategorySelected && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome da categoria *</Label>
                  <Input
                    autoFocus
                    placeholder="Ex.: Romaneio, Laudo, Contrato..."
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="save-new-category"
                    checked={saveNewCategory}
                    onCheckedChange={(v) => setSaveNewCategory(v === true)}
                  />
                  <Label htmlFor="save-new-category" className="text-xs font-normal text-muted-foreground cursor-pointer">
                    Adicionar à lista de categorias para uso futuro
                  </Label>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Data de validade (opcional)</Label>
              <DateField value={expiresAt} onChange={setExpiresAt} placeholder="Sem validade" />
              {expiresAt && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => setExpiresAt(undefined)}
                >
                  Remover data
                </button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingUploadFiles(null);
                setUploadCategory('');
                setNewCategoryName('');
                setSaveNewCategory(true);
                setExpiresAt(undefined);
              }}
              disabled={uploading}
            >
              Cancelar
            </Button>
            <Button onClick={confirmUpload} disabled={!canConfirmUpload || uploading}>
              {uploading ? 'Enviando…' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Só indicação visual de validade — este fluxo não dispara alerta/e-mail
// (isso existe hoje só para documentos de cliente, em ClientDocumentsSection).
function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const days = differenceInCalendarDays(new Date(expiresAt), new Date());
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <AlertTriangle className="w-3 h-3" /> Vencido em {format(new Date(expiresAt), 'dd/MM/yyyy')}
      </span>
    );
  }
  if (days <= 7) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-500">
        <AlertTriangle className="w-3 h-3" /> Vence em {format(new Date(expiresAt), 'dd/MM/yyyy')}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Válido até {format(new Date(expiresAt), 'dd/MM/yyyy')}</span>;
}

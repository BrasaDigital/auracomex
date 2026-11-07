import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { openSignedDoc, DOCS_BUCKET } from '@/lib/storage';
import { sanitizeStorageFileName } from '@/lib/sanitizeFileName';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, differenceInCalendarDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Upload, FileText, Download, Eye, Trash2, CalendarIcon, AlertTriangle, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateField } from '@/components/shared/DateField';

interface Props {
  clientId: string;
  companyId: string;
}

export function ClientDocumentsSection({ clientId, companyId }: Props) {
  const { profile } = useAuth();
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: documents = [], refetch } = useQuery({
    queryKey: ['client-documents', clientId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('documents') as any)
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  // Só pra mostrar um aviso caso a empresa ainda não tenha configurado o
  // e-mail de alertas (o envio em si é feito pela Edge Function agendada).
  const { data: company } = useQuery({
    queryKey: ['company-alert-email', companyId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('companies') as any)
        .select('document_alert_email')
        .eq('id', companyId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const path = `${companyId}/clients/${clientId}/${Date.now()}_${sanitizeStorageFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from(DOCS_BUCKET).upload(path, file);
        if (uploadError) {
          toast.error(uploadError.message);
          continue;
        }
        const { error } = await (supabase.from('documents') as any).insert({
          client_id: clientId,
          company_id: companyId,
          name: file.name,
          file_url: path,
          file_size: file.size,
          uploaded_by: profile?.user_id,
          document_type: 'other',
          expires_at: expiresAt ? format(expiresAt, 'yyyy-MM-dd') : null,
        });
        if (error) toast.error(error.message);
      }
      refetch();
      toast.success(`${files.length} arquivo(s) enviado(s)`);
    } finally {
      setUploading(false);
    }
  }, [clientId, companyId, profile, expiresAt, refetch]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    uploadFiles(Array.from(e.dataTransfer.files));
  }, [uploadFiles]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    uploadFiles(Array.from(files));
    e.target.value = '';
  };

  function expiryBadge(expiresAtStr: string | null) {
    if (!expiresAtStr) return null;
    const days = differenceInCalendarDays(new Date(expiresAtStr), new Date());
    if (days < 0) {
      return <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="w-3 h-3" /> Vencido em {format(new Date(expiresAtStr), 'dd/MM/yyyy')}</span>;
    }
    if (days <= 7) {
      return <span className="inline-flex items-center gap-1 text-xs text-amber-500"><AlertTriangle className="w-3 h-3" /> Vence em {format(new Date(expiresAtStr), 'dd/MM/yyyy')}</span>;
    }
    return <span className="text-xs text-muted-foreground">Válido até {format(new Date(expiresAtStr), 'dd/MM/yyyy')}</span>;
  }

  return (
    <Card className="glass">
      <CardHeader className="space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold">Documentos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Data de validade, aplicada ao(s) próximo(s) upload(s) */}
        <div className="space-y-1 max-w-xs">
          <Label className="text-xs">Data de validade (opcional)</Label>
          <DateField value={expiresAt} onChange={setExpiresAt} placeholder="Sem validade" />
        </div>
        {expiresAt && (
          <p className="text-xs text-muted-foreground -mt-1 flex items-center gap-1">
            <Mail className="w-3 h-3 shrink-0" />
            {company?.document_alert_email
              ? `Um alerta será enviado pra ${company.document_alert_email} quando faltar 7 dias pro vencimento.`
              : 'Nenhum e-mail de alertas configurado — cadastre um em Configurações > Empresa pra receber o aviso de vencimento.'}
          </p>
        )}

        {/* Drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 transition-colors"
        >
          <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-2">Arraste os arquivos aqui</p>
          <label>
            <Button variant="outline" size="sm" type="button" asChild disabled={uploading}>
              <span><Upload className="w-4 h-4 mr-2" /> {uploading ? 'Enviando...' : 'Selecionar arquivo'}</span>
            </Button>
            <input type="file" className="hidden" multiple onChange={handleFileInput} disabled={uploading} />
          </label>
        </div>

        {/* Document list */}
        <div className="space-y-2">
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum documento cadastrado</p>
          ) : (
            documents.map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    {expiryBadge(doc.expires_at)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {doc.file_url && (
                    <>
                      <Button variant="ghost" size="icon" title="Visualizar" type="button"
                        onClick={() => openSignedDoc(doc.file_url).catch((e) => toast.error(e.message))}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Baixar" type="button"
                        onClick={() => openSignedDoc(doc.file_url, true).catch((e) => toast.error(e.message))}>
                        <Download className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="icon" type="button" className="text-destructive hover:text-destructive" title="Excluir" onClick={async () => {
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
    </Card>
  );
}

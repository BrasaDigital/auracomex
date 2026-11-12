import React, { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { FileDown, Trash2, Info, Paperclip, X, Loader2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useAccountability, AccountabilityItemRow, AccountabilityCategoria } from '@/hooks/useAccountability';
import { DebouncedInput } from './DebouncedInput';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AccountabilityPdfDialog } from './AccountabilityPdfDialog';
import { openSignedDoc } from '@/lib/storage';

interface Props {
  quoteId: string;
  quote: any;
  companyId?: string;
  /** Processo Finalizado — trava edição, upload de comprovante e exclusão da prestação. */
  isFinalized?: boolean;
  /** Exportação: sem Numerário — a Prestação de Contas é iniciada direto e os itens são lançados à mão. */
  isExport?: boolean;
}

function fmtBRL(n: number) {
  return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const categoriaLabels: Record<AccountabilityCategoria, string> = {
  origin: 'Origem',
  freight: 'Frete/Seguro',
  destination: 'Destino',
  local: 'Local',
  tax: 'Imposto',
  afrmm: 'AFRMM',
  siscomex: 'Siscomex',
  other: 'Outro',
};

export function AccountabilityTab({ quoteId, quote, companyId, isFinalized, isExport }: Props) {
  const { profile } = useAuth();
  const { data, isLoading, createManual, addItem, removeItem, updateItem, setConfirmado, attachComprovante, removeComprovante, recomputeTotals, removeAccountability } = useAccountability(quoteId, companyId);
  const locked = !!isFinalized;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [newDesc, setNewDesc] = useState('');
  const [newValor, setNewValor] = useState('');
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const accountability = data?.accountability || null;
  const items = data?.items || [];

  if (isLoading) return <Card className="glass"><CardContent className="py-10 text-center text-muted-foreground">Carregando…</CardContent></Card>;
  if (!accountability) {
    return (
      <Card className="glass">
        <CardContent className="py-12 text-center text-muted-foreground space-y-3">
          {isExport ? (
            <>
              <p>Exportação não passa pelo Numerário. Inicie a Prestação de Contas e lance os itens direto.</p>
              <Button
                size="sm"
                disabled={locked || starting}
                onClick={async () => {
                  setStarting(true);
                  try { await createManual(profile?.user_id); }
                  catch (e: any) { toast.error(e.message || 'Erro ao iniciar a Prestação de Contas.'); }
                  finally { setStarting(false); }
                }}
              >
                {starting ? 'Iniciando…' : 'Iniciar Prestação de Contas'}
              </Button>
            </>
          ) : (
            'Nenhuma Prestação de Contas gerada. Aprove o Numerário na aba Desembaraço para criar.'
          )}
        </CardContent>
      </Card>
    );
  }

  const handleCommitPago = async (item: AccountabilityItemRow, valor: number) => {
    if (locked) { toast.error('Processo finalizado — não é possível editar a prestação de contas.'); return; }
    try {
      await updateItem(item.id, { valor_pago_brl: valor, confirmado: true });
      await recomputeTotals(accountability.id);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar valor pago.');
    }
  };

  const handleCommitVendaFinal = async (item: AccountabilityItemRow, valor: number) => {
    if (locked) { toast.error('Processo finalizado — não é possível editar a prestação de contas.'); return; }
    try {
      await updateItem(item.id, { valor_venda_final_brl: Number.isFinite(valor) ? valor : null });
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar a venda final.');
    }
  };

  const handleToggleConfirmado = async (item: AccountabilityItemRow, confirmado: boolean) => {
    if (locked) { toast.error('Processo finalizado — não é possível editar a prestação de contas.'); return; }
    try {
      await setConfirmado(item, confirmado);
      await recomputeTotals(accountability.id);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao confirmar item.');
    }
  };

  const handleSelectFile = async (item: AccountabilityItemRow, file: File | undefined) => {
    if (!file) return;
    if (locked) { toast.error('Processo finalizado — não é possível anexar comprovantes.'); return; }
    setUploadingId(item.id);
    try {
      await attachComprovante(item, file, quote);
      toast.success('Comprovante anexado e enviado pra aba Documentos.');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao enviar comprovante.');
    } finally {
      setUploadingId(null);
      const input = fileInputRefs.current[item.id];
      if (input) input.value = '';
    }
  };

  const handleRemoveComprovante = async (item: AccountabilityItemRow) => {
    if (locked) { toast.error('Processo finalizado — não é possível remover comprovantes.'); return; }
    try {
      await removeComprovante(item.id);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao remover comprovante.');
    }
  };

  const handleAddItem = async () => {
    if (locked) { toast.error('Processo finalizado — não é possível editar a prestação de contas.'); return; }
    const valor = parseFloat(newValor.replace(/\./g, '').replace(',', '.'));
    if (!newDesc.trim()) { toast.error('Informe a descrição do item.'); return; }
    if (!Number.isFinite(valor) || valor <= 0) { toast.error('Informe um valor maior que zero.'); return; }
    try {
      await addItem(accountability.id, { categoria: 'other', descricao: newDesc.trim(), valor_orcado_brl: valor, ordem: items.length });
      await recomputeTotals(accountability.id);
      setNewDesc('');
      setNewValor('');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao adicionar item.');
    }
  };

  const handleRemoveItem = async (item: AccountabilityItemRow) => {
    if (locked) { toast.error('Processo finalizado — não é possível editar a prestação de contas.'); return; }
    try {
      await removeItem(item.id);
      await recomputeTotals(accountability.id);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao remover item.');
    }
  };

  // Estimado = valor_orcado_brl; Compra = valor pago real (vazio = igual ao Estimado); Venda Final vazia = Estimado.
  // Saldo = Estimado − Compra: positivo = a compra saiu abaixo do estimado; negativo = acima (ajustar a venda final).
  const totalEstimado = items.reduce((s, i) => s + Number(i.valor_orcado_brl || 0), 0);
  const totalCompra = items.reduce((s, i) => s + Number(i.valor_pago_brl ?? i.valor_orcado_brl ?? 0), 0);
  const totalVendaFinal = items.reduce((s, i) => s + Number(i.valor_venda_final_brl ?? i.valor_orcado_brl ?? 0), 0);
  const saldoTotal = totalEstimado - totalCompra;
  const pendentes = items.filter(i => !i.confirmado).length;

  return (
    <fieldset disabled={locked} className="contents">
    <div className="space-y-4">
      {locked && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Processo finalizado — somente leitura. Para editar, reabra o processo em Admin &gt; Reabrir Processos.
        </div>
      )}
      {pendentes > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          <Info className="w-4 h-4 shrink-0" />
          <span><strong>{pendentes} ite{pendentes > 1 ? 'ns' : 'm'} pendente{pendentes > 1 ? 's' : ''} de confirmação:</strong> confira o valor da compra real de cada linha antes de gerar o PDF final.</span>
        </div>
      )}

      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Prestação de Contas — Estimado, Compra, Saldo e Venda Final</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => setPdfOpen(true)}>
              <FileDown className="w-3.5 h-3.5 mr-1" /> Gerar PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              disabled={locked}
              onClick={() => {
                if (locked) { toast.error('Processo finalizado — não é possível excluir a prestação de contas.'); return; }
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> {isExport ? 'Excluir Prestação' : 'Excluir Prestação (destrava Desembaraço)'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="h-7">
                <TableHead className="py-1">Categoria</TableHead>
                <TableHead className="py-1">Descrição</TableHead>
                <TableHead className="py-1 text-right">Estimado (R$)</TableHead>
                <TableHead className="py-1 text-right">Compra (R$)</TableHead>
                <TableHead className="py-1 text-right">Saldo (R$)</TableHead>
                <TableHead className="py-1 text-right">Venda Final (R$)</TableHead>
                <TableHead className="py-1 text-center">Confirmado</TableHead>
                <TableHead className="py-1">Comprovante</TableHead>
                {isExport && <TableHead className="py-1 w-8" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => {
                const compra = item.valor_pago_brl ?? item.valor_orcado_brl;
                const saldo = Number(item.valor_orcado_brl) - Number(compra);
                const vendaFinal = item.valor_venda_final_brl ?? item.valor_orcado_brl;
                const uploading = uploadingId === item.id;
                return (
                  <TableRow key={item.id} className={`h-8 ${item.confirmado ? '' : 'bg-amber-50/40'}`}>
                    <TableCell className="py-1"><Badge variant="outline" className="text-[10px]">{categoriaLabels[item.categoria] || item.categoria}</Badge></TableCell>
                    <TableCell className="py-1 text-xs">{item.descricao}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-xs text-muted-foreground">{fmtBRL(item.valor_orcado_brl)}</TableCell>
                    <TableCell className="py-1 text-right">
                      <DebouncedInput
                        type="number"
                        step="0.01"
                        value={compra}
                        onCommit={(v) => handleCommitPago(item, Number(v))}
                        className="h-7 w-28 ml-auto text-right text-xs font-mono"
                      />
                    </TableCell>
                    <TableCell className={`py-1 text-right font-mono text-xs ${saldo < 0 ? 'text-red-600' : saldo > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                      {saldo > 0 ? '+' : ''}{fmtBRL(saldo)}
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      <DebouncedInput
                        type="number"
                        step="0.01"
                        value={vendaFinal}
                        onCommit={(v) => handleCommitVendaFinal(item, Number(v))}
                        className="h-7 w-28 ml-auto text-right text-xs font-mono"
                      />
                    </TableCell>
                    <TableCell className="py-1 text-center">
                      <Checkbox checked={item.confirmado} onCheckedChange={(c) => handleToggleConfirmado(item, !!c)} />
                    </TableCell>
                    <TableCell className="py-1">
                      <input
                        ref={(el) => { fileInputRefs.current[item.id] = el; }}
                        type="file"
                        className="hidden"
                        onChange={(e) => handleSelectFile(item, e.target.files?.[0])}
                      />
                      {uploading ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Enviando…</span>
                      ) : item.comprovante_name ? (
                        <div className="flex items-center gap-1 max-w-[160px]">
                          <button
                            type="button"
                            className="text-[11px] text-primary underline truncate"
                            title={item.comprovante_name}
                            onClick={() => openSignedDoc(item.comprovante_url).catch((e: any) => toast.error(e.message))}
                          >
                            {item.comprovante_name}
                          </button>
                          <button type="button" title="Remover" onClick={() => handleRemoveComprovante(item)} className="text-muted-foreground hover:text-destructive shrink-0">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px] text-muted-foreground"
                          onClick={() => fileInputRefs.current[item.id]?.click()}
                        >
                          <Paperclip className="w-3 h-3 mr-1" /> Anexar
                        </Button>
                      )}
                    </TableCell>
                    {isExport && (
                      <TableCell className="py-1">
                        <button type="button" title="Remover item" onClick={() => handleRemoveItem(item)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {isExport && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Input className="h-8 max-w-xs text-xs" placeholder="Descrição (ex.: Taxa de THC)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              <Input className="h-8 w-32 text-xs text-right font-mono" inputMode="decimal" placeholder="Valor (R$)" value={newValor} onChange={(e) => setNewValor(e.target.value)} />
              <Button type="button" size="sm" variant="outline" onClick={handleAddItem}><Plus className="w-3.5 h-3.5 mr-1" /> Adicionar item</Button>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-sm space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Estimado</span><span className="font-mono">R$ {fmtBRL(totalEstimado)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total Compra</span><span className="font-mono">R$ {fmtBRL(totalCompra)}</span></div>
              <div className={`flex justify-between font-semibold pt-1 border-t ${saldoTotal < 0 ? 'text-red-600' : saldoTotal > 0 ? 'text-emerald-600' : ''}`}>
                <span>{saldoTotal < 0 ? 'Saldo (compra acima do estimado)' : saldoTotal > 0 ? 'Saldo (compra abaixo do estimado)' : 'Saldo (sem diferença)'}</span>
                <span className="font-mono">{saldoTotal > 0 ? '+' : saldoTotal < 0 ? '−' : ''}R$ {fmtBRL(Math.abs(saldoTotal))}</span>
              </div>
              <div className="flex justify-between font-semibold text-base pt-2 border-t"><span>Total Venda Final</span><span className="font-mono">R$ {fmtBRL(totalVendaFinal)}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <AccountabilityPdfDialog
        open={pdfOpen}
        onClose={() => setPdfOpen(false)}
        quote={quote}
        accountability={accountability}
        items={items}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta Prestação de Contas?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os valores pagos confirmados serão perdidos e a aba Desembaraço voltará a ficar editável. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (locked) { toast.error('Processo finalizado — não é possível excluir a prestação de contas.'); return; }
                setDeleting(true);
                try {
                  await removeAccountability(accountability.id);
                  toast.success('Prestação de Contas excluída. Desembaraço destravado.');
                  setDeleteOpen(false);
                } catch (err: any) {
                  toast.error(err.message || 'Erro ao excluir prestação de contas');
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </fieldset>
  );
}

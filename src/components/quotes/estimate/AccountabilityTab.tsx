import React, { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { useColumnWidths } from '@/hooks/useColumnWidths';

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

// Larguras padrão (px) das colunas; a pessoa ajusta arrastando a borda do cabeçalho e fica salvo no navegador dela.
const COLUNAS_PADRAO: Record<string, number> = { cat: 110, desc: 260, est: 120, compra: 130, saldo: 120, venda: 130, conf: 90, comp: 170 };

function ResizableHead({ colKey, className, children, startResize, resetOne }: {
  colKey: string;
  className?: string;
  children: React.ReactNode;
  startResize: (key: string) => (e: React.PointerEvent) => void;
  resetOne: (key: string) => void;
}) {
  return (
    <TableHead className={`relative py-1 ${className || ''}`}>
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        title="Arraste para ajustar a largura (duplo clique restaura)"
        onPointerDown={startResize(colKey)}
        onDoubleClick={() => resetOne(colKey)}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none border-r border-border hover:bg-primary/30"
      />
    </TableHead>
  );
}

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
  const { widths, startResize, resetOne, reset: resetWidths, isCustom } = useColumnWidths('accountability-col-widths', COLUNAS_PADRAO);
  // Compra e Saldo ficam OCULTAS por padrão; o botão "Mostrar Compra e Saldo" (guardado no navegador de cada pessoa) exibe.
  const [mostrarCompra, setMostrarCompra] = useState<boolean>(() => {
    try { return localStorage.getItem('accountability-show-compra') === '1'; } catch { return false; }
  });
  const alternarCompra = () => setMostrarCompra(v => {
    const novo = !v;
    try { localStorage.setItem('accountability-show-compra', novo ? '1' : '0'); } catch { /* sem armazenamento: vale só na sessão */ }
    return novo;
  });
  const colunasVisiveis = Object.keys(COLUNAS_PADRAO).filter(k => mostrarCompra || (k !== 'compra' && k !== 'saldo'));
  const larguraTabela = colunasVisiveis.reduce((a, k) => a + widths[k], 0) + (isExport ? 32 : 0);

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
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 || 0;
  const saldoTotal = r2(totalEstimado - totalCompra);
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
          <span><strong>{pendentes} ite{pendentes > 1 ? 'ns' : 'm'} pendente{pendentes > 1 ? 's' : ''} de confirmação:</strong> confira cada linha antes de gerar o PDF final (a compra real fica no botão Mostrar Compra e Saldo).</span>
        </div>
      )}

      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">{mostrarCompra ? 'Prestação de Contas — Estimado, Compra, Saldo e Venda Final' : 'Prestação de Contas — Estimado e Venda Final'}</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={alternarCompra}>
              {mostrarCompra ? 'Ocultar Compra e Saldo' : 'Mostrar Compra e Saldo'}
            </Button>
            {isCustom && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={resetWidths}>
                Redefinir larguras
              </Button>
            )}
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
          <Table className="table-fixed" style={{ width: larguraTabela }}>
            <colgroup>
              {colunasVisiveis.map(k => <col key={k} style={{ width: widths[k] }} />)}
              {isExport && <col style={{ width: 32 }} />}
            </colgroup>
            <TableHeader>
              <TableRow className="h-7">
                <ResizableHead colKey="cat" startResize={startResize} resetOne={resetOne}>Categoria</ResizableHead>
                <ResizableHead colKey="desc" startResize={startResize} resetOne={resetOne}>Descrição</ResizableHead>
                <ResizableHead colKey="est" className="text-right" startResize={startResize} resetOne={resetOne}>Estimado (R$)</ResizableHead>
                {mostrarCompra && <ResizableHead colKey="compra" className="text-right" startResize={startResize} resetOne={resetOne}>Compra (R$)</ResizableHead>}
                {mostrarCompra && <ResizableHead colKey="saldo" className="text-right" startResize={startResize} resetOne={resetOne}>Saldo (R$)</ResizableHead>}
                <ResizableHead colKey="venda" className="text-right" startResize={startResize} resetOne={resetOne}>Venda Final (R$)</ResizableHead>
                <ResizableHead colKey="conf" className="text-center" startResize={startResize} resetOne={resetOne}>Confirmado</ResizableHead>
                <ResizableHead colKey="comp" startResize={startResize} resetOne={resetOne}>Comprovante</ResizableHead>
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
                    <TableCell className="py-1 text-xs break-words">{item.descricao}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-xs text-muted-foreground">{fmtBRL(item.valor_orcado_brl)}</TableCell>
                    {mostrarCompra && (
                      <TableCell className="py-1 text-right">
                        <DebouncedInput
                          type="number"
                          step="0.01"
                          value={compra}
                          onCommit={(v) => handleCommitPago(item, Number(v))}
                          className="h-7 w-full min-w-0 text-right text-xs font-mono"
                        />
                      </TableCell>
                    )}
                    {mostrarCompra && (
                      <TableCell className={`py-1 text-right font-mono text-xs ${saldo < 0 ? 'text-red-600' : saldo > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {saldo > 0 ? '+' : ''}{fmtBRL(saldo)}
                      </TableCell>
                    )}
                    <TableCell className="py-1 text-right">
                      <DebouncedInput
                        type="number"
                        step="0.01"
                        value={vendaFinal}
                        onCommit={(v) => handleCommitVendaFinal(item, Number(v))}
                        className="h-7 w-full min-w-0 text-right text-xs font-mono"
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
                        <div className="flex items-center gap-1 min-w-0">
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
            {/* Linha TOTAL: soma de cada coluna (Venda Final = valor a receber). Saldo = Estimado − Compra. */}
            <TableFooter>
              <TableRow className="h-8 font-semibold">
                <TableCell className="py-1 text-xs" colSpan={2}>TOTAL</TableCell>
                <TableCell className="py-1 text-right font-mono text-xs">{fmtBRL(r2(totalEstimado))}</TableCell>
                {mostrarCompra && <TableCell className="py-1 text-right font-mono text-xs">{fmtBRL(r2(totalCompra))}</TableCell>}
                {mostrarCompra && <TableCell className={`py-1 text-right font-mono text-xs ${saldoTotal < 0 ? 'text-red-600' : saldoTotal > 0 ? 'text-emerald-600' : ''}`}>{saldoTotal > 0 ? '+' : ''}{fmtBRL(saldoTotal)}</TableCell>}
                <TableCell className="py-1 text-right font-mono text-xs">{fmtBRL(r2(totalVendaFinal))}</TableCell>
                <TableCell className="py-1" colSpan={isExport ? 3 : 2} />
              </TableRow>
            </TableFooter>
          </Table>

          {isExport && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Input className="h-8 max-w-xs text-xs" placeholder="Descrição (ex.: Taxa de THC)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              <Input className="h-8 w-32 text-xs text-right font-mono" inputMode="decimal" placeholder="Valor (R$)" value={newValor} onChange={(e) => setNewValor(e.target.value)} />
              <Button type="button" size="sm" variant="outline" onClick={handleAddItem}><Plus className="w-3.5 h-3.5 mr-1" /> Adicionar item</Button>
            </div>
          )}

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

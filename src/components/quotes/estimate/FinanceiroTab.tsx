import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAccountability } from '@/hooks/useAccountability';
import { useProcessDeposits, ProcessDepositRow } from '@/hooks/useProcessDeposits';
import { DateField } from '@/components/shared/DateField';
import { openSignedDoc } from '@/lib/storage';
import { AccountabilityTab } from './AccountabilityTab';
import { ClientDebitNotesTab } from '../ClientDebitNotesTab';

interface Props {
  quoteId: string;
  quote: any;
  companyId?: string;
  /** Processo Finalizado — trava lançamento/remoção de depósitos e comprovantes. */
  isFinalized?: boolean;
  /** Exportação: Prestação de Contas direta, sem Numerário. */
  isExport?: boolean;
}

function fmtBRL(n: number) {
  return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Aba "Financeiro" do processo: o "caixa" do cliente. No topo, o saldo dos
// depósitos; logo abaixo, os depósitos; e embaixo a Prestação de Contas, que
// vai abatendo do saldo à medida que cada item é confirmado como pago.
export function FinanceiroTab({ quoteId, quote, companyId, isFinalized, isExport }: Props) {
  const { profile } = useAuth();
  const locked = !!isFinalized;
  const { data: accData } = useAccountability(quoteId, companyId);
  const { data: deposits = [], isLoading, addDeposit, removeDeposit, attachComprovante, removeComprovante } = useProcessDeposits(quoteId, companyId);

  const [depDate, setDepDate] = useState<Date | undefined>(new Date());
  const [depAmount, setDepAmount] = useState('');
  const [depNote, setDepNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const items = accData?.items || [];
  const totalDepositado = deposits.reduce((s, d) => s + Number(d.amount_brl || 0), 0);
  // Só abate o que o usuário já marcou como pago (confirmado).
  const totalPago = items
    .filter(i => i.confirmado)
    .reduce((s, i) => s + Number(i.valor_pago_brl ?? i.valor_orcado_brl ?? 0), 0);
  const saldo = totalDepositado - totalPago;

  async function handleAdd() {
    if (locked) { toast.error('Processo finalizado — não é possível lançar depósitos.'); return; }
    const amount = parseFloat(depAmount.replace(/\./g, '').replace(',', '.'));
    if (!depDate) { toast.error('Informe a data do depósito.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Informe um valor maior que zero.'); return; }
    setSaving(true);
    try {
      await addDeposit({ deposit_date: format(depDate, 'yyyy-MM-dd'), amount_brl: amount, note: depNote, userId: profile?.user_id });
      setDepAmount('');
      setDepNote('');
      setDepDate(new Date());
      toast.success('Depósito lançado.');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao lançar depósito.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(d: ProcessDepositRow) {
    if (locked) { toast.error('Processo finalizado — não é possível remover depósitos.'); return; }
    if (!window.confirm(`Remover o depósito de R$ ${fmtBRL(d.amount_brl)} (${fmtDate(d.deposit_date)})?`)) return;
    try {
      await removeDeposit(d.id);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao remover depósito.');
    }
  }

  async function handleSelectFile(d: ProcessDepositRow, file: File | undefined) {
    if (!file) return;
    if (locked) { toast.error('Processo finalizado — não é possível anexar comprovantes.'); return; }
    setUploadingId(d.id);
    try {
      await attachComprovante(d, file, quote);
      toast.success('Comprovante anexado e enviado pra aba Documentos.');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao enviar comprovante.');
    } finally {
      setUploadingId(null);
      const input = fileInputRefs.current[d.id];
      if (input) input.value = '';
    }
  }

  return (
    <div className="space-y-4">
      {/* Saldo do cliente */}
      <Card className="glass">
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Depositado pelo cliente</p>
              <p className="text-lg font-semibold font-mono">R$ {fmtBRL(totalDepositado)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pago (confirmado na prestação)</p>
              <p className="text-lg font-semibold font-mono">R$ {fmtBRL(totalPago)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {saldo < 0 ? 'Adicional a cobrar do cliente' : 'Saldo do cliente'}
              </p>
              <p className={`text-2xl font-bold font-mono ${saldo < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                R$ {fmtBRL(Math.abs(saldo))}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Depósitos */}
      <Card className="glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Depósitos do cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!locked && (
            <div className="grid grid-cols-1 md:grid-cols-[170px_160px_1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Data</Label>
                <DateField value={depDate} onChange={setDepDate} allowClear={false} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Valor (R$)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-10 text-right font-mono"
                  value={depAmount}
                  onChange={(e) => setDepAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Observação (opcional)</Label>
                <Input
                  className="h-10"
                  placeholder="Ex: 1º depósito, complemento de impostos..."
                  value={depNote}
                  onChange={(e) => setDepNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                />
              </div>
              <Button className="h-10" onClick={handleAdd} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Lançar
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Carregando…</div>
          ) : deposits.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">
              Nenhum depósito lançado. O cliente pode depositar mais de uma vez: lance cada depósito acima.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="h-7">
                  <TableHead className="py-1 w-28">Data</TableHead>
                  <TableHead className="py-1 text-right w-36">Valor (R$)</TableHead>
                  <TableHead className="py-1">Observação</TableHead>
                  <TableHead className="py-1">Comprovante</TableHead>
                  <TableHead className="py-1 w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deposits.map(d => {
                  const uploading = uploadingId === d.id;
                  return (
                    <TableRow key={d.id} className="h-8">
                      <TableCell className="py-1 text-xs">{fmtDate(d.deposit_date)}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-xs">{fmtBRL(d.amount_brl)}</TableCell>
                      <TableCell className="py-1 text-xs text-muted-foreground">{d.note || '—'}</TableCell>
                      <TableCell className="py-1">
                        <input
                          ref={(el) => { fileInputRefs.current[d.id] = el; }}
                          type="file"
                          className="hidden"
                          onChange={(e) => handleSelectFile(d, e.target.files?.[0])}
                        />
                        {uploading ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Enviando…</span>
                        ) : d.comprovante_name ? (
                          <div className="flex items-center gap-1 max-w-[200px]">
                            <button
                              type="button"
                              className="text-[11px] text-primary underline truncate"
                              title={d.comprovante_name}
                              onClick={() => openSignedDoc(d.comprovante_url).catch((e: any) => toast.error(e.message))}
                            >
                              {d.comprovante_name}
                            </button>
                            {!locked && (
                              <button type="button" title="Remover" onClick={() => removeComprovante(d.id).catch((e: any) => toast.error(e.message))} className="text-muted-foreground hover:text-destructive shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ) : (
                          !locked && (
                            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground" onClick={() => fileInputRefs.current[d.id]?.click()}>
                              <Paperclip className="w-3 h-3 mr-1" /> Anexar
                            </Button>
                          )
                        )}
                      </TableCell>
                      <TableCell className="py-1">
                        {!locked && (
                          <button type="button" title="Remover depósito" onClick={() => handleRemove(d)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Notas de Débito emitidas ao cliente neste processo — cada ND também gera a Conta a
          Receber no Financeiro geral; aqui dá pra acompanhar, ver o PDF, dar baixa e cancelar. */}
      {companyId && (
        <ClientDebitNotesTab
          quoteId={quoteId}
          companyId={companyId}
          clientId={quote?.client_id || null}
          readOnly={locked}
        />
      )}

      {/* Prestação de Contas (já existente) — o "Confirmado" de cada item abate do saldo acima */}
      <AccountabilityTab quoteId={quoteId} quote={quote} companyId={companyId} isFinalized={isFinalized} isExport={isExport} />
    </div>
  );
}

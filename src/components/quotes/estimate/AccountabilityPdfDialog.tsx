import React, { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { AccountabilityRow, AccountabilityItemRow, AccountabilityCategoria } from '@/hooks/useAccountability';
import { PDFDocument } from 'pdf-lib';

interface Props {
  open: boolean;
  onClose: () => void;
  quote: any;
  accountability: AccountabilityRow;
  items: AccountabilityItemRow[];
}

const fmtBRL = (n: number) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

const th: React.CSSProperties = { background: '#f0f0f0', fontSize: 10, fontWeight: 700, padding: '5px 8px', borderBottom: '1px solid #ccc', textAlign: 'left' };
const td: React.CSSProperties = { fontSize: 10, padding: '4px 8px', borderBottom: '1px solid #eee' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'monospace' };

const sheet: React.CSSProperties = {
  width: '210mm',
  minHeight: '294mm',
  padding: '12mm 14mm',
  boxSizing: 'border-box',
  background: '#fff',
  position: 'relative',
};

export function AccountabilityPdfDialog({ open, onClose, quote, accountability, items }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [company, setCompany] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [bank, setBank] = useState<any>(null);
  const [deposits, setDeposits] = useState<{ id: string; deposit_date: string; amount_brl: number; note: string | null }[]>([]);

  useEffect(() => {
    if (!open || !quote?.company_id) return;
    supabase.from('companies').select('*').eq('id', quote.company_id).single().then(r => setCompany(r.data));
    if (quote?.client_id) {
      supabase.from('clients').select('*').eq('id', quote.client_id).single().then(r => setClient(r.data));
    } else {
      setClient(null);
    }
  }, [open, quote?.company_id, quote?.client_id]);

  // Depósitos do cliente (caixa do processo) — entram no PDF e definem o resultado
  // quando o valor orçado está oculto.
  useEffect(() => {
    if (!open || !quote?.id) { setDeposits([]); return; }
    (supabase as any)
      .from('process_deposits')
      .select('id, deposit_date, amount_brl, note')
      .eq('quote_id', quote.id)
      .order('deposit_date', { ascending: true })
      .then((r: any) => setDeposits(r.data || []));
  }, [open, quote?.id]);

  // Dados bancários só fazem sentido quando sobra valor a cobrar do cliente
  // (mesmo critério/conta do Numerário em EstimatePdfDialog.tsx): conta padrão
  // em BRL; sem uma marcada como padrão, cai na primeira conta BRL ativa.
  // Por empresa: mostrar (ou não) ao cliente o valor orçado no pedido do Numerário.
  const showBudget = company?.accountability_show_budget !== false;
  const totalDepositado = deposits.reduce((s, d) => s + Number(d.amount_brl || 0), 0);
  const temDepositos = deposits.length > 0;
  // Orçado visível: resultado = pago − orçado. Orçado oculto: resultado vem dos
  // depósitos (depositado − pago), pra não revelar o orçado de forma indireta.
  const saldoDepositos = totalDepositado - Number(accountability?.total_pago_brl || 0);
  const precisaCobrarCliente = showBudget
    ? Number(accountability?.diferenca_brl || 0) > 0
    : temDepositos && saldoDepositos < 0;
  useEffect(() => {
    if (!open || !quote?.company_id || !precisaCobrarCliente) { setBank(null); return; }
    supabase
      .from('company_bank_accounts' as any)
      .select('*')
      .eq('company_id', quote.company_id)
      .eq('currency', 'BRL')
      .eq('active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .then((r: any) => setBank(r.data?.[0] || null));
  }, [open, quote?.company_id, precisaCobrarCliente]);

  if (!open) return null;

  const totalOrcado = Number(accountability.total_orcado_brl || 0);
  const totalPago = Number(accountability.total_pago_brl || 0);
  const diferenca = Number(accountability.diferenca_brl ?? (totalPago - totalOrcado));

  /** Baixa um comprovante do Storage e devolve os bytes + content-type. */
  async function fetchComprovante(path: string): Promise<{ bytes: Uint8Array; type: string } | null> {
    const { data, error } = await supabase.storage.from('shipment-documents').download(path);
    if (error || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), type: data.type || '' };
  }

  /** Rasteriza qualquer imagem (jpg/png/webp/etc.) pra PNG, pra poder embutir no PDF final. */
  async function imageToPng(bytes: Uint8Array, type: string): Promise<Uint8Array> {
    const blob = new Blob([bytes as BlobPart], { type: type || 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Falha ao converter imagem'))), 'image/png')
    );
    return new Uint8Array(await pngBlob.arrayBuffer());
  }

  /** Anexa ao PDF final os comprovantes dos itens, na sequência: PDF -> páginas copiadas direto; imagem -> convertida numa página. Sem folha de rosto — o comprovante entra puro. */
  async function appendComprovantes(merged: PDFDocument) {
    const withComprovante = items.filter(i => !!i.comprovante_url);
    for (const item of withComprovante) {
      try {
        const fetched = await fetchComprovante(item.comprovante_url!);
        if (!fetched) continue;

        const isPdf = fetched.type === 'application/pdf' || item.comprovante_name?.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          const srcDoc = await PDFDocument.load(fetched.bytes, { ignoreEncryption: true });
          const copied = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
          copied.forEach(p => merged.addPage(p));
        } else {
          const pngBytes = await imageToPng(fetched.bytes, fetched.type);
          const img = await merged.embedPng(pngBytes);
          const scale = Math.min(1, 555 / img.width, 800 / img.height);
          const page = merged.addPage([img.width * scale, img.height * scale]);
          page.drawImage(img, { x: 0, y: 0, width: img.width * scale, height: img.height * scale });
        }
      } catch (e) {
        console.error(`Falha ao anexar comprovante de "${item.descricao}"`, e);
        toast.error(`Não foi possível anexar o comprovante de "${item.descricao}" ao PDF.`);
      }
    }
  }

  async function handleDownload() {
    if (!ref.current) return;
    setDownloading(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const filename = `prestacao_contas_${quote?.quote_number || accountability.id.slice(0, 8)}.pdf`;
      const mainBlob: Blob = await html2pdf().set({
        margin: 0,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      } as any).from(ref.current).outputPdf('blob');

      const merged = await PDFDocument.load(await mainBlob.arrayBuffer());
      await appendComprovantes(merged);
      const finalBytes = await merged.save();
      const blob = new Blob([finalBytes as BlobPart], { type: 'application/pdf' });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);

      try {
        const path = `${quote.company_id}/${quote.id}/${Date.now()}_${filename}`;
        const up = await supabase.storage.from('shipment-documents').upload(path, blob, { contentType: 'application/pdf' });
        if (!up.error) {
          await supabase.from('documents').insert({
            quote_id: quote.id, shipment_id: quote.shipment_id || null,
            company_id: quote.company_id, name: filename, file_url: path,
            file_size: blob.size, document_type: 'other' as any,
            // Marca pra o portal de tracking (TrackingV2) poder liberar esse
            // PDF por cliente (ver TRACKING_DOC_CATEGORY_MAP em trackingFieldRegistry.ts).
            // visible_tracking começa false (como qualquer documento enviado/gerado):
            // ninguém fica visível pro cliente automaticamente — a equipe decide e
            // libera manualmente pelo toggle na aba Documentos.
            custom_category: 'tracking:accountability_pdf',
            visible_tracking: false,
          } as any);
        }
      } catch (e) { console.error(e); }

      toast.success('PDF gerado.');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDownloading(false);
    }
  }

  const BRAND = (company as any)?.brand_primary_color || '#1a1a2e';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Prestação de Contas</DialogTitle>
          <Button onClick={handleDownload} disabled={downloading} size="sm">
            <Download className="w-4 h-4 mr-2" /> {downloading ? 'Gerando…' : 'Baixar PDF'}
          </Button>
        </DialogHeader>

        <div ref={ref} style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#000', background: '#e5e5e5' }}>
          <section style={sheet}>
            {/* Header Empresa */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ddd', paddingBottom: 10, marginBottom: 15 }}>
              {company?.logo_url ? (
                <img src={company.logo_url} alt={company?.name || 'Logo'} crossOrigin="anonymous" style={{ maxHeight: 36, maxWidth: 180, objectFit: 'contain' }} />
              ) : (
                <div style={{ fontWeight: 700, fontSize: 14, color: '#000' }}>{company?.name || ''}</div>
              )}
              <div style={{ textAlign: 'right', fontSize: 9, color: '#000', lineHeight: 1.4 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: '#000' }}>{(company?.name || '').toUpperCase()}</div>
                {company?.address && <div>{company.address}</div>}
                {company?.cnpj && <div>CNPJ: {company.cnpj}</div>}
                {company?.email && <div>{company.email}</div>}
                {company?.phone && <div>{company.phone}</div>}
              </div>
            </div>

            {/* Header Prestação */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, padding: '10px 15px', borderRadius: 4, marginBottom: 15 }}>
              <div style={{ fontSize: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>PRESTAÇÃO DE CONTAS — NUMERÁRIO</div>
                <div>{quote?.quote_number || '---'}</div>
                <div style={{ opacity: 1 }}>DATA: {new Date().toLocaleDateString('pt-BR')}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 10 }}>
                <div style={{ fontWeight: 700 }}>CLIENTE: {client?.name || '---'}</div>
                <div>CNPJ: {client?.tax_id || '---'}</div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 15 }}>
              <thead>
                <tr>
                  <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}` }}>DESCRIÇÃO</th>
                  {showBudget && <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, textAlign: 'right' }}>ORÇADO (R$)</th>}
                  <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, textAlign: 'right' }}>PAGO REAL (R$)</th>
                  {showBudget && <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, textAlign: 'right' }}>DIFERENÇA (R$)</th>}
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const pago = item.valor_pago_brl ?? item.valor_orcado_brl;
                  const diff = Number(pago) - Number(item.valor_orcado_brl);
                  return (
                    <tr key={item.id}>
                      <td style={td}>[{categoriaLabels[item.categoria] || item.categoria}] {item.descricao}</td>
                      {showBudget && <td style={tdR}>{fmtBRL(item.valor_orcado_brl)}</td>}
                      <td style={tdR}>{fmtBRL(pago)}</td>
                      {showBudget && (
                        <td style={{ ...tdR, color: diff > 0 ? '#b91c1c' : diff < 0 ? '#047857' : undefined }}>
                          {diff > 0 ? '+' : ''}{fmtBRL(diff)}
                        </td>
                      )}
                    </tr>
                  );
                })}
                <tr style={{ background: '#f5f5f5', fontWeight: 700 }}>
                  <td style={td}>TOTAL</td>
                  {showBudget && <td style={tdR}>{fmtBRL(totalOrcado)}</td>}
                  <td style={tdR}>{fmtBRL(totalPago)}</td>
                  {showBudget && (
                    <td style={{ ...tdR, color: diferenca > 0 ? '#b91c1c' : diferenca < 0 ? '#047857' : undefined }}>
                      {diferenca > 0 ? '+' : ''}{fmtBRL(diferenca)}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>

            {/* Depósitos do cliente (caixa do processo) */}
            {temDepositos && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 15 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}` }}>DEPÓSITOS DO CLIENTE</th>
                    <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}` }}>OBSERVAÇÃO</th>
                    <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, textAlign: 'right' }}>VALOR (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map(d => (
                    <tr key={d.id}>
                      <td style={td}>{new Date(d.deposit_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                      <td style={td}>{d.note || ''}</td>
                      <td style={tdR}>{fmtBRL(d.amount_brl)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#f5f5f5', fontWeight: 700 }}>
                    <td style={td} colSpan={2}>TOTAL DEPOSITADO</td>
                    <td style={tdR}>{fmtBRL(totalDepositado)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {(showBudget || temDepositos) && (() => {
              // Orçado visível: resultado = pago − orçado (como sempre foi).
              // Orçado oculto: resultado = depositado − pago (positivo = devolver).
              const aCobrar = showBudget ? diferenca > 0 : saldoDepositos < 0;
              const aDevolver = showBudget ? diferenca < 0 : saldoDepositos > 0;
              const valor = showBudget ? Math.abs(diferenca) : Math.abs(saldoDepositos);
              return (
                <div style={{ border: `2px solid ${BRAND}`, marginBottom: 10 }}>
                  <div style={{ background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, padding: '4px 12px', fontSize: 10, fontWeight: 700 }}>
                    RESULTADO DA PRESTAÇÃO DE CONTAS
                  </div>
                  <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#000' }}>
                      {aCobrar ? 'ADICIONAL A COBRAR DO CLIENTE' : aDevolver ? 'SALDO A DEVOLVER AO CLIENTE' : 'SEM DIFERENÇA — VALORES CONFEREM'}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#000' }}>R$ {fmtBRL(valor)}</div>
                  </div>
                </div>
              );
            })()}

            {/* Só quando sobra valor a cobrar do cliente — mesmo box do Numerário,
                pra ele já ter como pagar sem precisar pedir os dados de novo. */}
            {precisaCobrarCliente && bank && (
              <div style={{ border: `2px solid ${BRAND}`, padding: '8px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#000', marginBottom: 6 }}>DADOS BANCÁRIOS PARA PAGAMENTO</div>
                <table style={{ width: '100%', fontSize: 10 }}>
                  <tbody>
                    <tr><td style={{ width: 130, padding: '2px 0' }}><strong>Banco</strong></td><td>{bank.bank_name}</td></tr>
                    {bank.branch && <tr><td style={{ padding: '2px 0' }}><strong>Agência</strong></td><td>{bank.branch}</td></tr>}
                    {bank.account_number && <tr><td style={{ padding: '2px 0' }}><strong>Conta</strong></td><td>{bank.account_number}</td></tr>}
                    <tr><td style={{ padding: '2px 0' }}><strong>Titular</strong></td><td>{bank.account_holder}</td></tr>
                    {bank.tax_id && <tr><td style={{ padding: '2px 0' }}><strong>CNPJ/CPF</strong></td><td>{bank.tax_id}</td></tr>}
                    {bank.pix_key && <tr><td style={{ padding: '2px 0' }}><strong>PIX</strong></td><td>{bank.pix_key}</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {precisaCobrarCliente && !bank && (
              <div style={{ fontSize: 9, color: '#000', fontStyle: 'italic', marginBottom: 10 }}>
                Nenhuma conta bancária em BRL cadastrada em Configurações &gt; Dados Bancários.
              </div>
            )}

            <div style={{ fontSize: 8, color: '#000', fontStyle: 'italic' }}>
              {showBudget ? `Valores orçados conforme Numerário aprovado em ${new Date(accountability.created_at).toLocaleDateString('pt-BR')}. ` : ''}Câmbio de referência: R$ {(accountability.usd_brl || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}.
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import React, { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { EstimateRow, EstimateItemRow, EstimateExpenseRow, computeAfrmmAutoBrl } from '@/hooks/useCostEstimate';
import { EstimateBreakdown, calcEstimativa, pct, expenseFiscalUsd } from '@/lib/costEstimate';

interface Props {
  open: boolean;
  onClose: () => void;
  quote: any;
  estimate: EstimateRow;
  items: EstimateItemRow[];
  expenses: EstimateExpenseRow[];
  breakdown: EstimateBreakdown | null;
  hasInsurance?: boolean;
  /** 'estimativa' (padrão) gera o PDF completo (resumo + 1 folha por item).
   *  'numerario' gera só a folha de resumo, renomeada pra "Numerário" e com
   *  os dados bancários da empresa anexados no rodapé. */
  mode?: 'estimativa' | 'numerario';
  /** Chamado depois que o usuário baixa o PDF no modo 'numerario' (= aprovação).
   *  Deve criar a Prestação de Contas e travar a Estimativa. Se lançar erro,
   *  o download do PDF já ocorreu mas um toast de erro é exibido. */
  onApproveNumerario?: () => Promise<void> | void;
}

const fmtUSD = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const th: React.CSSProperties = { background: '#f0f0f0', fontSize: 10, fontWeight: 700, padding: '5px 8px', borderBottom: '1px solid #ccc', textAlign: 'left' };
const td: React.CSSProperties = { fontSize: 10, padding: '4px 8px', borderBottom: '1px solid #eee' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'monospace' };

const sheet: React.CSSProperties = {
  width: '210mm',
  // Levemente menor que 297mm (altura exata do A4): arredondamentos do html2canvas/jsPDF
  // ao renderizar em scale 2 podem fazer a seção "estourar" a página por frações de mm,
  // gerando uma folha em branco extra entre as seções. A margem de segurança evita isso
  // sem cortar conteúdo (não há maxHeight/overflow — se o conteúdo for maior, ele
  // simplesmente ocupa mais de uma página normalmente).
  minHeight: '294mm',
  padding: '12mm 14mm',
  boxSizing: 'border-box',
  pageBreakAfter: 'always',
  breakAfter: 'page',
  background: '#fff',
  position: 'relative',
};
const sheetLast: React.CSSProperties = { ...sheet, pageBreakAfter: 'auto', breakAfter: 'auto' };
// Numerário tem bem mais conteúdo empilhado numa folha só (cabeçalho da empresa +
// banner + grid de dados do embarque + tabela de custos + box de valores +
// dados bancários) do que a Estimativa (que reparte por item), e por pouco
// estourava pra uma 2ª página. Margens levemente menores recuperam o espaço
// sem cortar nada.
const sheetNumerario: React.CSSProperties = { ...sheetLast, padding: '6mm 14mm' };
const avoidBreak: React.CSSProperties = { pageBreakInside: 'avoid', breakInside: 'avoid' };

export function EstimatePdfDialog({ open, onClose, quote, estimate, items, expenses, breakdown, hasInsurance = true, mode = 'estimativa', onApproveNumerario }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [company, setCompany] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const isNumerario = mode === 'numerario';
  const bank = bankAccounts.find(b => b.id === selectedBankId) || null;

  useEffect(() => {
    if (!open || !quote?.company_id) return;
    supabase.from('companies').select('*').eq('id', quote.company_id).single().then(r => setCompany(r.data));
    if (quote?.client_id) {
      supabase.from('clients').select('*').eq('id', quote.client_id).single().then(r => setClient(r.data));
    } else {
      setClient(null);
    }
  }, [open, quote?.company_id, quote?.client_id]);

  // Dados bancários só fazem sentido no Numerário. Busca todas as contas
  // ativas em BRL (moeda em que os custos de nacionalização são pagos) —
  // se houver mais de uma, o usuário escolhe qual entra no PDF (dropdown no
  // cabeçalho do modal); com uma só ou nenhuma marcada como padrão, pré-seleciona
  // a padrão, ou a primeira conta BRL ativa.
  useEffect(() => {
    if (!open || !isNumerario || !quote?.company_id) { setBankAccounts([]); setSelectedBankId(''); return; }
    supabase
      .from('company_bank_accounts' as any)
      .select('*')
      .eq('company_id', quote.company_id)
      .eq('currency', 'BRL')
      .eq('active', true)
      .order('is_default', { ascending: false })
      .then((r: any) => {
        const list = r.data || [];
        setBankAccounts(list);
        setSelectedBankId(list[0]?.id || '');
      });
  }, [open, isNumerario, quote?.company_id]);

  if (!open || !breakdown) return null;

  const rate = estimate.usd_brl || 0;
  const totalUsd = breakdown.total_usd;
  const totalPeso = items.reduce((s, i) => s + Number(i.peso) * Number(i.quantidade), 0);
  const totalQtd = items.reduce((s, i) => s + Number(i.quantidade), 0);

  async function handleDownload() {
    if (!ref.current) return;
    setDownloading(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const filenamePrefix = isNumerario ? 'numerario' : 'estimativa';
      const filename = `${filenamePrefix}_${quote?.quote_number || estimate.id.slice(0, 8)}.pdf`;
      const blob: Blob = await html2pdf().set({
        margin: 0,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: '.pdf-avoid-break' },
      } as any).from(ref.current).outputPdf('blob');

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
            custom_category: isNumerario ? 'tracking:numerario_pdf' : 'tracking:estimate_pdf',
            visible_tracking: false,
          } as any);
        }
      } catch (e) { console.error(e); }

      toast.success('PDF gerado.');

      if (isNumerario && onApproveNumerario) {
        try {
          await onApproveNumerario();
        } catch (e: any) {
          toast.error(e.message || 'Erro ao criar a Prestação de Contas.');
        }
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDownloading(false);
    }
  }

  // Nacionais — calculados uma vez, reaproveitados na tabela de custos e no
  // box "Valores para Depósito" abaixo.
  const taxaSiscomexBrl = Number((estimate as any).taxa_siscomex_brl || 0);
  // Em modo automático usa o frete marítimo TOTAL (Prepaid + Collect) na
  // base do AFRMM, não o valor cru salvo — mesmo cálculo de
  // CostEstimateTab.tsx/useCostEstimate.ts (computeAfrmmAutoBrl). Frete
  // Prepaid entra aqui mesmo sem entrar no Numerário.
  const afrmmBrl = (estimate as any).afrmm_auto
    ? computeAfrmmAutoBrl(estimate, expenses, quote?.transport_mode)
    : Number((estimate as any).afrmm_brl || 0);
  const armazenagemBrl = Number((quote as any)?.storage_fee_amount || 0);
  const taxaSiscomexUsd = taxaSiscomexBrl / rate;
  const afrmmUsd = afrmmBrl / rate;
  const armazenagemUsd = armazenagemBrl / rate;

  // 6ª posição = is_prepaid, 7ª = isMerchandise (linha do VMCV — valor da
  // mercadoria, pago direto pelo cliente ao fornecedor, fora do Numerário).
  const rows: Array<[string, number, boolean, boolean, boolean, boolean, boolean, number?]> = (() => {
    const list: Array<[string, number, boolean, boolean, boolean, boolean, boolean, number?]> = [];
    // VMCV: no Numerário já aparece no cabeçalho (VALOR FOB: R$), não precisa
    // repetir na descrição dos custos. Na Estimativa continua aparecendo.
    if (!isNumerario) {
      list.push(['Valor da mercadoria (VMCV)', breakdown.vmcv_usd, true, false, true, false, true]);
    }

    // Origem e frete/seguro: US$ da própria taxa (base fiscal do VMLE/VMLD) e R$ gravado (câmbio da agência), sem dividir um pelo outro.
    // Origem
    expenses.filter(e => e.category === 'origin').forEach(e => {
      list.push([e.descricao, expenseFiscalUsd(e, { usd_brl: rate, eur_brl: Number((estimate as any).eur_brl || 0) }), false, false, true, !!(e as any).is_prepaid, false, Number(e.valor_brl || 0)]);
    });

    list.push(['Valor no embarque (VMLE)', breakdown.vmle_usd, true, false, true, false, false]);

    // Frete/Seguro: no Numerário, frete Prepaid já aparece no cabeçalho
    // (FRETE INTL.: USD), não precisa repetir na descrição dos custos.
    expenses.filter(e => e.category === 'freight').forEach(e => {
      if (isNumerario && (e as any).is_prepaid) return;
      list.push([e.descricao, expenseFiscalUsd(e, { usd_brl: rate, eur_brl: Number((estimate as any).eur_brl || 0) }), false, false, true, !!(e as any).is_prepaid, false, Number(e.valor_brl || 0)]);
    });

    list.push(
      ['Valor desembaraçado (VMLD)', breakdown.vmld_usd, true, false, true, false, false],
      ['I.I.', breakdown.ii_usd, false, false, true, false, false],
      ['I.P.I.', breakdown.ipi_usd, false, false, true, false, false],
      ['P.I.S.', breakdown.pis_usd, false, false, true, false, false],
      ['COFINS', breakdown.cofins_usd, false, false, true, false, false],
      ['I.C.M.S.', breakdown.icms_usd, false, false, true, false, false]
    );
    // Taxa Siscomex fica junto com os impostos (logo após I.C.M.S., antes do
    // SUBTOTAL) — mesmo não entrando na fórmula do subtotal (que é só
    // II+IPI+PIS+COFINS+ICMS), ela é exibida ao lado deles pra ficar clara a
    // carga tributária total num bloco só.
    if (taxaSiscomexBrl > 0) list.push(['Taxa Siscomex', taxaSiscomexUsd, false, false, true, false, false]);
    list.push(['SUBTOTAL', breakdown.subtotal_usd, true, false, true, false, false]);

    if (afrmmBrl > 0) list.push(['AFRMM', afrmmUsd, false, false, true, false, false]);
    if (armazenagemBrl > 0) list.push(['Armazenagem no destino', armazenagemUsd, false, false, true, false, false]);

    expenses.filter(e => e.category === 'destination' || e.category === 'local' || !e.category).forEach(e => {
      list.push([e.descricao, (e.valor_brl || 0) / rate, false, false, true, !!(e as any).is_prepaid, false]);
    });

    list.push(['TOTAL', breakdown.total_usd, true, false, true, false, false]);
    return list;
  })();

  // ===== Valores para Depósito (Numerário) =====
  // O que o cliente precisa mandar: Impostos (com Taxa Siscomex junto), AFRMM,
  // Desembaraço/despesas de destino e outras despesas de origem/frete/seguro —
  // desde que não sejam Prepaid (já pagas na origem). NÃO inclui o valor da
  // mercadoria (VMCV): o cliente paga isso direto ao fornecedor, fora do Numerário.
  const sumExpenses = (pred: (cat: string) => boolean) =>
    expenses.filter(e => pred(e.category || 'local') && !(e as any).is_prepaid)
      .reduce((s, e) => s + (e.valor_brl || 0) / rate, 0);
  const impostosUsd = breakdown.ii_usd + breakdown.ipi_usd + breakdown.pis_usd + breakdown.cofins_usd + breakdown.icms_usd + taxaSiscomexUsd;
  const desembaracoDestinoUsd = sumExpenses(cat => cat === 'destination' || cat === 'local') + armazenagemUsd;
  const origemFreteSeguroUsd = sumExpenses(cat => cat === 'origin' || cat === 'freight');
  const numerarioTotalUsd = impostosUsd + afrmmUsd + desembaracoDestinoUsd + origemFreteSeguroUsd;
  const numerarioCategorias: Array<[string, number]> = [
    ['Impostos (I.I. + I.P.I. + P.I.S. + COFINS + I.C.M.S. + Taxa Siscomex)', impostosUsd],
    ...(afrmmUsd > 0 ? [['AFRMM', afrmmUsd] as [string, number]] : []),
    ...(desembaracoDestinoUsd > 0 ? [['Desembaraço / Armazenagem / Despesas de Destino', desembaracoDestinoUsd] as [string, number]] : []),
    ...(origemFreteSeguroUsd > 0 ? [['Frete / Seguro / Despesas de Origem (Collect)', origemFreteSeguroUsd] as [string, number]] : []),
  ];

  const BRAND = (company as any)?.brand_primary_color || '#1a1a2e';
  // Numerário precisa caber em 1 página: linhas da tabela de custos mais compactas.
  const tdc: React.CSSProperties = isNumerario ? { ...td, padding: '2px 8px' } : td;
  const tdRc: React.CSSProperties = isNumerario ? { ...tdR, padding: '2px 8px' } : tdR;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between gap-3">
          <DialogTitle>{isNumerario ? 'Numerário' : 'Estimativa de Custo'}</DialogTitle>
          <div className="flex items-center gap-2">
            {isNumerario && bankAccounts.length > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Conta p/ impressão:</span>
                <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                  <SelectTrigger className="h-8 w-[220px] text-xs">
                    <SelectValue placeholder="Conta bancária" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.bank_name}{b.account_number ? ` — ${b.account_number}` : ''}{b.is_default ? ' (padrão)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={handleDownload} disabled={downloading} size="sm">
              <Download className="w-4 h-4 mr-2" /> {downloading ? 'Gerando…' : (isNumerario && onApproveNumerario ? 'Aprovar e Gerar PDF' : 'Baixar PDF')}
            </Button>
          </div>
        </DialogHeader>

        <div ref={ref} style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#000', background: '#fff' }}>
        {/* ============= FOLHA 1: Resumo ============= */}
        <section className={isNumerario ? undefined : "pdf-avoid-break"} style={isNumerario ? sheetNumerario : (items.length === 0 ? sheetLast : sheet)}>
          {/* Header Empresa */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ddd', paddingBottom: isNumerario ? 6 : 10, marginBottom: isNumerario ? 10 : 15 }}>
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

          {/* Header Estimativa */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, padding: isNumerario ? '8px 15px' : '10px 15px', borderRadius: 4, marginBottom: isNumerario ? 10 : 15 }}>
            <div style={{ fontSize: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                {isNumerario ? 'NUMERÁRIO' : 'ESTIMATIVA DE CUSTOS DE IMPORTAÇÃO'}
              </div>
              <div>{quote?.quote_number || '---'}</div>
              <div style={{ opacity: 1 }}>DATA: {new Date().toLocaleDateString('pt-BR')}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 10 }}>
              <div style={{ fontWeight: 700 }}>CLIENTE: {client?.name || '---'}</div>
              <div>CNPJ: {client?.tax_id || '---'}</div>
            </div>
          </div>

          {/* Resumo Consolidado (Primeira Folha) */}
          <div style={{ fontWeight: 700, fontSize: 11, margin: '15px 0 8px', textTransform: 'uppercase', color: '#000', borderLeft: `4px solid ${BRAND}`, paddingLeft: 8 }}>
            {isNumerario ? 'Dados do Embarque' : 'Resumo da Estimativa'}
          </div>

          {isNumerario ? (() => {
            const modalLabels: Record<string, string> = {
              ocean_fcl: 'FCL - MARÍTIMO',
              ocean_lcl: 'LCL - MARÍTIMO',
              air: 'AÉREO',
              road: 'RODOVIÁRIO',
              multimodal: 'MULTIMODAL',
            };
            const modal = modalLabels[quote?.transport_mode || ''] || quote?.transport_mode || '-';
            const mercadorias = items.map(i => i.nome).filter(Boolean).join(', ') || '-';
            const ncms = Array.from(new Set(items.map(i => i.ncm).filter(Boolean))).join(' - ') || '-';
            const vmcvBrl = breakdown.vmcv_usd * rate;
            const vmldBrl = breakdown.vmld_usd * rate;
            const pesoLiquido = Number((estimate as any).peso_liquido_kg || 0);
            const cbmTotal = Number((estimate as any).cbm_total || 0);
            const rateAgencia = Number((estimate as any).usd_brl_agencia || 0);
            const pairs: Array<[string, string, string, string]> = [
              ['REF. DO CLIENTE', quote?.client_reference || '-', 'MODAL', modal],
              ['MERCADORIA', mercadorias, 'PAÍS DE ORIGEM', (estimate as any).pais_origem || '-'],
              ['PESO BRUTO (KG)', fmtBRL(totalPeso), 'PESO LÍQUIDO (KG)', pesoLiquido ? fmtBRL(pesoLiquido) : '-'],
              ['PORTO ORIGEM', estimate.rota_origem || '-', 'PORTO DESTINO', estimate.rota_destino || '-'],
              ['NCM', ncms, 'ARMAZÉM', (estimate as any).armazem || '-'],
              ['QUANTIDADE', String(totalQtd), 'CBM', cbmTotal ? fmtBRL(cbmTotal) : '-'],
              ['TRANSPORTADOR', estimate.carrier || '-', 'FRETE INTL.: USD', `USD ${fmtUSD(estimate.frete_intl_usd || 0)}`],
              ['VALOR FOB: USD', `USD ${fmtUSD(breakdown.vmcv_usd)}`, 'SEGURO INTL.: USD', `USD ${fmtUSD(estimate.seguro_intl_usd || 0)}`],
              ['VALOR FOB: R$', `R$ ${fmtBRL(vmcvBrl)}`, 'VALOR ADUANEIRO R$', `R$ ${fmtBRL(vmldBrl)}`],
              ['TAXA DE CÂMBIO FISCAL', `R$ ${fmtBRL(rate)}`, 'TAXA CÂMBIO AGÊNCIA', rateAgencia ? `R$ ${fmtBRL(rateAgencia)}` : '-'],
            ];
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginBottom: 10, border: '1px solid #ccc', width: '100%' }}>
                {pairs.map(([l1, v1, l2, v2], idx) => (
                  <React.Fragment key={idx}>
                    <div style={{ display: 'flex', minWidth: 0, borderBottom: idx === pairs.length - 1 ? 'none' : '1px solid #ccc', borderRight: '1px solid #ccc' }}>
                      <div style={{ fontSize: 7.5, fontWeight: 700, color: '#000', background: '#fff', borderLeft: `3px solid ${BRAND}`, padding: isNumerario ? '2px 6px' : '3px 6px', width: '38%', flexShrink: 0, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l1}</div>
                      <div style={{ fontSize: 8.5, padding: isNumerario ? '2px 6px' : '3px 6px', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.25 }}>{v1}</div>
                    </div>
                    <div style={{ display: 'flex', minWidth: 0, borderBottom: idx === pairs.length - 1 ? 'none' : '1px solid #ccc' }}>
                      <div style={{ fontSize: 7.5, fontWeight: 700, color: '#000', background: '#fff', borderLeft: `3px solid ${BRAND}`, padding: isNumerario ? '2px 6px' : '3px 6px', width: '38%', flexShrink: 0, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l2}</div>
                      <div style={{ fontSize: 8.5, padding: isNumerario ? '2px 6px' : '3px 6px', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.25 }}>{v2}</div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            );
          })() : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 15 }}>
              <div style={{ fontSize: 9 }}>
                <div style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}><strong>INCOTERM:</strong> {estimate.incoterm || '-'}</div>
                <div style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}><strong>FREQUÊNCIA:</strong> {estimate.frequencia || '-'}</div>
                <div style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}><strong>TRÂNSITO:</strong> {estimate.transito || '-'}</div>
                <div style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}><strong>CARRIER:</strong> {estimate.carrier || '-'}</div>
              </div>
              <div style={{ fontSize: 9 }}>
                <div style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}><strong>ORIGEM:</strong> {estimate.rota_origem || '-'}</div>
                <div style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}><strong>DESTINO:</strong> {estimate.rota_destino || '-'}</div>
                <div style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}><strong>PESO TOTAL:</strong> {fmtUSD(totalPeso)} kg</div>
                <div style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}><strong>TAXA CAMBIAL:</strong> R$ {fmtBRL(rate)}</div>
              </div>
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: isNumerario ? 10 : 20 }}>
            <thead>
              <tr>
                <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}` }}>DESCRIÇÃO DOS CUSTOS</th>
                <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, textAlign: 'right' }}>VALOR US$</th>
                <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, textAlign: 'right' }}>VALOR R$</th>
                <th style={{ ...th, background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, textAlign: 'right' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, val, bold, notContracted, showPct, isPrepaid, isMerchandise, brlGravado], idx) => {
                const muted = isPrepaid || (isNumerario && isMerchandise);
                return (
                <tr key={`${label}-${idx}`} style={bold ? { background: '#f5f5f5', fontWeight: 700 } : {}}>
                  <td style={{ ...tdc, ...(muted ? { color: '#000', fontStyle: 'italic' } : {}) }}>
                    {label}
                    {isPrepaid && <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, color: '#000', fontStyle: 'normal' }}>(PREPAID)</span>}
                    {isNumerario && isMerchandise && <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, color: '#000', fontStyle: 'normal' }}>(PAGO DIRETO AO FORNECEDOR)</span>}
                  </td>
                  {notContracted ? (
                    <>
                      <td colSpan={2} style={{ ...tdRc, fontStyle: 'italic', color: '#000' }}>Seguro não contratado</td>
                      <td style={tdR}>—</td>
                    </>
                  ) : (
                    <>
                      <td style={{ ...tdRc, ...(muted ? { color: '#000', fontStyle: 'italic' } : {}) }}>{fmtUSD(val)}</td>
                      <td style={{ ...tdRc, ...(muted ? { color: '#000', fontStyle: 'italic' } : {}) }}>{fmtBRL(brlGravado ?? val * rate)}</td>
                      <td style={tdR}>{showPct && Math.abs(val) > 0 ? pct(val, totalUsd).toFixed(2) : '—'}</td>
                    </>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>

          {/* Numerário: destaque do que o cliente precisa depositar — Impostos
              (com Taxa Siscomex junto), AFRMM, Desembaraço/despesas de destino
              e outras despesas não-Prepaid. NÃO inclui o valor da mercadoria
              (pago direto ao fornecedor) nem taxas Prepaid (já pagas na origem). */}
          {isNumerario && (
            <div className="pdf-avoid-break" style={{ border: `2px solid ${BRAND}`, marginBottom: 10 }}>
              <div style={{ background: '#fff', color: '#000', borderTop: `2px solid ${BRAND}`, borderBottom: `2px solid ${BRAND}`, padding: '4px 12px', fontSize: 10, fontWeight: 700 }}>
                VALORES PARA DEPÓSITO (NUMERÁRIO)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {numerarioCategorias.map(([label, val]) => (
                    <tr key={label}>
                      <td style={{ ...td, fontSize: 9.5, padding: '3px 8px' }}>{label}</td>
                      <td style={{ ...tdR, fontSize: 9.5, padding: '3px 8px' }}>R$ {fmtBRL(val * rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${BRAND}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#000' }}>TOTAL DO NUMERÁRIO A DEPOSITAR *</div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#000' }}>R$ {fmtBRL(numerarioTotalUsd * rate)}</div>
                </div>
              </div>
              <div style={{ padding: '0 12px 6px', fontSize: 8, color: '#000', fontStyle: 'italic' }}>
                * Podem ocorrer divergências, que serão apresentadas no momento da prestação de contas.
              </div>
            </div>
          )}

          {/* Numerário: dados bancários da empresa pra pagamento, no lugar
              das folhas por item (que só existem na Estimativa completa). */}
          {isNumerario && bank && (
            <div className="pdf-avoid-break" style={{ border: `2px solid ${BRAND}`, padding: '8px 12px', marginTop: 0 }}>
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
          {isNumerario && !bank && (
            <div style={{ fontSize: 9, color: '#000', fontStyle: 'italic', marginTop: 10 }}>
              Nenhuma conta bancária em BRL cadastrada em Configurações &gt; Dados Bancários.
            </div>
          )}
        </section>

        {/* ============= 1 FOLHA POR ITEM (só na Estimativa completa) ============= */}
        {!isNumerario && items.map((item, idx) => {
            const b = breakdown.itemBreakdowns[idx];
            if (!b) return null;
            const itemRows: Array<[string, number, boolean?]> = [
              ['Valor da mercadoria (VMCV)', b.vmcv_usd, true],
              ['Custos de Origem', (estimate.acrescimos_usd || 0) * (b.vmcv_usd / (breakdown.vmcv_usd || 1)), false],
              ['Valor no embarque (VMLE)', b.vmle_usd, true],
              ['Frete Internacional', b.frete_usd, false],
              ['Seguro Internacional', b.seguro_usd, false],
              ['Valor desembaraçado (VMLD)', b.vmld_usd, true],
              ['I.I.', b.ii_usd, false],
              ['I.P.I.', b.ipi_usd, false],
              ['P.I.S.', b.pis_usd, false],
              ['COFINS', b.cofins_usd, false],
              ['I.C.M.S.', b.icms_usd, false],
              ['Despesas Nacionais (*)', b.despesas_usd, false],
              ['Total', b.total_usd, true],
            ];
            const custoUnitUsd = Number(item.quantidade) ? b.total_usd / Number(item.quantidade) : 0;
            const isLast = idx === items.length - 1;
            return (
              <section key={item.id} className="pdf-avoid-break" style={isLast ? sheetLast : sheet}>
                {/* Mini-header por item */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: 6, marginBottom: 10 }}>
                  {company?.logo_url ? (
                    <img src={company.logo_url} alt="" crossOrigin="anonymous" style={{ maxHeight: 22, maxWidth: 120, objectFit: 'contain' }} />
                  ) : (
                    <div style={{ fontWeight: 700, fontSize: 10 }}>{company?.name || ''}</div>
                  )}
                  <div style={{ fontSize: 9, color: '#000' }}>
                    <strong>{quote?.quote_number || ''}</strong> · Item {idx + 1} de {items.length}
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Item {idx + 1} {item.ncm ? `- ${item.ncm}` : ''}</div>
                <div style={{ fontSize: 10, color: '#000', marginBottom: 8 }}>{item.nome}</div>
                <div style={{ fontSize: 9, color: '#000', marginBottom: 6 }}>
                  Destinação: <strong>{
                    ((item as any).destinacao
                      ?? ((item as any).ipi_na_base_icms === false ? 'revenda_industrializacao' : 'consumo_final')
                    ) === 'revenda_industrializacao'
                      ? 'Revenda / Industrialização (IPI fora da base do ICMS)'
                      : 'Consumo final (IPI integra a base do ICMS)'
                  }</strong>
                </div>

                <table className="pdf-avoid-break" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                  <tbody>
                    <tr><td style={td}>Peso</td><td style={tdR}>{fmtUSD(Number(item.peso))}</td>
                        <td style={td}>Quantidade</td><td style={tdR}>{item.quantidade}</td></tr>
                    <tr><td style={td}>Valor unit. mercadoria (US$)</td><td style={tdR}>{fmtUSD(Number(item.vmcv_unit_usd))}</td>
                        <td style={td}>Valor unit. mercadoria (R$)</td><td style={tdR}>{fmtBRL(Number(item.vmcv_unit_usd) * rate)}</td></tr>
                    <tr><td style={td}>Custo Unitário (US$)</td><td style={tdR}>{fmtUSD(custoUnitUsd)}</td>
                        <td style={td}>Custo Unitário (R$)</td><td style={tdR}>{fmtBRL(custoUnitUsd * rate)}</td></tr>
                  </tbody>
                </table>

                <div style={{ fontWeight: 700, fontSize: 10, margin: '6px 0 2px' }}>BASE DE CÁLCULO</div>
                <table className="pdf-avoid-break" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                  <thead><tr><th style={th}></th><th style={{ ...th, textAlign: 'right' }}>Alíquota</th><th style={{ ...th, textAlign: 'right' }}>US$</th><th style={{ ...th, textAlign: 'right' }}>R$</th></tr></thead>
                  <tbody>
                    <tr><td style={td}>I.I.</td><td style={tdR}>{Number(item.aliq_ii).toFixed(2)}</td><td style={tdR}>{fmtUSD(b.vmld_usd)}</td><td style={tdR}>{fmtBRL(b.vmld_usd * rate)}</td></tr>
                    <tr><td style={td}>I.P.I.</td><td style={tdR}>{Number(item.aliq_ipi).toFixed(2)}</td><td style={tdR}>{fmtUSD(b.vmld_usd + b.ii_usd)}</td><td style={tdR}>{fmtBRL((b.vmld_usd + b.ii_usd) * rate)}</td></tr>
                    <tr><td style={td}>P.I.S.</td><td style={tdR}>{Number(item.aliq_pis).toFixed(2)}</td><td style={tdR}>{fmtUSD(b.vmld_usd)}</td><td style={tdR}>{fmtBRL(b.vmld_usd * rate)}</td></tr>
                    <tr><td style={td}>COFINS</td><td style={tdR}>{Number(item.aliq_cofins).toFixed(2)}</td><td style={tdR}>{fmtUSD(b.vmld_usd)}</td><td style={tdR}>{fmtBRL(b.vmld_usd * rate)}</td></tr>
                    <tr><td style={td}>I.C.M.S.</td><td style={tdR}>{Number(item.aliq_icms).toFixed(2)}</td><td style={tdR}>{fmtUSD(b.icms_usd + b.vmld_usd + b.ii_usd + b.ipi_usd + b.pis_usd + b.cofins_usd)}</td><td style={tdR}>{fmtBRL((b.icms_usd + b.vmld_usd + b.ii_usd + b.ipi_usd + b.pis_usd + b.cofins_usd) * rate)}</td></tr>
                  </tbody>
                </table>

                <div style={{ fontWeight: 700, fontSize: 10, margin: '6px 0 2px' }}>CÁLCULO</div>
                <table className="pdf-avoid-break" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}></th><th style={{ ...th, textAlign: 'right' }}>US$</th><th style={{ ...th, textAlign: 'right' }}>R$</th><th style={{ ...th, textAlign: 'right' }}>%</th></tr></thead>
                  <tbody>
                    {itemRows.map(([label, val, bold]) => (
                      <tr key={label} style={bold ? { background: '#f5f5f5', fontWeight: 700 } : {}}>
                        <td style={td}>{label}</td>
                        <td style={tdR}>{fmtUSD(val)}</td>
                        <td style={tdR}>{fmtBRL(val * rate)}</td>
                        <td style={tdR}>{pct(val, totalUsd).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
        })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { calcItemCbm, calcItemWeight, calcChargeableWeight, getEffectiveVolume, effectiveCalcItems, type CargoVolume } from './ModeFields';
import { groupByCurrency } from '@/lib/utils';
import { generatePdfFromElement } from '@/lib/pdf-utils';

const LEG_ORDER = ['origin', 'freight', 'destination'] as const;
const LEG_LABELS: Record<string, Record<string, string>> = {
  origin: { pt: 'Origem', en: 'Origin' },
  freight: { pt: 'Frete', en: 'Freight' },
  destination: { pt: 'Destino', en: 'Destination' },
};

const MODE_LABELS: Record<string, string> = {
  ocean_fcl: 'Marítimo FCL',
  ocean_lcl: 'Marítimo LCL',
  air: 'Aéreo',
  road: 'Rodoviário',
  multimodal: 'Multimodal',
};

const BILLING_UNIT_LABELS: Record<string, string> = {
  fixed: 'Fixo',
  per_ton: 'Por Ton',
  per_cbm: 'Por M³',
  per_wm: 'Ton/M³ (W/M)',
  per_cw: 'Peso Taxado',
  per_container: 'Por Container',
  per_container_20: "Por Container 20'",
  per_container_40: "Por Container 40'",
  per_bl: 'Por BL',
};

interface PrintData {
  quote: any;
  company: any;
  client: any;
  items: any[];
  volumes?: any[];
  charges: any[];
  estimate?: any;
  userEmail?: string | null;
  userPhone?: string | null;
}

interface Props {
  quoteId: string;
  open: boolean;
  onClose: () => void;
}

export function QuotePdfPreviewDialog({ quoteId, open, onClose }: Props) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<PrintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !quoteId) return;
    setLoading(true);
    async function load() {
      try {
        const { data: quote } = await supabase
          .from('quotes')
          .select('*')
          .eq('id', quoteId)
          .single();
        if (!quote) return;

        const [companyRes, clientRes, itemsRes, chargesRes, estimateRes, userRes, volumesRes] = await Promise.all([
          supabase.from('companies').select('*').eq('id', quote.company_id).single(),
          quote.client_id
            ? supabase.from('clients').select('*').eq('id', quote.client_id).single()
            : Promise.resolve({ data: null }),
          supabase.from('quote_items').select('*').eq('quote_id', quoteId).order('created_at'),
          supabase.from('quote_charges').select('*').eq('quote_id', quoteId).order('created_at'),
          supabase.from('cost_estimates').select('usd_brl, eur_brl').eq('quote_id', quoteId).maybeSingle(),
          supabase.auth.getUser(),
          supabase.from('quote_cargo_volumes' as any).select('*').eq('quote_id', quoteId).order('position'),
        ]);

        const userId = userRes.data?.user?.id;
        let userPhone: string | null = null;
        if (userId) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('phone')
            .eq('user_id', userId)
            .maybeSingle();
          userPhone = (prof as any)?.phone ?? null;
        }

        setData({
          quote,
          company: companyRes.data,
          client: clientRes.data,
          items: itemsRes.data || [],
          volumes: ((volumesRes as any)?.data || []) as any[],
          charges: chargesRes.data || [],
          estimate: estimateRes.data,
          userEmail: userRes.data?.user?.email ?? null,
          userPhone,
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [open, quoteId]);

  async function handleDownload() {
    if (!contentRef.current || !data) return;
    setDownloading(true);
    try {
      const filename = `${data.quote.quote_number || 'proposta'}.pdf`;
      // Gera PDF e força download direto (1 clique)
      const pdfBlob = await generatePdfFromElement(contentRef.current, filename);
      toast.success('PDF gerado com sucesso');

      // Salva cópia silenciosa no storage + registra em documents (não bloqueia)
      (async () => {
        try {
          const storagePath = `${data.quote.company_id}/${quoteId}/${Date.now()}_${filename}`;
          const { error: uploadError } = await supabase.storage
            .from('shipment-documents')
            .upload(storagePath, pdfBlob, { contentType: 'application/pdf' });
          if (uploadError) return;
          await supabase.from('documents').insert({
            quote_id: quoteId,
            shipment_id: data.quote.shipment_id || null,
            company_id: data.quote.company_id,
            name: filename,
            file_url: storagePath,
            file_size: pdfBlob.size,
            document_type: 'other' as any,
            // Marca pra o portal de tracking (TrackingV2) poder liberar esse
            // PDF por cliente (ver TRACKING_DOC_CATEGORY_MAP em trackingFieldRegistry.ts).
            // visible_tracking começa false (como qualquer documento enviado/gerado):
            // ninguém fica visível pro cliente automaticamente — a equipe decide e
            // libera manualmente pelo toggle na aba Documentos.
            custom_category: 'tracking:quote_pdf',
            visible_tracking: false,
          } as any);
        } catch (docErr) {
          console.error('Failed to save document copy:', docErr);
        }
      })();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (!open) return null;

  const renderContent = () => {
    if (loading) return <div className="flex items-center justify-center py-20 text-muted-foreground">{t('common.loading')}</div>;
    if (!data || !data.quote) return <div className="flex items-center justify-center py-20 text-muted-foreground">Cotação não encontrada.</div>;

    const { quote, company, client, items, charges, estimate } = data;
    const proposalOptions = {
      transitTime: quote.transit_time ? String(quote.transit_time) : '',
      validUntil: quote.valid_until || '',
      usdBrl: estimate?.usd_brl ? String(estimate.usd_brl) : '',
      eurBrl: estimate?.eur_brl ? String(estimate.eur_brl) : '',
      paymentTerms: quote.payment_terms || '',
      proposalNotes: quote.proposal_notes || '',
    };
    const hasExchangeRates = proposalOptions.usdBrl || proposalOptions.eurBrl;
    const notesBlocks = [
      quote.notes ? { title: 'Observações', text: quote.notes } : null,
      proposalOptions.paymentTerms ? { title: 'Condições de pagamento', text: proposalOptions.paymentTerms } : null,
      proposalOptions.proposalNotes ? { title: 'Observações comerciais', text: proposalOptions.proposalNotes } : null,
    ].filter(Boolean) as Array<{ title: string; text: string }>;

    // Build cargo metrics for billing unit multipliers
    const cargoItems = items.map((item: any) => ({
      container_type: item.container_type || '20GP',
      container_qty: item.container_qty || 1,
      container_number: item.container_number || '',
      weight_kg: String(item.weight_kg || ''),
      volume_cbm: String(item.volume_cbm || ''),
      chargeable_weight: String(item.chargeable_weight || ''),
      length_cm: String(item.length_cm || ''),
      width_cm: String(item.width_cm || ''),
      height_cm: String(item.height_cm || ''),
      packages: String(item.packages || ''),
      ncm_code: item.ncm_code || '',
      commodity: item.commodity || '',
      dangerous_goods: item.dangerous_goods || false,
      vehicle_type: item.vehicle_type || '',
      cargo_value: String(item.cargo_value || ''),
      cargo_value_currency: item.cargo_value_currency || 'USD',
      notes: item.notes || '',
    }));

    // Linhas de volume do embarque (peso/medidas por unidade × quantidade) mandam; sem elas, formato antigo.
    const pdfVolumes: CargoVolume[] = ((data as any).volumes || []).map((v: any) => ({
      qty: String(v.qty ?? ''), package_type: v.package_type || '',
      length_cm: String(v.length_cm ?? ''), width_cm: String(v.width_cm ?? ''), height_cm: String(v.height_cm ?? ''),
      weight_kg: String(v.weight_kg ?? ''), volume_cbm: String(v.volume_cbm ?? ''),
    }));
    const volMode = pdfVolumes.length > 0 && quote.transport_mode !== 'ocean_fcl';
    const calcItems = effectiveCalcItems(quote.transport_mode, cargoItems, pdfVolumes);
    const totalWeight = volMode
      ? calcItems.reduce((s: number, i: any) => s + calcItemWeight(i), 0)
      : cargoItems.reduce((s: number, i: any) => s + (parseFloat(i.weight_kg) || 0), 0);
    const totalCbm = calcItems.reduce((s: number, i: any) => s + getEffectiveVolume(i), 0);
    const totalChargeable = calcChargeableWeight(calcItems, quote.transport_mode);
    const totalContainers = cargoItems.reduce((s: number, i: any) => s + (i.container_qty || 1), 0);
    const totalContainers20 = cargoItems.reduce((s: number, i: any) => s + ((i.container_type || '').startsWith('20') ? (i.container_qty || 1) : 0), 0);
    const totalContainers40 = cargoItems.reduce((s: number, i: any) => s + ((i.container_type || '').startsWith('40') ? (i.container_qty || 1) : 0), 0);

    function getMultiplier(unit: string): number {
      switch (unit) {
        case 'per_cw': return totalChargeable;
        case 'per_ton': return totalWeight / 1000;
        case 'per_cbm': return totalCbm;
        case 'per_wm': return Math.max(totalWeight / 1000, totalCbm);
        case 'per_container': return totalContainers;
        case 'per_container_20': return totalContainers20;
        case 'per_container_40': return totalContainers40;
        case 'per_bl': return 1;
        default: return 1;
      }
    }

    function getChargeTotal(c: any): number {
      return (c.sell_amount || 0) * getMultiplier(c.billing_unit || 'fixed');
    }

    function getBillingDetail(c: any): string | null {
      const unit = c.billing_unit || 'fixed';
      if (unit === 'fixed') return null;
      const mult = getMultiplier(unit);
      const unitPrice = c.sell_amount || 0;
      const ref = unit === 'per_cw' ? `${mult.toFixed(2)} kg`
        : unit === 'per_ton' ? `${mult.toFixed(3)} ton`
        : unit === 'per_cbm' ? `${mult.toFixed(4)} m³`
        : unit === 'per_wm' ? `${mult.toFixed(3)} W/M`
        : unit === 'per_container' ? `${mult} cntr`
        : unit === 'per_container_20' ? `${mult} cntr 20'`
        : unit === 'per_container_40' ? `${mult} cntr 40'`
        : unit === 'per_bl' ? '1 BL'
        : '';
      return `${ref} × ${c.currency || 'USD'} ${unitPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const sellCharges = charges.filter((c: any) => (c.sell_amount || 0) > 0);
    const groupedByLeg = LEG_ORDER.map((leg) => {
      const legCharges = sellCharges.filter((c: any) => c.leg === leg);
      const subtotalByCurrency = groupByCurrency(
        legCharges,
        (c: any) => c.currency || 'USD',
        (c: any) => getChargeTotal(c)
      );
      return {
        leg,
        label: LEG_LABELS[leg]?.[language] || leg,
        charges: legCharges,
        subtotalByCurrency,
      };
    }).filter((g) => g.charges.length > 0);

    const totalByCurrency = groupByCurrency(
      sellCharges,
      (c: any) => c.currency || 'USD',
      (c: any) => getChargeTotal(c)
    );

    // Design tokens — cores da marca vêm da empresa (fallback = Aura default)
    const INK = company?.brand_primary_color || '#0f1729';
    const ACCENT = company?.brand_secondary_color || '#1e40af';
    const MUTED = '#64748b';
    const BORDER = '#e2e8f0';
    const SUBTLE = '#f8fafc';
    const ZEBRA = '#fafbfc';
    const thStyleDyn: React.CSSProperties = {
      background: INK, color: '#fff', padding: '6px 10px', textAlign: 'left', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    };

    const fmt = (n: number, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const commoditiesAll = Array.from(new Set(items.map((i: any) => (i.commodity || '').trim()).filter(Boolean))).join(', ') || '—';
    const totalPkg = ((data as any).volumes || []).length > 0 && quote.transport_mode !== 'ocean_fcl'
      ? ((data as any).volumes as any[]).reduce((s: number, v: any) => s + (Number(v.qty) || 0), 0)
      : items.reduce((s: number, i: any) => s + (Number(i.packages) || 0), 0);
    const containerSummary = (() => {
      const map = new Map<string, number>();
      items.forEach((i: any) => { const t = i.container_type || '—'; map.set(t, (map.get(t) || 0) + (Number(i.container_qty) || 1)); });
      return Array.from(map.entries()).map(([t, q]) => `${q}× ${t}`).join(' + ');
    })();
    const vehicleSummary = Array.from(new Set(items.map((i: any) => i.vehicle_type).filter(Boolean))).join(', ') || '—';
    const cargoValues = Array.from(new Set(items.map((i: any) => {
      const v = Number(i.cargo_value) || 0; if (!v) return '';
      return `${i.cargo_value_currency || 'USD'} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }).filter(Boolean))).join(' + ');

    const metrics: Array<{ label: string; value: string }> = [];
    if (totalPkg > 0) metrics.push({ label: 'Volumes', value: String(totalPkg) });
    metrics.push({ label: 'Peso Bruto', value: `${fmt(totalWeight)} kg` });
    metrics.push({ label: 'Cubagem', value: `${fmt(totalCbm, 3)} m³` });
    if (quote.transport_mode === 'air' || quote.transport_mode === 'ocean_lcl') {
      metrics.push({ label: 'Peso Taxável', value: `${fmt(totalChargeable)} kg` });
    }
    if (quote.transport_mode === 'ocean_fcl') metrics.push({ label: 'Containers', value: containerSummary || '—' });
    if (quote.transport_mode === 'road') metrics.push({ label: 'Veículo', value: vehicleSummary });
    if (cargoValues) metrics.push({ label: 'Valor da Carga', value: cargoValues });

    const sectionTitle = (label: string): React.CSSProperties => ({
      fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px',
      color: INK, margin: '10px 0 6px', paddingLeft: '8px', borderLeft: `3px solid ${ACCENT}`,
      breakAfter: 'avoid', pageBreakAfter: 'avoid',
    });

    const detailRow = (k: string, v: React.ReactNode) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '9px', padding: '2px 0' }}>
        <span style={{ color: MUTED }}>{k}</span>
        <span style={{ fontWeight: 600, textAlign: 'right', color: INK }}>{v}</span>
      </div>
    );

    return (
      <div ref={contentRef} style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", color: INK, fontSize: '10px', lineHeight: 1.35, background: '#fff', padding: '4px 6px', width: '794px', maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {/* Top accent bar */}
        <div style={{ height: '4px', background: ACCENT, marginBottom: '10px', borderRadius: '2px' }} />

        {/* Header — table-based for html2canvas alignment reliability */}
        <table className="pdf-avoid-break" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px', borderBottom: `1px solid ${BORDER}` }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'middle', paddingBottom: '10px' }}>
                <table style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      {company?.logo_url && (
                        <td style={{ verticalAlign: 'middle', paddingRight: '12px' }}>
                          <img src={company.logo_url} alt="Logo" style={{ maxHeight: '40px', maxWidth: '110px', objectFit: 'contain', display: 'block' }} />
                        </td>
                      )}
                      <td style={{ verticalAlign: 'middle' }}>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: INK, lineHeight: 1.2 }}>{company?.name || ''}</div>
                        <div style={{ fontSize: '8.5px', color: MUTED, lineHeight: 1.4, marginTop: '2px' }}>
                          {company?.cnpj && <div>CNPJ: {company.cnpj}</div>}
                          {company?.address && <div>{company.address}</div>}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td style={{ verticalAlign: 'top', textAlign: 'right', paddingBottom: '10px' }}>
                <div style={{ fontSize: '8px', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Proposta</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: ACCENT, lineHeight: 1, marginTop: '2px' }}>{quote.quote_number}</div>
                <div style={{ fontSize: '8.5px', color: MUTED, marginTop: '4px', lineHeight: 1.4 }}>
                  {data?.userEmail && <div>{data.userEmail}</div>}
                  {(data?.userPhone || company?.phone) && <div>{data?.userPhone || company?.phone}</div>}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Title band */}
        <table className="pdf-avoid-break" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px' }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'middle' }}>
                <h1 style={{ fontSize: '16px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', margin: 0, color: INK, lineHeight: 1.1 }}>Proposta Comercial</h1>
                <div style={{ fontSize: '9px', color: MUTED, marginTop: '2px' }}>Emitida em {format(new Date(), 'dd/MM/yyyy')}</div>
              </td>
              <td style={{ verticalAlign: 'middle', textAlign: 'right', width: '1%', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-block', background: ACCENT, color: '#fff', height: '26px', lineHeight: '26px', padding: '0 16px', borderRadius: '3px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  {MODE_LABELS[quote.transport_mode] || quote.transport_mode}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Route strip — table for reliable vertical centering with arrow */}
        <table className="pdf-avoid-break" style={{ width: '100%', borderCollapse: 'collapse', background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: '5px', marginBottom: '10px' }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'middle', padding: '8px 12px', textAlign: 'left', width: '45%' }}>
                <div style={{ fontSize: '8px', color: MUTED, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Origem</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: INK, marginTop: '1px' }}>{quote.origin || '—'}</div>
              </td>
              <td style={{ verticalAlign: 'middle', textAlign: 'center', width: '10%', padding: '0 12px' }}>
                <svg width="22" height="10" viewBox="0 0 22 10" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                  <path d="M0 5 L18 5 M13 1 L18 5 L13 9" stroke={ACCENT} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </td>
              <td style={{ verticalAlign: 'middle', padding: '8px 12px', textAlign: 'right', width: '45%' }}>
                <div style={{ fontSize: '8px', color: MUTED, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Destino</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: INK, marginTop: '1px' }}>{quote.destination || '—'}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Info grid — table-based */}
        <table className="pdf-avoid-break" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '10px 0', marginBottom: '4px', marginLeft: '-10px', marginRight: '-10px' }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'top', width: '50%', border: `1px solid ${BORDER}`, borderLeft: `3px solid ${ACCENT}`, borderRadius: '4px', padding: '8px 10px' }}>
                <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: ACCENT, letterSpacing: '0.6px', marginBottom: '5px' }}>Cliente</div>
                {client ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: '11px', color: INK, lineHeight: 1.25 }}>{client.name}</div>
                    {client.tax_id && <div style={{ fontSize: '9px', color: MUTED, marginTop: '2px' }}>CNPJ: {client.tax_id}</div>}
                    {client.email && <div style={{ fontSize: '9px', color: MUTED }}>{client.email}</div>}
                    {client.contact_person && <div style={{ fontSize: '9px', color: MUTED }}>Contato: {client.contact_person}</div>}
                  </>
                ) : <div style={{ color: MUTED }}>—</div>}
              </td>
              <td style={{ verticalAlign: 'top', width: '50%', border: `1px solid ${BORDER}`, borderLeft: `3px solid ${ACCENT}`, borderRadius: '4px', padding: '8px 10px' }}>
                <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: ACCENT, letterSpacing: '0.6px', marginBottom: '5px' }}>Detalhes</div>
                {detailRow('Modal', MODE_LABELS[quote.transport_mode] || quote.transport_mode)}
                {detailRow('Moeda', quote.currency || 'USD')}
                {proposalOptions.transitTime && detailRow('Transit Time', `${proposalOptions.transitTime} dias`)}
                {(proposalOptions?.validUntil || quote.valid_until) && detailRow('Válida até', format(new Date(proposalOptions?.validUntil || quote.valid_until), 'dd/MM/yyyy'))}
                {proposalOptions.usdBrl && detailRow('PTAX USD/BRL', <span style={{ fontFamily: 'monospace' }}>{Number(proposalOptions.usdBrl).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>)}
                {proposalOptions.eurBrl && detailRow('PTAX EUR/BRL', <span style={{ fontFamily: 'monospace' }}>{Number(proposalOptions.eurBrl).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Cargo */}
        {items.length > 0 && (
          <div className="pdf-avoid-break">
            <div style={sectionTitle('cargo')}>Detalhes da Carga</div>
            {commoditiesAll && commoditiesAll !== '—' && (
              <div style={{ fontSize: '9px', color: MUTED, marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, color: INK }}>Mercadoria:</span> {commoditiesAll}
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '6px 0', marginLeft: '-6px', marginRight: '-6px', marginBottom: '2px' }}>
              <tbody>
                <tr>
                  {metrics.map((m) => (
                    <td key={m.label} style={{ verticalAlign: 'top', width: `${100 / metrics.length}%`, border: `1px solid ${BORDER}`, borderRadius: '4px', padding: '8px 10px', background: SUBTLE }}>
                      <div style={{ fontSize: '7.5px', color: MUTED, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>{m.label}</div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: INK, marginTop: '3px', fontFamily: 'monospace' }}>{m.value}</div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Charges */}
        {sellCharges.length > 0 && (
          <div className="pdf-avoid-break">
            <div style={sectionTitle('taxas')}>Composição de Valores</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px', border: `1px solid ${BORDER}` }}>
              <thead>
                <tr>
                  <th style={thStyleDyn}>Descrição</th>
                  <th style={{ ...thStyleDyn, width: '80px' }}>Moeda</th>
                  <th style={{ ...thStyleDyn, textAlign: 'right', width: '130px' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {groupedByLeg.map((group) => (
                  <React.Fragment key={group.leg}>
                    <tr>
                      <td colSpan={3} style={{ background: SUBTLE, fontWeight: 700, fontSize: '9px', padding: '5px 8px', borderTop: `2px solid ${ACCENT}`, borderBottom: `1px solid ${BORDER}`, textTransform: 'uppercase', letterSpacing: '0.5px', color: ACCENT }}>
                        {group.label}
                      </td>
                    </tr>
                    {group.charges.map((c: any, idx: number) => {
                      const total = getChargeTotal(c);
                      const detail = getBillingDetail(c);
                      return (
                        <tr key={c.id} style={{ background: idx % 2 === 1 ? ZEBRA : '#fff' }}>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600 }}>{c.description}</div>
                            {detail && <div style={{ fontSize: '8px', color: MUTED, fontFamily: 'monospace', marginTop: '1px' }}>{detail}</div>}
                          </td>
                          <td style={{ ...tdStyle, color: MUTED }}>{c.currency || 'USD'}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td colSpan={2} style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, background: '#f1f5f9', color: INK, borderTop: `1px solid ${BORDER}` }}>Subtotal {group.label}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, background: '#f1f5f9', fontFamily: 'monospace', color: INK, borderTop: `1px solid ${BORDER}` }}>
                        {Object.entries(group.subtotalByCurrency).map(([cur, val]) => (
                          <div key={cur}>{cur} {val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        ))}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
                <tr>
                  <td colSpan={2} height={Math.max(34, Object.keys(totalByCurrency).length * 18 + 16)} style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px', padding: '0 14px', background: ACCENT, color: '#fff', letterSpacing: '1px', verticalAlign: 'middle' }}>TOTAL</td>
                  <td height={Math.max(34, Object.keys(totalByCurrency).length * 18 + 16)} style={{ textAlign: 'right', fontWeight: 700, fontSize: '13px', padding: '0 14px', background: ACCENT, color: '#fff', fontFamily: 'monospace', verticalAlign: 'middle' }}>
                    {Object.entries(totalByCurrency).map(([cur, val]) => (
                      <div key={cur} style={{ lineHeight: 1.4 }}>{cur} {val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    ))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Storage fee (informational, LCL) */}
        {Number((quote as any).storage_fee_amount) > 0 && (
          <div className="pdf-avoid-break" style={{ marginTop: '10px' }}>
            <div style={{
              border: `1px dashed ${ACCENT}`,
              borderRadius: '4px',
              padding: '8px 12px',
              background: SUBTLE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              fontSize: '9.5px',
              color: '#334155',
            }}>
              <div>
                <div style={{ fontWeight: 700, color: ACCENT, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Armazenagem no destino (informativo)
                </div>
                <div style={{ marginTop: '2px', fontStyle: 'italic', color: MUTED }}>
                  {(quote as any).storage_fee_note || 'Pago diretamente ao armazém no destino — não incluso no total.'}
                </div>
              </div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '11px', color: INK, whiteSpace: 'nowrap' }}>
                {(quote as any).storage_fee_currency || 'BRL'}{' '}
                {Number((quote as any).storage_fee_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        {notesBlocks.length > 0 && (
          <div className="pdf-avoid-break">
            <div style={sectionTitle('obs')}>Observações</div>
            <div style={{ background: SUBTLE, borderLeft: `3px solid ${ACCENT}`, borderRadius: '3px', padding: '8px 12px', fontSize: '9.5px', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
              {notesBlocks.map((block, index) => (
                <div key={block.title} style={{ marginTop: index === 0 ? 0 : '8px' }}>
                  {notesBlocks.length > 1 && (
                    <div style={{ fontWeight: 700, color: ACCENT, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '2px' }}>{block.title}</div>
                  )}
                  <div>{block.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: '14px', paddingTop: '6px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: MUTED }}>
          <span>Emitido em {format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
          <span style={{ fontWeight: 600, color: INK }}>{company?.name}</span>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('quotes.pdf_preview')}</DialogTitle>
        </DialogHeader>

        <div className="border rounded-lg overflow-hidden bg-white">
          {renderContent()}
        </div>

        {!loading && data && (
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button onClick={handleDownload} disabled={downloading}>
              <Download className="w-4 h-4 mr-1" />
              {downloading ? t('common.loading') : t('quotes.download_pdf')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const thStyle: React.CSSProperties = {
  background: '#0f1729', color: '#fff', padding: '6px 10px', textAlign: 'left', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 10px', borderBottom: '1px solid #e2e8f0', fontSize: '9.5px', verticalAlign: 'middle',
};

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

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

interface PrintData {
  quote: any;
  company: any;
  client: any;
  items: any[];
  charges: any[];
}

export default function QuotePrintView() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const [data, setData] = useState<PrintData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!quoteId) return;
    async function load() {
      try {
        const { data: quote } = await supabase
          .from('quotes')
          .select('*')
          .eq('id', quoteId)
          .single();
        if (!quote) return;

        const [companyRes, clientRes, itemsRes, chargesRes] = await Promise.all([
          supabase.from('companies').select('*').eq('id', quote.company_id).single(),
          quote.client_id
            ? supabase.from('clients').select('*').eq('id', quote.client_id).single()
            : Promise.resolve({ data: null }),
          supabase.from('quote_items').select('*').eq('quote_id', quoteId).order('created_at'),
          supabase.from('quote_charges').select('*').eq('quote_id', quoteId).order('created_at'),
        ]);

        setData({
          quote,
          company: companyRes.data,
          client: clientRes.data,
          items: itemsRes.data || [],
          charges: chargesRes.data || [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [quoteId]);

  useEffect(() => {
    if (data && !loading) {
      setTimeout(() => window.print(), 600);
    }
  }, [data, loading]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'system-ui' }}>
        Carregando...
      </div>
    );
  }

  if (!data || !data.quote) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'system-ui' }}>
        Cotação não encontrada.
      </div>
    );
  }

  const { quote, company, client, items, charges } = data;

  // Only sell charges
  const sellCharges = charges.filter((c: any) => (c.sell_amount || 0) > 0);

  // Group by leg in order
  const groupedByLeg = LEG_ORDER.map((leg) => ({
    leg,
    label: LEG_LABELS[leg]?.pt || leg,
    charges: sellCharges.filter((c: any) => c.leg === leg),
    subtotal: sellCharges.filter((c: any) => c.leg === leg).reduce((s: number, c: any) => s + (c.sell_amount || 0), 0),
  })).filter((g) => g.charges.length > 0);

  const totalSell = sellCharges.reduce((s: number, c: any) => s + (c.sell_amount || 0), 0);
  const currency = quote.currency || 'USD';

  const BRAND = (company as any)?.brand_primary_color || '#1a1a2e';
  const BRAND_ACCENT = (company as any)?.brand_secondary_color || '#1a1a2e';

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 10mm 12mm; size: A4; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: ${BRAND}; background: #fff; font-size: 9px; line-height: 1.28; }
        .page { width: 186mm; margin: 0 auto; padding: 0; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${BRAND}; padding-bottom: 6px; margin-bottom: 8px; }
        .header-left { display: flex; align-items: center; gap: 10px; }
        .header-logo { max-height: 34px; max-width: 100px; object-fit: contain; }
        .company-name { font-size: 14px; font-weight: 700; color: ${BRAND}; }
        .company-details { font-size: 8.5px; color: #555; line-height: 1.35; }
        .quote-title { text-align: center; margin-bottom: 8px; }
        .quote-title h1 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${BRAND}; }
        .quote-title .quote-number { font-size: 10px; color: #555; margin-top: 1px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
        .info-box { border: 1px solid #e0e0e0; border-radius: 5px; padding: 6px 8px; page-break-inside: avoid; }
        .info-box h3 { font-size: 8.5px; font-weight: 600; text-transform: uppercase; color: #888; margin-bottom: 3px; letter-spacing: 0.3px; }
        .info-row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
        .info-label { color: #666; font-size: 8.5px; }
        .info-value { font-weight: 600; font-size: 8.5px; text-align: right; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        thead { display: table-header-group; }
        th { background: ${BRAND}; color: #fff; padding: 3px 6px; text-align: left; font-size: 8.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
        th:last-child { text-align: right; }
        td { padding: 3px 6px; border-bottom: 1px solid #eee; font-size: 8.5px; }
        tr { page-break-inside: avoid; }
        td:last-child { text-align: right; font-family: 'SF Mono', 'Consolas', monospace; }
        .leg-header { background: #f5f5f5; font-weight: 700; font-size: 8.5px; color: #333; }
        .leg-header td { border-bottom: 1px solid #ddd; padding: 3px 6px; }
        .subtotal-row { background: #fafafa; }
        .subtotal-row td { font-weight: 600; border-bottom: 2px solid #eee; font-size: 8.5px; }
        .total-row { background: ${BRAND}; color: #fff; }
        .total-row td { font-weight: 700; font-size: 10px; padding: 5px 6px; border: none; }
        .section-title { font-size: 10px; font-weight: 700; margin: 8px 0 4px; color: ${BRAND}; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #ddd; padding-bottom: 2px; page-break-after: avoid; }
        .notes-box { background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 5px; padding: 6px 8px; font-size: 8.5px; color: #555; white-space: pre-wrap; margin-top: 4px; }
        .footer { margin-top: 8px; padding-top: 5px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-size: 8px; color: #999; }
        .print-btn { position: fixed; bottom: 20px; right: 20px; background: ${BRAND}; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .print-btn:hover { background: #2a2a4e; }
      `}</style>

      <div className="page">
        {/* Header */}
        <div className="header">
          <div className="header-left">
            {company?.logo_url && (
              <img src={company.logo_url} alt="Logo" className="header-logo" />
            )}
            <div>
              <div className="company-name">{company?.name || ''}</div>
              <div className="company-details">
                {company?.cnpj && <div>CNPJ: {company.cnpj}</div>}
                {company?.address && <div>{company.address}</div>}
              </div>
            </div>
          </div>
          <div className="company-details" style={{ textAlign: 'right' }}>
            {company?.email && <div>{company.email}</div>}
            {company?.phone && <div>{company.phone}</div>}
          </div>
        </div>

        {/* Title */}
        <div className="quote-title">
          <h1>Proposta Comercial</h1>
          <div className="quote-number">{quote.quote_number}</div>
        </div>

        {/* Info Grid */}
        <div className="info-grid">
          <div className="info-box">
            <h3>Cliente</h3>
            {client ? (
              <>
                <div className="info-row">
                  <span className="info-value">{client.name}</span>
                </div>
                {client.tax_id && (
                  <div className="info-row">
                    <span className="info-label">CNPJ:</span>
                    <span className="info-value">{client.tax_id}</span>
                  </div>
                )}
                {client.email && (
                  <div className="info-row">
                    <span className="info-label">E-mail:</span>
                    <span className="info-value">{client.email}</span>
                  </div>
                )}
                {client.contact_person && (
                  <div className="info-row">
                    <span className="info-label">Contato:</span>
                    <span className="info-value">{client.contact_person}</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: '#999' }}>—</div>
            )}
          </div>
          <div className="info-box">
            <h3>Detalhes</h3>
            <div className="info-row">
              <span className="info-label">Modal:</span>
              <span className="info-value">{MODE_LABELS[quote.transport_mode] || quote.transport_mode}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Origem:</span>
              <span className="info-value">{quote.origin || '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Destino:</span>
              <span className="info-value">{quote.destination || '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Moeda:</span>
              <span className="info-value">{currency}</span>
            </div>
            {quote.valid_until && (
              <div className="info-row">
                <span className="info-label">Válida até:</span>
                <span className="info-value">{format(new Date(quote.valid_until), 'dd/MM/yyyy')}</span>
              </div>
            )}
            {quote.transit_time && (
              <div className="info-row">
                <span className="info-label">Transit Time:</span>
                <span className="info-value">{quote.transit_time} dias</span>
              </div>
            )}
          </div>
        </div>

        {/* Cargo Details */}
        {items.length > 0 && (
          <>
            <div className="section-title">Detalhes da Carga</div>
            <table>
              <thead>
                <tr>
                  {quote.transport_mode?.startsWith('ocean') && <th>Container</th>}
                  {quote.transport_mode?.startsWith('ocean') && <th>Qtd</th>}
                  <th>Mercadoria</th>
                  <th>Peso (kg)</th>
                  <th>Volume (m³)</th>
                  {(quote.transport_mode === 'air' || quote.transport_mode === 'ocean_lcl') && <th>Peso Taxável</th>}
                  <th>Valor Carga</th>
                  <th>Volumes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any, idx: number) => (
                  <tr key={idx}>
                    {quote.transport_mode?.startsWith('ocean') && <td>{item.container_type || '—'}</td>}
                    {quote.transport_mode?.startsWith('ocean') && <td>{item.container_qty || '—'}</td>}
                    <td>{item.commodity || '—'}</td>
                    <td>{item.weight_kg ? Number(item.weight_kg).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                    <td>{item.volume_cbm ? Number(item.volume_cbm).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                    {(quote.transport_mode === 'air' || quote.transport_mode === 'ocean_lcl') && (
                      <td>{item.chargeable_weight ? Number(item.chargeable_weight).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                    )}
                    <td>{item.cargo_value ? `${item.cargo_value_currency || 'USD'} ${Number(item.cargo_value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                    <td>{item.packages || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Charges - Sell only, grouped by leg */}
        {sellCharges.length > 0 && (
          <>
            <div className="section-title">Taxas</div>
            <table>
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Moeda</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {groupedByLeg.map((group) => (
                  <React.Fragment key={group.leg}>
                    <tr className="leg-header">
                      <td colSpan={3}>{group.label}</td>
                    </tr>
                    {group.charges.map((c: any) => (
                      <tr key={c.id}>
                        <td>{c.description}</td>
                        <td>{c.currency || currency}</td>
                        <td>{Number(c.sell_amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    <tr className="subtotal-row">
                      <td colSpan={2} style={{ textAlign: 'right' }}>Subtotal {group.label}</td>
                      <td>{group.subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  </React.Fragment>
                ))}
                <tr className="total-row">
                  <td colSpan={2} style={{ textAlign: 'right' }}>TOTAL</td>
                  <td>{currency} {totalSell.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {Number((quote as any).storage_fee_amount) > 0 && (
          <div style={{ marginTop: '10px', border: '1px dashed #0284c7', borderRadius: '4px', padding: '8px 12px', background: '#f0f9ff', fontSize: '10px', color: '#334155', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.5px' }}>
                Armazenagem no destino (informativo)
              </div>
              <div style={{ fontStyle: 'italic', marginTop: '2px' }}>
                {(quote as any).storage_fee_note || 'Pago diretamente ao armazém no destino — não incluso no total.'}
              </div>
            </div>
            <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>
              {(quote as any).storage_fee_currency || 'BRL'}{' '}
              {Number((quote as any).storage_fee_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        )}

        {/* Notes */}
        {quote.notes && (
          <>
            <div className="section-title">Observações</div>
            <div className="notes-box">{quote.notes}</div>
          </>
        )}

        {/* Footer */}
        <div className="footer">
          <span>Emitido em {format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
          <span>{company?.name}</span>
        </div>
      </div>

      {/* Print button (hidden when printing) */}
      <button className="print-btn no-print" onClick={() => window.print()}>
        🖨️ Imprimir / Salvar PDF
      </button>
    </>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { generatePdfFromElement, pdfSafeStyles } from '@/lib/pdf-utils';
import { format, parseISO } from 'date-fns';
import { transportModeLabel } from '@/lib/transportMode';

interface Props {
  open: boolean;
  onClose: () => void;
  debitNoteId: string;
  companyId: string;
  quoteId: string;
}

export function ClientDebitNotePdfDialog({ open, onClose, debitNoteId, companyId, quoteId }: Props) {
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [data, setData] = useState<any>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [dnRes, itemsRes, companyRes, quoteRes] = await Promise.all([
        supabase.from('debit_notes' as any).select('*').eq('id', debitNoteId).single(),
        supabase.from('debit_note_items').select('*').eq('debit_note_id', debitNoteId),
        supabase.from('companies').select('*').eq('id', companyId).single(),
        supabase.from('quotes').select('*, clients(*)').eq('id', quoteId).single(),
      ]);
      const dn: any = dnRes.data;
      let bank = null;
      if (dn?.bank_account_id) {
        const { data: b } = await supabase.from('company_bank_accounts' as any).select('*').eq('id', dn.bank_account_id).single();
        bank = b;
      }
      setData({ dn, items: itemsRes.data || [], company: companyRes.data, quote: quoteRes.data, bank });
      setLoading(false);
    })();
  }, [open, debitNoteId, companyId, quoteId]);

  async function download() {
    if (!ref.current || !data) return;
    setDownloading(true);
    try {
      await generatePdfFromElement(ref.current, `${String(data.dn.dn_number).replace(/[\\/]/g, '-')}.pdf`);
    } finally { setDownloading(false); }
  }

  const brand = (data?.company as any)?.brand_primary_color || '#007BFF';
  const brand2 = (data?.company as any)?.brand_secondary_color || '#20C997';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Nota de Débito {data?.dn?.dn_number}</DialogTitle>
        </DialogHeader>
        {loading || !data ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" /></div>
        ) : (
          <>
            <div style={{ background: '#fff', padding: 24 }}>
              <div ref={ref} style={{ width: 780, boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: 'Arial, sans-serif', fontSize: 11, margin: '0 auto', padding: 32 }}>
                {/* Header */}
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
                  <tbody>
                    <tr>
                      <td style={{ verticalAlign: 'top' }}>
                        {data.company?.logo_url ? (
                          <img src={data.company.logo_url} alt="" style={{ maxHeight: 60, maxWidth: 220 }} />
                        ) : (
                          <div style={{ fontWeight: 700, fontSize: 18, color: brand }}>{data.company?.name}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                        <div style={{ background: brand, color: '#fff', padding: '10px 16px', fontWeight: 700, fontSize: 16, letterSpacing: 1, display: 'inline-block' }}>
                          DEBIT NOTE
                        </div>
                        <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 13 }}>Nº {data.dn.dn_number}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>
                          Emissão: {format(parseISO(data.dn.issue_date), 'dd/MM/yyyy')}<br />
                          <strong style={{ color: '#111' }}>Vencimento: {data.dn.due_date ? format(parseISO(data.dn.due_date), 'dd/MM/yyyy') : '-'}</strong>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Emitente / Sacado */}
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                  <tbody>
                    <tr>
                      <td style={{ width: '50%', verticalAlign: 'top', padding: 10, border: '1px solid #ddd' }}>
                        <div style={{ fontSize: 9, color: brand, fontWeight: 700, marginBottom: 4 }}>EMITENTE</div>
                        <div style={{ fontWeight: 700 }}>{data.company?.name}</div>
                        {data.company?.cnpj && <div>CNPJ: {data.company.cnpj}</div>}
                        {data.company?.address && <div>{data.company.address}</div>}
                        {data.company?.email && <div>{data.company.email}</div>}
                        {data.company?.phone && <div>{data.company.phone}</div>}
                      </td>
                      <td style={{ width: '50%', verticalAlign: 'top', padding: 10, border: '1px solid #ddd' }}>
                        <div style={{ fontSize: 9, color: brand, fontWeight: 700, marginBottom: 4 }}>CLIENTE</div>
                        <div style={{ fontWeight: 700 }}>{data.quote?.clients?.name}</div>
                        {data.quote?.clients?.tax_id && <div>{data.quote.clients.tax_id_type || 'ID'}: {data.quote.clients.tax_id}</div>}
                        {data.quote?.clients?.address && <div>{data.quote.clients.address}</div>}
                        {data.quote?.clients?.email && <div>{data.quote.clients.email}</div>}
                        {data.quote?.clients?.phone && <div>{data.quote.clients.phone}</div>}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Referência */}
                <div style={{ background: '#f5f7fa', padding: 8, marginBottom: 12, fontSize: 10 }}>
                  <strong>REFERÊNCIA:</strong> {data.quote?.quote_number}
                  {data.quote?.origin && data.quote?.destination && <> — {data.quote.origin} → {data.quote.destination}</>}
                  {data.quote?.transport_mode && <> · {transportModeLabel(data.quote.transport_mode).toUpperCase()}</>}
                </div>

                {/* Itens */}
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                  <thead>
                    <tr style={{ background: brand, color: '#fff' }}>
                      <th style={{ padding: 6, textAlign: 'left', fontSize: 10 }}>Descrição</th>
                      <th style={{ padding: 6, textAlign: 'right', fontSize: 10, width: 110 }}>Valor origem</th>
                      <th style={{ padding: 6, textAlign: 'right', fontSize: 10, width: 70 }}>Câmbio</th>
                      <th style={{ padding: 6, textAlign: 'right', fontSize: 10, width: 110 }}>Valor BRL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it: any) => (
                      <tr key={it.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: 6 }}>{it.description}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontFamily: 'monospace' }}>
                          {it.currency} {Number(it.quoted_amount ?? it.charged_amount).toFixed(2)}
                        </td>
                        <td style={{ padding: 6, textAlign: 'right', fontFamily: 'monospace' }}>
                          {it.currency === 'BRL' ? '—' : Number(it.exchange_rate || 1).toFixed(4)}
                        </td>
                        <td style={{ padding: 6, textAlign: 'right', fontFamily: 'monospace' }}>
                          BRL {Number(it.charged_amount).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td height={30} colSpan={3} style={pdfSafeStyles.totalCell(brand)}>TOTAL</td>
                      <td height={30} style={{ ...pdfSafeStyles.totalCell(brand), textAlign: 'right' }}>
                        BRL {Number(data.dn.total_amount).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Banco */}
                {data.bank && (
                  <div style={{ border: `2px solid ${brand}`, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: brand, marginBottom: 6 }}>DADOS BANCÁRIOS PARA PAGAMENTO</div>
                    <table style={{ width: '100%', fontSize: 10 }}>
                      <tbody>
                        <tr><td style={{ width: 130 }}><strong>Banco</strong></td><td>{data.bank.bank_name}</td></tr>
                        {data.bank.branch && <tr><td><strong>Agência</strong></td><td>{data.bank.branch}</td></tr>}
                        {data.bank.account_number && <tr><td><strong>Conta</strong></td><td>{data.bank.account_number}</td></tr>}
                        <tr><td><strong>Titular</strong></td><td>{data.bank.account_holder}</td></tr>
                        {data.bank.tax_id && <tr><td><strong>CNPJ/CPF</strong></td><td>{data.bank.tax_id}</td></tr>}
                        <tr><td><strong>Moeda</strong></td><td>{data.bank.currency}</td></tr>
                        {data.bank.iban && <tr><td><strong>IBAN</strong></td><td>{data.bank.iban}</td></tr>}
                        {data.bank.swift && <tr><td><strong>SWIFT/BIC</strong></td><td>{data.bank.swift}</td></tr>}
                        {data.bank.pix_key && <tr><td><strong>PIX</strong></td><td>{data.bank.pix_key}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}

                {data.dn.notes && (
                  <div style={{ borderTop: '1px solid #ddd', paddingTop: 8, fontSize: 10, color: '#333' }}>
                    <strong>Observações:</strong> {data.dn.notes}
                  </div>
                )}

                <div style={{ marginTop: 24, textAlign: 'center', fontSize: 9, color: '#888', borderTop: `1px solid ${brand2}`, paddingTop: 8 }}>
                  {data.company?.name} · {data.company?.email || ''} · {data.company?.phone || ''}
                </div>
              </div>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={download} disabled={loading || downloading}>
            {downloading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

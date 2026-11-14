import type { CSSProperties } from 'react';
import { renderElementToPdf, downloadBlob, type PdfEngineOptions } from './pdfEngine';

/**
 * Gera o PDF (A4, margens padrão, quebras de página seguras, rodapé com numeração) a partir de um elemento do DOM
 * e, por padrão, baixa o arquivo. Toda a lógica vive em `pdfEngine.ts`; este wrapper existe pelos chamadores antigos.
 * `windowWidth` é ignorado: o motor usa sempre a largura útil da folha (190 mm).
 */
export async function generatePdfFromElement(
  element: HTMLElement,
  filename: string,
  opts: { download?: boolean; windowWidth?: number } & PdfEngineOptions = { download: true }
): Promise<Blob> {
  const { download, windowWidth: _ignorado, ...engine } = opts;
  const blob = await renderElementToPdf(element, engine);
  if (download !== false) downloadBlob(blob, filename);
  return blob;
}

/**
 * Style presets that render reliably in html2canvas. Use these
 * instead of flex/grid alignment on colored backgrounds.
 */
export const pdfSafeStyles = {
  // Colored badge with vertically centered text (height === line-height)
  badge: (bg: string, color = '#fff', height = 26): CSSProperties => ({
    display: 'inline-block',
    background: bg,
    color,
    height: `${height}px`,
    lineHeight: `${height}px`,
    padding: '0 16px',
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    borderRadius: '3px',
  }),
  // Total row cell (use in <td> with height attribute for reliable centering)
  totalCell: (bg: string): CSSProperties => ({
    background: bg,
    color: '#fff',
    padding: '0 14px',
    fontWeight: 700,
    fontFamily: 'monospace',
  }),
};
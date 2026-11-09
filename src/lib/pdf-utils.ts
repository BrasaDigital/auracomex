import type { CSSProperties } from 'react';

/**
 * Utility to generate a PDF from a DOM element in a way that is
 * "html2pdf.js-safe": avoids flex/grid centering bugs, page-break
 * issues and font baseline offsets by rendering at a fixed A4 width.
 *
 * Returns a Blob and triggers a direct download in one click.
 */
export async function generatePdfFromElement(
  element: HTMLElement,
  filename: string,
  opts: { download?: boolean; windowWidth?: number } = { download: true }
): Promise<Blob> {
  const html2pdf = (await import('html2pdf.js')).default;
  const worker = html2pdf()
    .set({
      margin: [8, 10, 10, 10],
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        letterRendering: true,
        windowWidth: opts.windowWidth ?? 800,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['.pdf-avoid-break', 'tr', 'thead'] },
    } as any)
    .from(element);

  const blob: Blob = await worker.outputPdf('blob');

  if (opts.download !== false) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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
/**
 * Compatibilidade: o gerador de PDF agora é único (`pdfEngine.ts`). Mantido para os chamadores da Estimativa/Numerário.
 * `fitOnePage` (Numerário): se passar de uma folha por pouco, reduz para caber inteiro em UMA página A4.
 */
import { renderElementToPdf, type PdfEngineOptions } from './pdfEngine';

export function elementToPdfBlob(source: HTMLElement, opts: PdfEngineOptions = {}): Promise<Blob> {
  return renderElementToPdf(source, opts);
}

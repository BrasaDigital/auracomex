/**
 * Converte um elemento do DOM em PDF A4 de forma independente do tamanho da janela, do zoom do navegador e da
 * rolagem do diálogo onde o documento é exibido.
 *
 * Antes o PDF era gerado direto do elemento visível dentro do diálogo: se o diálogo ficava mais estreito que a
 * folha (janela pequena, zoom do navegador em 150%+), a folha era cortada/descentralizada, e a quebra de página
 * cortava o conteúdo. Aqui o elemento é CLONADO para uma área fora da tela com largura fixa de 210 mm (largura
 * real da folha A4) antes de ser capturado.
 *
 * fitOnePage (Numerário): o documento foi desenhado para UMA folha. Se o conteúdo passar de uma página A4 por
 * pouco, ele é reduzido proporcionalmente e centralizado para caber inteiro (nada é cortado nem vai sozinho para
 * uma 2ª página). Se passar demais (reduzir abaixo de MIN_ESCALA deixaria a letra pequena demais), segue a
 * paginação normal, sem cortar blocos (.pdf-avoid-break).
 */
const MIN_ESCALA = 0.75;

const BASE = {
  margin: 0,
  image: { type: 'jpeg', quality: 0.98 },
  html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
} as const;

export async function elementToPdfBlob(source: HTMLElement, opts: { fitOnePage?: boolean } = {}): Promise<Blob> {
  const html2pdf = (await import('html2pdf.js')).default;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;background:#fff;pointer-events:none;';
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.width = '210mm';
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    // Garante que imagens (logo da empresa) já carregaram no clone antes da captura.
    await Promise.all(
      Array.from(clone.querySelectorAll('img')).map(
        img => (img.complete ? null : new Promise(resolve => { img.onload = img.onerror = () => resolve(null); })),
      ),
    );

    const paginado = () =>
      html2pdf().set({ ...BASE, pagebreak: { mode: ['css', 'legacy'], avoid: '.pdf-avoid-break' } } as any).from(clone).outputPdf('blob') as Promise<Blob>;

    if (!opts.fitOnePage) return await paginado();

    const canvas: HTMLCanvasElement = await html2pdf().set(BASE as any).from(clone).toCanvas().get('canvas');
    const pageW = canvas.width;
    const pageH = Math.floor((pageW * 297) / 210) - 2; // 2px de folga contra arredondamento do jsPDF (evita 2ª folha em branco)
    const escala = Math.min(1, pageH / canvas.height);
    if (escala < MIN_ESCALA) return await paginado();

    const fitted = document.createElement('canvas');
    fitted.width = pageW;
    fitted.height = pageH;
    const ctx = fitted.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageW, pageH);
    const w = canvas.width * escala;
    const h = canvas.height * escala;
    ctx.drawImage(canvas, (pageW - w) / 2, 0, w, h);

    return await ((html2pdf().set({ ...BASE, pagebreak: { mode: [] } } as any) as any).from(fitted, 'canvas').outputPdf('blob') as Promise<Blob>);
  } finally {
    host.remove();
  }
}

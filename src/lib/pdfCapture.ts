/**
 * Converte um elemento do DOM em PDF A4 de forma independente do tamanho da janela, do zoom do navegador e da
 * rolagem do diálogo onde o documento é exibido.
 *
 * - O elemento é CLONADO para uma área fora da tela com largura fixa de 210 mm (largura real da folha A4) antes
 *   de ser capturado. Antes o PDF saía direto do elemento visível dentro do diálogo: se o diálogo ficava mais
 *   estreito que a folha (janela pequena, zoom 150%+), a folha saía cortada/descentralizada.
 * - Texto: o html2canvas, por padrão, REDESENHA o texto e erra a posição vertical (texto de peso normal desce
 *   ~2 px e "encosta" na linha da célula; o cabeçalho do Numerário ficava bagunçado). No Chrome/Edge usamos
 *   foreignObjectRendering, em que o próprio navegador desenha o texto, idêntico ao da tela. As imagens (logo)
 *   são convertidas para data URL antes, porque nesse modo imagens externas não carregam. Se algo falhar, volta
 *   ao modo padrão.
 * - fitOnePage (Numerário): o documento foi desenhado para UMA folha. Se o conteúdo passar de uma página A4 por
 *   pouco, ele é reduzido proporcionalmente e centralizado para caber inteiro (nada é cortado nem vai sozinho
 *   para uma 2ª página). Se passar demais (reduzir abaixo de MIN_ESCALA deixaria a letra pequena demais), segue
 *   a paginação normal, sem cortar blocos (.pdf-avoid-break).
 */
const MIN_ESCALA = 0.75;

const BASE = {
  margin: 0,
  image: { type: 'jpeg', quality: 0.98 },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
} as const;

// DESLIGADO: em produção a renderização nativa gerou PDF em branco. Reativar só com proteção contra canvas vazio.
const suportaForeignObject = () => false && /Chrome\/|Edg\//.test(navigator.userAgent);

/** Troca o src das imagens do clone por data URL. Devolve false se alguma não pôde ser convertida. */
async function embutirImagens(root: HTMLElement): Promise<boolean> {
  let ok = true;
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(async img => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      try {
        const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        });
        img.removeAttribute('crossorigin');
        img.src = dataUrl;
        await (img.decode ? img.decode().catch(() => undefined) : Promise.resolve());
      } catch {
        ok = false;
      }
    }),
  );
  return ok;
}

export async function elementToPdfBlob(source: HTMLElement, opts: { fitOnePage?: boolean } = {}): Promise<Blob> {
  const html2pdf = (await import('html2pdf.js')).default;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;background:#fff;pointer-events:none;';
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.width = '210mm';
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    // Garante que as imagens (logo da empresa) já carregaram no clone antes da captura.
    await Promise.all(
      Array.from(clone.querySelectorAll('img')).map(
        img => (img.complete ? null : new Promise(resolve => { img.onload = img.onerror = () => resolve(null); })),
      ),
    );
    const imagensEmbutidas = await embutirImagens(clone);

    const opcoes = (foreignObjectRendering: boolean, extra: Record<string, unknown> = {}) =>
      ({
        ...BASE,
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, foreignObjectRendering },
        ...extra,
      }) as any;

    const gerar = async (foreignObjectRendering: boolean): Promise<Blob> => {
      const paginado = () =>
        html2pdf()
          .set(opcoes(foreignObjectRendering, { pagebreak: { mode: ['css', 'legacy'], avoid: '.pdf-avoid-break' } }))
          .from(clone)
          .outputPdf('blob') as Promise<Blob>;

      if (!opts.fitOnePage) return await paginado();

      const canvas: HTMLCanvasElement = await html2pdf().set(opcoes(foreignObjectRendering)).from(clone).toCanvas().get('canvas');
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

      const worker: any = html2pdf().set(opcoes(foreignObjectRendering, { pagebreak: { mode: [] } }));
      return await (worker.from(fitted, 'canvas').outputPdf('blob') as Promise<Blob>);
    };

    if (suportaForeignObject() && imagensEmbutidas) {
      try {
        return await gerar(true);
      } catch (e) {
        console.warn('PDF: renderização nativa falhou, usando o modo padrão', e);
      }
    }
    return await gerar(false);
  } finally {
    host.remove();
  }
}

/**
 * Motor único de PDF do AuraComex (A4, retrato).
 *
 * Todos os documentos emitidos (Cotação, Estimativa, Numerário, Prestação de contas, ND ao cliente, Ordem de
 * Coleta) passam por aqui, para terem a mesma folha, as mesmas margens e a mesma regra de quebra de página.
 *
 * Como funciona
 * - O elemento é CLONADO para fora da tela com a largura útil da folha (210 mm - margens = 190 mm), então o
 *   documento usa a folha inteira e não depende do tamanho do diálogo/zoom do navegador.
 * - O clone é capturado UMA vez (html2canvas) e depois fatiado em páginas. Os pontos de corte são calculados a
 *   partir do DOM, nunca no meio de: linha de tabela (tr), bloco marcado (.pdf-avoid-break / [data-pdf-atomic]),
 *   linha de texto, e nunca deixando um título (breakAfter:avoid / [data-pdf-keep-next]) sozinho no fim da página.
 * - Tabela que continua na página seguinte repete o <thead> no topo.
 * - Quebra forçada: elemento com pageBreakAfter/breakAfter "always"|"page" (ou *Before) começa nova página.
 * - Rodapé padrão em toda página: texto do documento à esquerda e "Página X de Y" à direita.
 * - Bloco maior que uma página inteira é permitido: ele é fatiado por linha (tr / linha de texto), sem perder nada.
 *
 * Marcadores aceitos no HTML do documento:
 *   .pdf-avoid-break | [data-pdf-atomic]   bloco que não pode ser cortado
 *   [data-pdf-keep-next]                   título que deve ficar junto do bloco seguinte
 *   [data-pdf-sheet]                       "folha" legada (tinha width/padding/minHeight de A4): o motor zera isso
 */

export const PDF_PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 15, // inclui a faixa do rodapé
  marginLeftMm: 10,
} as const;

export const PDF_CONTENT_WIDTH_MM = PDF_PAGE.widthMm - PDF_PAGE.marginLeftMm - PDF_PAGE.marginRightMm; // 190
export const PDF_CONTENT_HEIGHT_MM = PDF_PAGE.heightMm - PDF_PAGE.marginTopMm - PDF_PAGE.marginBottomMm; // 269

/** Abaixo dessa escala o "caber em uma folha" deixa a letra pequena demais: segue a paginação normal. */
const MIN_ESCALA_UMA_FOLHA = 0.75;
/** Fatia mínima (px de layout) para aceitar um ponto de corte; abaixo disso corta no limite da página. */
const MIN_FATIA_PX = 40;
const MAX_CANVAS_PX = 30000;

export interface PdfEngineOptions {
  /** Documento desenhado para UMA folha: se passar por pouco, reduz proporcionalmente para caber inteiro. */
  fitOnePage?: boolean;
  /** Texto à esquerda do rodapé (ex.: "ND 0012 - Atlas Log"). Evite caracteres fora do Latin-1. */
  footerLabel?: string;
  /** Faixa pequena no topo das páginas 2+ (ex.: "Nota de Debito 0012"). */
  runningHeader?: string;
  /** Padrão: true. */
  pageNumbers?: boolean;
  /** Resolução da captura. Padrão 2.5 (~240 dpi). */
  scale?: number;
}

interface Span { top: number; bottom: number }
interface HeadInfo extends Span { tableTop: number; tableBottom: number }
interface PagePlan { start: number; end: number; head?: Span; bleed?: number }

/** html2canvas desenha o texto ~2px abaixo da posição do DOM: ao cortar entre linhas, a página mostra 2px a mais. */
const SANGRIA_TEXTO_PX = 2;

const isBreakValue = (v: string | undefined) => v === 'always' || v === 'page' || v === 'left' || v === 'right';

async function waitImages(root: HTMLElement) {
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(img =>
      img.complete ? null : new Promise(resolve => { img.onload = img.onerror = () => resolve(null); }),
    ),
  );
}

/** Troca o src das imagens por data URL (evita imagem externa sem CORS "sujar" o canvas). */
async function embutirImagens(root: HTMLElement) {
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
        /* segue com a imagem original (useCORS) */
      }
    }),
  );
}

/** Zera largura/padding/altura mínima "de folha" que os documentos antigos traziam; a folha agora é do motor. */
function normalizar(clone: HTMLElement) {
  clone.style.width = `${PDF_CONTENT_WIDTH_MM}mm`;
  clone.style.maxWidth = 'none';
  clone.style.minWidth = '0';
  clone.style.margin = '0';
  clone.style.padding = '0';
  clone.style.boxSizing = 'border-box';
  clone.style.boxShadow = 'none';
  clone.style.minHeight = '0';
  clone.querySelectorAll<HTMLElement>('[data-pdf-sheet]').forEach(el => {
    el.style.width = 'auto';
    el.style.maxWidth = 'none';
    el.style.minHeight = '0';
    el.style.padding = '0';
    el.style.margin = '0';
    el.style.boxShadow = 'none';
  });
}

function medir(clone: HTMLElement, pageH: number) {
  const rootTop = clone.getBoundingClientRect().top;
  const span = (el: Element): Span => {
    const r = el.getBoundingClientRect();
    return { top: r.top - rootTop, bottom: r.bottom - rootTop };
  };

  // Blocos que não podem ser cortados. Os maiores que uma página são ignorados (precisam ser fatiados).
  const atomicos: Span[] = Array.from(clone.querySelectorAll('tr, img, .pdf-avoid-break, [data-pdf-atomic]'))
    .map(span)
    .filter(s => s.bottom - s.top > 1 && s.bottom - s.top <= pageH * 0.95);

  // Títulos que não podem ficar sozinhos no fim da página.
  const keepNext: Span[] = [];
  const forcados: number[] = [];
  clone.querySelectorAll<HTMLElement>('*').forEach(el => {
    const st = el.style;
    const kn =
      el.hasAttribute('data-pdf-keep-next') ||
      st.breakAfter === 'avoid' || st.pageBreakAfter === 'avoid' || st.breakAfter === 'avoid-page';
    if (kn) {
      const s = span(el);
      if (s.bottom - s.top > 1) keepNext.push(s);
    }
    if (isBreakValue(st.breakAfter) || isBreakValue(st.pageBreakAfter)) forcados.push(span(el).bottom);
    if (isBreakValue(st.breakBefore) || isBreakValue(st.pageBreakBefore)) forcados.push(span(el).top);
  });

  // Linhas de texto (cada fragmento de linha de cada nó de texto).
  const linhas: Span[] = [];
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    range.selectNodeContents(n);
    for (const r of Array.from(range.getClientRects())) {
      if (r.height > 0 && r.height < 80) linhas.push({ top: r.top - rootTop, bottom: r.bottom - rootTop });
    }
  }

  // Tabelas com <thead>: cabeçalho repetido nas páginas em que a tabela continua.
  const heads: HeadInfo[] = [];
  clone.querySelectorAll('table').forEach(t => {
    const th = t.tHead;
    if (!th || !th.rows.length) return;
    const ts = span(t);
    const hs = span(th);
    if (hs.bottom - hs.top > 1 && hs.bottom - hs.top < pageH / 4) heads.push({ ...hs, tableTop: ts.top, tableBottom: ts.bottom });
  });

  return {
    total: clone.scrollHeight,
    atomicos,
    keepNext,
    linhas,
    heads,
    forcados: Array.from(new Set(forcados.map(f => Math.round(f)))).sort((a, b) => a - b),
  };
}

type Medidas = ReturnType<typeof medir>;

/** Dado o limite "duro" da página, recua até o ponto de corte seguro mais próximo. */
function ajustarCorte(m: Medidas, start: number, limit: number): { end: number; bleed: number } {
  let y = limit;
  for (let i = 0; i < 40; i++) {
    let ny = y;
    for (const a of m.atomicos) if (a.top < y - 0.5 && a.bottom > y + 0.5 && a.top < ny) ny = a.top;
    for (const k of m.keepNext) if (k.bottom <= y + 1 && k.bottom > y - 30 && k.top < ny) ny = k.top;
    for (const l of m.linhas) if (l.top < y - 0.5 && l.bottom > y + 0.5 && l.top < ny) ny = l.top;
    if (ny >= y - 0.01) break;
    if (ny <= start + MIN_FATIA_PX) return { end: limit, bleed: 0 }; // nada razoável para recuar: corta no limite
    y = ny;
  }
  // Corte entre linhas de texto (e não na borda de um bloco/linha de tabela): aplica a sangria do texto.
  const naBordaDeBloco =
    m.atomicos.some(a => Math.abs(a.top - y) < 0.5) || m.keepNext.some(k => Math.abs(k.top - y) < 0.5);
  const noTopoDeLinha = m.linhas.some(l => Math.abs(l.top - y) < 0.5);
  // A sangria vale para o fim desta página E o início da próxima (as pontas das letras já caíram na sangria).
  return { end: y + (!naBordaDeBloco && noTopoDeLinha ? SANGRIA_TEXTO_PX : 0), bleed: 0 };
}

function planejar(m: Medidas, pageH: number): PagePlan[] {
  const paginas: PagePlan[] = [];
  let start = 0;
  let guard = 0;
  while (start < m.total - 1 && guard++ < 200) {
    const head =
      start > 0
        ? m.heads
            .filter(h => h.bottom <= start + 1 && start < h.tableBottom - 4)
            .sort((a, b) => b.top - a.top)[0]
        : undefined;
    const headH = head ? head.bottom - head.top : 0;
    const limit = start + (pageH - headH);
    // Quebra forçada dentro da página atual (inclusive na última) começa nova página.
    const forced = m.forcados.find(f => f > start + 1 && f < m.total - 2 && f <= limit);
    if (forced === undefined && limit >= m.total - 0.5) {
      paginas.push({ start, end: m.total, head });
      break;
    }
    const corte = forced !== undefined ? { end: forced, bleed: 0 } : ajustarCorte(m, start, limit);
    paginas.push({ start, end: corte.end, head, bleed: corte.bleed });
    start = corte.end;
  }
  // Remove página final vazia (só espaço em branco).
  while (paginas.length > 1 && paginas[paginas.length - 1].end - paginas[paginas.length - 1].start < 3) paginas.pop();
  return paginas;
}

export async function renderElementToPdf(source: HTMLElement, opts: PdfEngineOptions = {}): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_CONTENT_WIDTH_MM}mm;background:#fff;pointer-events:none;`;
  const clone = source.cloneNode(true) as HTMLElement;
  normalizar(clone);
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await waitImages(clone);
    await embutirImagens(clone);
    if ((document as any).fonts?.ready) await (document as any).fonts.ready;

    const layoutW = clone.getBoundingClientRect().width; // px de layout equivalentes a 190 mm
    const pxPorMm = layoutW / PDF_CONTENT_WIDTH_MM;
    const pageH = PDF_CONTENT_HEIGHT_MM * pxPorMm;

    const medidas = medir(clone, pageH);
    const total = medidas.total;
    const scale = Math.max(1, Math.min(opts.scale ?? 2.5, MAX_CANVAS_PX / Math.max(total, 1)));

    const canvas = await html2canvas(clone, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      width: Math.ceil(layoutW),
      height: Math.ceil(total),
      windowWidth: Math.ceil(layoutW),
    });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const { marginLeftMm: ml, marginTopMm: mt } = PDF_PAGE;

    // Documento de UMA folha que passou por pouco: reduz para caber inteiro (nada vai sozinho para a 2ª página).
    const escala1 = pageH / total;
    const umaFolha = !!opts.fitOnePage && total > pageH && escala1 >= MIN_ESCALA_UMA_FOLHA;

    let planos: PagePlan[];
    if (umaFolha) planos = [{ start: 0, end: total }];
    else planos = planejar(medidas, pageH);

    const fatia = (srcTopPx: number, srcHPx: number, dest: HTMLCanvasElement, destTopPx: number) => {
      const ctx = dest.getContext('2d')!;
      const sy = Math.round(srcTopPx * scale);
      const sh = Math.max(1, Math.min(Math.round(srcHPx * scale), canvas.height - sy));
      ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, destTopPx, canvas.width, sh);
    };

    planos.forEach((p, i) => {
      if (i > 0) pdf.addPage();
      const headH = p.head ? p.head.bottom - p.head.top : 0;
      const bodyH = p.end - p.start;
      const totalH = headH + bodyH;
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = Math.max(1, Math.round(totalH * scale));
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      if (p.head) fatia(p.head.top, headH, out, 0);
      fatia(p.start, bodyH, out, Math.round(headH * scale));

      const img = out.toDataURL('image/jpeg', 0.95);
      if (umaFolha) {
        const w = PDF_CONTENT_WIDTH_MM * escala1;
        pdf.addImage(img, 'JPEG', ml + (PDF_CONTENT_WIDTH_MM - w) / 2, mt, w, PDF_CONTENT_HEIGHT_MM, undefined, 'FAST');
      } else {
        pdf.addImage(img, 'JPEG', ml, mt, PDF_CONTENT_WIDTH_MM, totalH / pxPorMm, undefined, 'FAST');
      }
    });

    // Rodapé / cabeçalho corrente em todas as páginas.
    const n = planos.length;
    const { widthMm: W, heightMm: H, marginRightMm: mr } = PDF_PAGE;
    for (let i = 1; i <= n; i++) {
      pdf.setPage(i);
      pdf.setDrawColor(210, 214, 220);
      pdf.setLineWidth(0.2);
      pdf.line(ml, H - 11, W - mr, H - 11);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(120, 126, 136);
      if (opts.footerLabel) pdf.text(opts.footerLabel, ml, H - 7.5);
      if (opts.pageNumbers !== false) pdf.text(`Página ${i} de ${n}`, W - mr, H - 7.5, { align: 'right' });
      if (i > 1 && opts.runningHeader) {
        pdf.text(opts.runningHeader, ml, 8);
        pdf.line(ml, 9.5, W - mr, 9.5);
      }
    }

    return pdf.output('blob');
  } finally {
    host.remove();
  }
}

/** Baixa um Blob como arquivo. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

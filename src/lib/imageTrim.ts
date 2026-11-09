/**
 * Recorta as margens vazias (transparentes ou brancas) de um logo antes do upload.
 * Logos com muita margem em volta aparecem minúsculos no site e nos PDFs, porque
 * o tamanho exibido é limitado pela imagem inteira, não pela arte.
 * Se algo falhar (ou não houver margem relevante), devolve o arquivo original.
 */
export async function trimImageMargins(file: File, opts: { forDarkBg?: boolean } = {}): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    // Fundo transparente (canto com alpha baixo): só o alpha conta.
    // Fundo opaco: branco/quase branco é tratado como margem.
    const transparentBg = data[3] < 16;
    // Logo para fundo escuro costuma ser branco: com fundo opaco não dá pra
    // distinguir margem de arte, então só recorta quando o fundo é transparente.
    if (opts.forDarkBg && !transparentBg) return file;
    const isArt = (i: number) => {
      if (data[i + 3] < 16) return false;
      if (transparentBg) return true;
      return !(data[i] > 242 && data[i + 1] > 242 && data[i + 2] > 242);
    };

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isArt((y * w + x) * 4)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return file;

    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.02);
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(w, maxX + pad + 1) - sx;
    const sh = Math.min(h, maxY + pad + 1) - sy;

    // Sem margem relevante (menos de 3% de área a menos): mantém o original.
    if (scale === 1 && (sw * sh) / (w * h) > 0.97) return file;

    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const octx = out.getContext('2d');
    if (!octx) return file;
    octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob: Blob | null = await new Promise((res) => out.toBlob(res, 'image/png'));
    if (!blob) return file;
    return new File([blob], 'logo.png', { type: 'image/png' });
  } catch {
    return file;
  }
}

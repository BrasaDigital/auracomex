/**
 * Exporta linhas para um arquivo .xlsx e dispara o download no navegador.
 * O exceljs é carregado sob demanda (import dinâmico) pra não pesar o bundle inicial.
 */
export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  /** 'money' = #,##0.00 ; 'rate' = 0.0000 ; 'date' = dd/mm/yyyy (valor Date). */
  kind?: 'money' | 'rate' | 'date';
}

export async function exportRowsToXlsx(opts: {
  filename: string;
  sheetName: string;
  columns: XlsxColumn[];
  rows: Array<Record<string, string | number | Date | null>>;
  /** Linha de total no fim (mesmas chaves das colunas). */
  totalRow?: Record<string, string | number | null>;
}) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName.slice(0, 31));
  ws.columns = opts.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of opts.rows) ws.addRow(r);
  if (opts.totalRow) {
    const t = ws.addRow(opts.totalRow);
    t.font = { bold: true };
  }
  opts.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === 'money') col.numFmt = '#,##0.00';
    else if (c.kind === 'rate') col.numFmt = '0.0000';
    else if (c.kind === 'date') col.numFmt = 'dd/mm/yyyy';
  });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 'yyyy-MM-dd' -> Date local (evita virar o dia anterior por fuso). */
export function ymdToDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

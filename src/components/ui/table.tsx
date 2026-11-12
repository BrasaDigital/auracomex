import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tabela compartilhada (usada em todo o app).
 *
 * - Larguras de coluna ajustáveis: arraste a borda direita do título da coluna; duplo clique na borda volta todas as
 *   colunas da tabela ao padrão. A escolha fica salva no navegador de cada pessoa (localStorage), por página e por
 *   conjunto de títulos da tabela. A tabela nunca fica mais estreita que a página (width 100%): sobra de largura é
 *   repartida entre as colunas; se as colunas somarem mais que a página, aparece rolagem horizontal (minWidth).
 * - Enquanto ninguém mexe nas larguras, o layout continua exatamente o automático de antes.
 * - Fica de fora (sem alça): tabela sem <thead>, com título de coluna mesclado (colSpan) ou que já define as próprias
 *   larguras com <colgroup> (ex.: Tracking). `resizable={false}` também desliga.
 * - Contorno bem claro em colunas e linhas (border-border/60).
 */

const MIN_COL = 48;
const MAX_COL = 900;

type TableResizeCtx = { enabled: boolean; start: (e: React.PointerEvent<HTMLElement>) => void; reset: () => void };
const TableResizeContext = React.createContext<TableResizeCtx>({ enabled: false, start: () => {}, reset: () => {} });

function hashText(t: string): string {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Colunas a partir da última linha do cabeçalho; null se a tabela não puder ter larguras ajustáveis. */
function lerColunas(table: HTMLTableElement): { count: number; texts: string } | null {
  if (table.querySelector(":scope > colgroup:not([data-auto-cols])")) return null; // já define as próprias larguras
  const head = table.tHead;
  if (!head || head.rows.length === 0) return null;
  const cells = Array.from(head.rows[head.rows.length - 1].cells);
  if (cells.length === 0 || cells.some((c) => c.colSpan > 1)) return null;
  return { count: cells.length, texts: cells.map((c) => (c.textContent || "").trim()).join("|") };
}

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** false = sem alças de redimensionar (padrão: true). */
  resizable?: boolean;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, style, children, resizable = true, ...props }, ref) => {
    const tableRef = React.useRef<HTMLTableElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLTableElement | null) => {
        tableRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLTableElement | null>).current = node;
      },
      [ref],
    );

    const [eligible, setEligible] = React.useState(false);
    const [widths, setWidths] = React.useState<number[] | null>(null);
    const widthsRef = React.useRef<number[] | null>(null);
    const keyRef = React.useRef<string | null>(null);

    // Elegibilidade, chave de armazenamento e larguras salvas. Roda a cada render (leitura barata do DOM) porque as
    // colunas podem mudar (idioma, coluna oculta/exibida); só altera estado quando algo realmente muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sem lista de dependências de propósito (ver comentário acima)
    React.useLayoutEffect(() => {
      if (!resizable || !tableRef.current) return;
      const info = lerColunas(tableRef.current);
      if (!info) {
        if (eligible) setEligible(false);
        if (widthsRef.current) { widthsRef.current = null; setWidths(null); }
        return;
      }
      if (!eligible) setEligible(true);
      const key = `col-widths:${window.location.pathname}:${hashText(info.texts)}`;
      if (keyRef.current !== key) {
        keyRef.current = key;
        let saved: number[] | null = null;
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length === info.count && arr.every((n) => Number.isFinite(n) && n >= MIN_COL && n <= MAX_COL)) saved = arr;
          }
        } catch { /* sem armazenamento: usa o layout automático */ }
        widthsRef.current = saved;
        setWidths(saved);
      } else if (widthsRef.current && widthsRef.current.length !== info.count) {
        widthsRef.current = null;
        setWidths(null);
      }
    });

    const persist = React.useCallback(() => {
      const key = keyRef.current;
      const w = widthsRef.current;
      if (!key || !w) return;
      try { localStorage.setItem(key, JSON.stringify(w)); } catch { /* vale só na sessão */ }
    }, []);

    const reset = React.useCallback(() => {
      widthsRef.current = null;
      setWidths(null);
      const key = keyRef.current;
      if (key) { try { localStorage.removeItem(key); } catch { /* ignora */ } }
    }, []);

    const start = React.useCallback(
      (e: React.PointerEvent<HTMLElement>) => {
        const table = tableRef.current;
        const th = (e.currentTarget as HTMLElement).closest("th") as HTMLTableCellElement | null;
        if (!table || !th || !table.tHead) return;
        const info = lerColunas(table);
        if (!info) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = th.cellIndex;
        // Primeira vez: congela as larguras atuais (o layout não muda visualmente) e passa a layout fixo.
        if (!widthsRef.current) {
          const row = table.tHead.rows[table.tHead.rows.length - 1];
          const medidas = Array.from(row.cells).map((c) => Math.max(MIN_COL, Math.round(c.getBoundingClientRect().width)));
          widthsRef.current = medidas;
          setWidths(medidas);
        }
        const startX = e.clientX;
        const startW = widthsRef.current![idx];
        const move = (ev: PointerEvent) => {
          const next = Math.min(MAX_COL, Math.max(MIN_COL, Math.round(startW + ev.clientX - startX)));
          const cur = widthsRef.current!;
          if (cur[idx] === next) return;
          const copia = cur.slice();
          copia[idx] = next;
          widthsRef.current = copia; // síncrono: o pointerup salva o valor final
          setWidths(copia);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          document.body.style.userSelect = "";
          document.body.style.cursor = "";
          persist();
        };
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      },
      [persist],
    );

    const ctx = React.useMemo<TableResizeCtx>(() => ({ enabled: resizable && eligible, start, reset }), [resizable, eligible, start, reset]);
    const soma = widths ? widths.reduce((a, b) => a + b, 0) : 0;

    return (
      <TableResizeContext.Provider value={ctx}>
        <div className="relative w-full overflow-auto rounded-md border border-border/60">
          <table
            ref={setRefs}
            className={cn("w-full caption-bottom text-sm", widths && "table-fixed", className)}
            style={widths ? { ...style, width: "100%", minWidth: soma } : style}
            {...props}
          >
            {widths && (
              <colgroup data-auto-cols="">
                {/* A última coluna não recebe largura fixa: ela absorve a sobra, então arrastar qualquer outra coluna
                    muda só ela (1 para 1) e a tabela continua ocupando a página inteira. */}
                {widths.map((w, i) => (
                  <col key={i} style={i === widths.length - 1 ? undefined : { width: w }} />
                ))}
              </colgroup>
            )}
            {children}
          </table>
        </div>
      </TableResizeContext.Provider>
    );
  },
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("[&_tr]:border-b [&_tr]:border-border/60", className)} {...props} />
  ),
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t border-border/60 bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b border-border/60 transition-colors data-[state=selected]:bg-muted hover:bg-muted/50", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, children, ...props }, ref) => {
    const { enabled, start, reset } = React.useContext(TableResizeContext);
    return (
      <th
        ref={ref}
        className={cn(
          "relative h-12 px-4 text-left align-middle font-medium text-muted-foreground border-r border-border/60 last:border-r-0 [&:has([role=checkbox])]:pr-0",
          className,
        )}
        {...props}
      >
        {children}
        {enabled && (
          <span
            role="separator"
            aria-orientation="vertical"
            title="Arraste para ajustar a largura (duplo clique restaura)"
            onPointerDown={start}
            onDoubleClick={reset}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/30 [th:last-child_&]:hidden"
          />
        )}
      </th>
    );
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("p-4 align-middle border-r border-border/60 last:border-r-0 [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };

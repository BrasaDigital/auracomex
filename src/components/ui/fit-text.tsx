import * as React from "react";

/**
 * Texto que ENCOLHE a fonte para caber na largura disponível (em vez de quebrar a linha), entre `max` e `min` px.
 * Se mesmo no tamanho mínimo não couber, corta com "…" (o texto completo fica na dica ao passar o mouse).
 * Reage a mudanças de largura (ex.: o usuário arrasta a borda da coluna) e de conteúdo.
 */
export function FitText({
  children,
  max = 12,
  min = 9,
  className,
  title,
}: {
  children: React.ReactNode;
  max?: number;
  min?: number;
  className?: string;
  title?: string;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);

  const fit = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    let size = max;
    el.style.fontSize = `${size}px`;
    while (el.scrollWidth > el.clientWidth + 0.5 && size > min) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  }, [max, min]);

  React.useLayoutEffect(() => {
    fit();
  });

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const target = el.parentElement ?? el;
    const ro = new ResizeObserver(() => fit());
    ro.observe(target);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <span
      ref={ref}
      title={title}
      className={["inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap align-middle", className]
        .filter(Boolean)
        .join(" ")}
      style={{ fontSize: max }}
    >
      {children}
    </span>
  );
}

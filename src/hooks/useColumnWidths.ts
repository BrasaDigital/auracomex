import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Larguras de coluna ajustáveis arrastando a borda do cabeçalho. Fica salva no navegador de cada pessoa
 * (localStorage, mesmo padrão de useTableSort), sem banco de dados. Duplo clique na borda volta a coluna
 * ao padrão; `reset()` volta todas.
 */
export function useColumnWidths(storageKey: string, defaults: Record<string, number>, min = 56, max = 700) {
  const read = (): Record<string, number> => {
    const base = { ...defaults };
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return base;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      for (const k of Object.keys(defaults)) {
        const v = Number(saved?.[k]);
        if (Number.isFinite(v) && v >= min && v <= max) base[k] = v;
      }
    } catch { /* localStorage indisponível ou valor inválido: usa o padrão */ }
    return base;
  };

  const [widths, setWidths] = useState<Record<string, number>>(read);
  const widthsRef = useRef(widths);
  useEffect(() => { widthsRef.current = widths; }, [widths]);

  const persist = useCallback((w: Record<string, number>) => {
    try { localStorage.setItem(storageKey, JSON.stringify(w)); } catch { /* sem armazenamento: só vale na sessão */ }
  }, [storageKey]);

  /** Use no onPointerDown da alça de redimensionar da coluna `key`. */
  const startResize = useCallback((key: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthsRef.current[key] ?? defaults[key] ?? 100;
    const move = (ev: PointerEvent) => {
      const next = Math.min(max, Math.max(min, Math.round(startW + ev.clientX - startX)));
      setWidths(prev => (prev[key] === next ? prev : { ...prev, [key]: next }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      persist(widthsRef.current);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist, min, max]);

  const resetOne = useCallback((key: string) => {
    setWidths(prev => {
      const next = { ...prev, [key]: defaults[key] };
      persist(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  const reset = useCallback(() => {
    setWidths({ ...defaults });
    try { localStorage.removeItem(storageKey); } catch { /* ignora */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const isCustom = Object.keys(defaults).some(k => widths[k] !== defaults[k]);

  return { widths, startResize, resetOne, reset, isCustom };
}

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useColumnWidths } from '@/hooks/useColumnWidths';

const KEY = 'teste-col-widths';
const DEFAULTS = { a: 100, b: 200 };

function pointerEvent(type: string, clientX: number) {
  const ev = new Event(type) as any;
  ev.clientX = clientX;
  return ev as PointerEvent;
}

function arrastar(result: any, col: string, de: number, ate: number) {
  act(() => {
    result.current.startResize(col)({ preventDefault() {}, stopPropagation() {}, clientX: de } as any);
  });
  act(() => { window.dispatchEvent(pointerEvent('pointermove', ate)); });
  act(() => { window.dispatchEvent(pointerEvent('pointerup', ate)); });
}

describe('useColumnWidths', () => {
  beforeEach(() => localStorage.clear());

  it('começa nos valores padrão', () => {
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS));
    expect(result.current.widths).toEqual(DEFAULTS);
    expect(result.current.isCustom).toBe(false);
  });

  it('arrastar muda a largura e salva no navegador', () => {
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS));
    arrastar(result, 'a', 100, 160);
    expect(result.current.widths.a).toBe(160);
    expect(result.current.widths.b).toBe(200);
    expect(result.current.isCustom).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY) as string).a).toBe(160);
  });

  it('respeita o mínimo e o máximo', () => {
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS, 60, 300));
    arrastar(result, 'a', 100, -500);
    expect(result.current.widths.a).toBe(60);
    arrastar(result, 'b', 0, 5000);
    expect(result.current.widths.b).toBe(300);
  });

  it('recarrega o que foi salvo e ignora valor inválido', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 250, b: 'x' }));
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS));
    expect(result.current.widths).toEqual({ a: 250, b: 200 });
  });

  it('resetOne e reset voltam ao padrão', () => {
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS));
    arrastar(result, 'a', 100, 180);
    arrastar(result, 'b', 200, 120);
    act(() => result.current.resetOne('a'));
    expect(result.current.widths.a).toBe(100);
    expect(result.current.widths.b).toBe(120);
    act(() => result.current.reset());
    expect(result.current.widths).toEqual(DEFAULTS);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

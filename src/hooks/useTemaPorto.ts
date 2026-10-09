import { useSyncExternalStore } from 'react';

/**
 * Interruptor do "visual Porto" (versão de teste do app depois do login).
 *
 * O estado fica no navegador de cada pessoa (localStorage), sem banco de dados:
 * quem liga vê o visual novo, quem não liga continua com o atual. Desligado é o
 * padrão. A classe `tema-porto` no <html> é o que troca as cores e as fontes
 * (ver src/styles/tema-porto.css); o layout novo é escolhido pelos componentes
 * que leem este hook.
 */
const CHAVE = 'aura:tema-porto';
const CLASSE = 'tema-porto';
const EVENTO = 'aura:tema-porto-mudou';

function ler(): boolean {
  try {
    return localStorage.getItem(CHAVE) === '1';
  } catch {
    return false;
  }
}

function aplicarClasse(ativo: boolean) {
  document.documentElement.classList.toggle(CLASSE, ativo);
}

/** Chamado uma vez em main.tsx, antes de renderizar, para não piscar o visual antigo. */
export function iniciarTemaPorto() {
  aplicarClasse(ler());
}

export function definirTemaPorto(ativo: boolean) {
  try {
    localStorage.setItem(CHAVE, ativo ? '1' : '0');
  } catch {
    // navegador sem localStorage (janela privada restrita): vale só até recarregar
  }
  aplicarClasse(ativo);
  window.dispatchEvent(new Event(EVENTO));
}

function assinar(avisar: () => void) {
  window.addEventListener(EVENTO, avisar);
  window.addEventListener('storage', avisar);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener('storage', avisar);
  };
}

export function useTemaPorto() {
  const ativo = useSyncExternalStore(assinar, ler, () => false);
  return { ativo, definir: definirTemaPorto, alternar: () => definirTemaPorto(!ler()) };
}

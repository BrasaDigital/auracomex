import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Avisa quando saiu um deploy novo enquanto a aba continua aberta com o JavaScript antigo.
 * (SPA não recarrega sozinha: a aba velha segue rodando o código antigo — ex.: bugs já corrigidos
 * continuavam acontecendo.) Compara o bundle principal carregado (/assets/index-<hash>.js) com o do
 * index.html atual; se diferir, mostra um aviso fixo com botão "Atualizar". Em dev não faz nada.
 */
const BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

export function useNewVersionCheck(intervalMs = 60_000) {
  useEffect(() => {
    const loaded = Array.from(document.scripts).map((s) => s.src).find((src) => BUNDLE_RE.test(src));
    const loadedPath = loaded?.match(BUNDLE_RE)?.[0];
    if (!loadedPath) return; // dev server ou build fora do padrão

    let shown = false;
    const check = async () => {
      if (shown || document.hidden) return;
      try {
        const res = await fetch('/', { cache: 'no-store' });
        if (!res.ok) return;
        const latest = (await res.text()).match(BUNDLE_RE)?.[0];
        if (latest && latest !== loadedPath) {
          shown = true;
          toast('Nova versão do Aura disponível', {
            description: 'Atualize para não trabalhar com uma versão antiga (pode haver erros já corrigidos).',
            duration: Infinity,
            action: { label: 'Atualizar', onClick: () => window.location.reload() },
          });
        }
      } catch {
        /* offline / falha de rede: tenta de novo no próximo ciclo */
      }
    };

    const id = window.setInterval(check, intervalMs);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', check);
    };
  }, [intervalMs]);
}

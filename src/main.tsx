import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./styles/tema-porto.css";
import { iniciarTemaPorto } from "./hooks/useTemaPorto";
// SVG country flags (bundled as CSS classes). Used instead of emoji flags
// because Windows/Chrome doesn't render flag emoji glyphs — it shows the
// 2-letter code or nothing at all. These are actual images, so they render
// the same on every OS/browser.
import "flag-icons/css/flag-icons.min.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Recuperação automática de "chunk stale" pós-deploy: a app faz deploy várias
// vezes ao dia (auto-deploy no push pro main) e os arquivos JS têm hash no
// nome (ex. html2pdf-C8jWW4i3.js) — se o usuário mantém a aba aberta durante
// um deploy e depois clica em algo que carrega um chunk sob demanda (import()
// dinâmico, ex. abrir um PDF), o navegador tenta buscar o arquivo do build
// antigo, que não existe mais no Vercel, e cai em "Failed to fetch
// dynamically imported module". O Vite emite o evento "vite:preloadError"
// nesse caso — recarrega a página uma vez (sessionStorage evita loop se o
// reload não resolver) pra pegar o index.html novo, com os hashes corretos.
window.addEventListener('vite:preloadError', () => {
  const key = 'aura:reloaded-after-preload-error';
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  window.location.reload();
});

// Visual Porto (versão de teste): aplica a classe antes de renderizar, sem piscar.
iniciarTemaPorto();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Chegou até aqui = essa carga da página deu certo. Limpa a flag pra um
// futuro preload error (próximo deploy) poder disparar outro reload
// automático, em vez de ficar "gasto" pro resto da sessão da aba.
sessionStorage.removeItem('aura:reloaded-after-preload-error');

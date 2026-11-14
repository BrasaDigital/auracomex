import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface LegalLayoutProps {
  title: string;
  updatedAt: string;
  children: ReactNode;
}

export function LegalLayout({ title, updatedAt, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-[hsl(240,17%,5%)] text-[hsl(240,11%,89%)]">
      <nav className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-[hsl(240,17%,5%)]/80 border-b border-[hsl(240,13%,16%)]">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/landing" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-[hsl(213,100%,50%)] transition-colors">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
          <div className="flex flex-col items-end">
            <span className="text-lg font-bold tracking-tight">
              <span className="text-[hsl(213,100%,50%)]">Aura</span> Comex
            </span>
            <span className="text-[10px] text-muted-foreground -mt-1">by Kenaro Soluções</span>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 pt-28 pb-24">
        <header className="mb-10 border-b border-[hsl(240,13%,16%)] pb-8">
          <h1 className="text-3xl md:text-4xl font-extrabold mb-3">{title}</h1>
          <p className="text-sm text-muted-foreground">Última atualização: {updatedAt}</p>
        </header>

        <article className="prose prose-invert max-w-none space-y-6 text-[hsl(240,11%,82%)] leading-relaxed
          [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-[hsl(240,11%,95%)] [&_h2]:mt-10 [&_h2]:mb-4
          [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[hsl(240,11%,92%)] [&_h3]:mt-6 [&_h3]:mb-2
          [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:mb-4
          [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:mb-4
          [&_a]:text-[hsl(213,100%,58%)] [&_a]:underline hover:[&_a]:text-[hsl(213,100%,70%)]
          [&_strong]:text-[hsl(240,11%,95%)]">
          {children}
        </article>

        <footer className="mt-16 pt-8 border-t border-[hsl(240,13%,16%)] text-sm text-muted-foreground">
          <p>
            Dúvidas? Fale com nosso Encarregado de Dados (DPO):{" "}
            <a href="mailto:contato@auracomex.app" className="text-[hsl(213,100%,58%)] hover:underline">
              contato@auracomex.app
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
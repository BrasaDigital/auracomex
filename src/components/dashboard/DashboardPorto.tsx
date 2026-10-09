import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Painel no "visual Porto" (versão de teste). Só apresenta: todos os dados e
 * permissões vêm de pages/Index.tsx, que é quem consulta o banco.
 */
export interface DashboardPortoProps {
  fechamentos: number;
  referencias: number;
  emAndamento: number;
  podeCotacoes: boolean;
  podeEmbarques: boolean;
  podeFinanceiro: boolean;
  cotacoesAtrasadas: { id: string; quote_number?: string | null; valid_until: string; clients?: { name?: string } | null }[];
  embarquesAtencao: { id: string; reference_number?: string | null; next_update: string; clients?: { name?: string } | null }[];
  aReceber: Record<string, number>;
  aPagar: Record<string, number>;
  graficos: ReactNode;
}

const dinheiro = (v: number, moeda: string) =>
  `${moeda} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const data = (d: string) => new Date(d).toLocaleDateString('pt-BR');

function Numero({ rotulo, valor, className }: { rotulo: string; valor: number; className?: string }) {
  return (
    <div className={cn('px-5 py-4', className)}>
      <p className="text-sm text-muted-foreground">{rotulo}</p>
      <p className="porto-display text-6xl font-extrabold leading-none mt-2 tabular-nums">{valor}</p>
    </div>
  );
}

function Bloco({
  titulo, verTodos, para, tom, children,
}: { titulo: string; verTodos: string; para: string; tom: 'ferrugem' | 'ambar'; children: ReactNode }) {
  return (
    <section className="bg-card border border-border">
      <header className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h2 className="flex items-center gap-2.5 porto-display text-xl font-bold uppercase tracking-wide">
          <span aria-hidden className={cn('w-1.5 h-5', tom === 'ferrugem' ? 'bg-destructive' : 'bg-status-attention')} />
          {titulo}
        </h2>
        <Link to={para} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
          {verTodos} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="px-5 py-4 text-sm text-muted-foreground">{texto}</p>;
}

function Linha({ para, titulo, detalhe }: { para: string; titulo: string; detalhe: string }) {
  return (
    <Link to={para} className="flex items-baseline justify-between gap-4 px-5 py-3 hover:bg-secondary/60 transition-colors">
      <span className="text-sm font-medium truncate">{titulo}</span>
      <span className="text-sm text-destructive shrink-0 tabular-nums">{detalhe}</span>
    </Link>
  );
}

export function DashboardPorto(p: DashboardPortoProps) {
  const temReceber = Object.keys(p.aReceber).length > 0;
  const temPagar = Object.keys(p.aPagar).length > 0;
  return (
    <div className="space-y-6">
      {/* Números do mês: um painel só, três células */}
      <div className="grid grid-cols-1 sm:grid-cols-3 bg-card border border-border divide-y sm:divide-y-0 sm:divide-x divide-border">
        <Numero rotulo="Fechamentos neste mês" valor={p.fechamentos} />
        <Numero rotulo="Referências neste mês" valor={p.referencias} />
        <Numero rotulo="Embarques em andamento" valor={p.emAndamento} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] gap-6 items-start">
        <div className="space-y-6">
          {p.podeEmbarques && (
            <Bloco titulo="Embarques sem atualização" verTodos="Ver todos" para="/shipments" tom="ferrugem">
              {p.embarquesAtencao.length === 0 ? (
                <Vazio texto="Tudo em dia." />
              ) : (
                p.embarquesAtencao.map((s) => (
                  <Linha
                    key={s.id}
                    para="/shipments"
                    titulo={`${s.reference_number || '—'} · ${s.clients?.name || '-'}`}
                    detalhe={`desde ${data(s.next_update)}`}
                  />
                ))
              )}
            </Bloco>
          )}

          {p.podeCotacoes && (
            <Bloco titulo="Cotações vencidas" verTodos="Ver todas" para="/quotes" tom="ambar">
              {p.cotacoesAtrasadas.length === 0 ? (
                <Vazio texto="Nenhuma cotação vencida." />
              ) : (
                p.cotacoesAtrasadas.map((q) => (
                  <Linha
                    key={q.id}
                    para="/quotes"
                    titulo={`${q.quote_number || '—'} · ${q.clients?.name || '-'}`}
                    detalhe={`venceu em ${data(q.valid_until)}`}
                  />
                ))
              )}
            </Bloco>
          )}

          {p.podeFinanceiro && (
            <Bloco titulo="Financeiro vencido" verTodos="Ver tudo" para="/financial/processo" tom="ferrugem">
              {!temReceber && !temPagar ? (
                <Vazio texto="Nada vencido." />
              ) : (
                <>
                  {temReceber && (
                    <div className="px-5 py-3">
                      <p className="text-sm font-medium text-status-completed">A receber</p>
                      {Object.entries(p.aReceber).map(([m, v]) => (
                        <p key={m} className="text-sm tabular-nums">{dinheiro(v, m)}</p>
                      ))}
                    </div>
                  )}
                  {temPagar && (
                    <div className="px-5 py-3">
                      <p className="text-sm font-medium text-destructive">A pagar</p>
                      {Object.entries(p.aPagar).map(([m, v]) => (
                        <p key={m} className="text-sm tabular-nums">{dinheiro(v, m)}</p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Bloco>
          )}
        </div>

        {p.podeEmbarques && <div>{p.graficos}</div>}
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ShieldCheck, Info, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { calcSeguroInternacional } from '@/lib/costEstimate';
import { calcTotalCargoValueUsd, CargoValueLike } from '@/lib/cargoValue';

interface QuotePartnerLike {
  client_id?: string | null;
  clients?: { id?: string; name?: string; partner_category?: string | null; insurance_rate_pct?: number | null } | null;
}

interface AutoChargeRow {
  id: string;
  buy_amount: number;
  sell_amount: number;
  partner_id: string | null;
}

interface Props {
  quoteId: string;
  companyId?: string;
  quote: { id: string; client_id?: string | null; seguro_auto?: boolean | null } | null | undefined;
  quotePartners?: QuotePartnerLike[];
  /** Itens da aba Resumo da Carga — Custo do seguro vem daqui (soma do Valor da Carga em USD). */
  cargoItems?: CargoValueLike[];
  readOnly?: boolean;
}

function fmtUSD(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Card "Seguro Internacional" da aba Taxas.
 *
 * A taxa NÃO é editável aqui — ela vem do cadastro da Seguradora (Cadastros >
 * Parceiros, categoria "Seguradora") vinculada ao processo na aba Parceiros.
 * Sem seguradora vinculada, cai no padrão da empresa (Configurações >
 * Empresa). O valor calculado só passa a compor o processo (viram DUAS taxas
 * reais em quote_charges — uma de Compra com a Seguradora como parceiro, uma
 * de Venda com o Cliente do processo — contabilizadas no total e na
 * Estimativa de Custo) quando o checkbox "Incluir no processo" está
 * marcado. Desmarcando, as duas taxas são removidas.
 */
export function AutoInsuranceCard({ quoteId, companyId, quote, quotePartners = [], cargoItems = [], readOnly }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  // Override local do checkbox — a FONTE DA VERDADE pro gate do efeito de
  // sincronização abaixo, em vez de `quote?.seguro_auto` vindo do cache do
  // React Query. Setado de forma síncrona no clique (handleToggle), antes
  // de qualquer chamada ao banco: garante que o efeito de sincronização
  // "veja" o desmarque na hora, sem depender do timing de nenhum
  // refetch/invalidate — eliminando de vez a corrida em que a taxa era
  // apagada e, no mesmo instante, recriada pelo efeito com o valor antigo
  // de `auto` ainda em cache. Reseta pra null (segue o servidor) sempre
  // que o usuário troca de processo.
  const [localAuto, setLocalAuto] = useState<boolean | null>(null);
  useEffect(() => { setLocalAuto(null); }, [quoteId]);

  // Frete Internacional ainda vem da Estimativa de Custo — Custo vem da carga
  // (abaixo) e Impostos é derivado de Custo+Frete (ver calcSeguroInternacional).
  const { data: basis } = useQuery({
    queryKey: ['cost-estimate-insurance-basis', quoteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cost_estimates')
        .select('frete_intl_usd')
        .eq('quote_id', quoteId)
        .maybeSingle();
      if (error) throw error;
      return data as { frete_intl_usd: number } | null;
    },
    enabled: !!quoteId,
  });

  // Custo = Valor Total da Carga (aba Resumo da Carga), somado em USD — não
  // depende mais de uma Estimativa de Custo existir.
  const { totalUsd: custoCargaUsd, hasNonUsd: cargaTemOutraMoeda } = useMemo(
    () => calcTotalCargoValueUsd(cargoItems),
    [cargoItems]
  );

  // Taxas automáticas já lançadas no processo — pode haver até 2 linhas
  // (Compra com a Seguradora, Venda com o Cliente).
  const { data: autoCharges = [], isFetched: chargesFetched } = useQuery({
    queryKey: ['quote-charge-auto-insurance', quoteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('quote_charges')
        .select('id, buy_amount, sell_amount, partner_id')
        .eq('quote_id', quoteId)
        .eq('is_auto_insurance', true);
      if (error) throw error;
      return (data || []) as AutoChargeRow[];
    },
    enabled: !!quoteId,
  });

  const buyCharge = useMemo(() => autoCharges.find((c) => Number(c.buy_amount) > 0) || null, [autoCharges]);
  const sellCharge = useMemo(() => autoCharges.find((c) => Number(c.sell_amount) > 0) || null, [autoCharges]);

  // Seguradora vinculada ao processo (aba Parceiros) — mesma fonte usada pra
  // Cia Aérea/Armador no Cabeçalho da Estimativa. É o parceiro da Compra.
  const insurer = useMemo(
    () => quotePartners.find((qp) => qp.clients?.partner_category === 'insurance') || null,
    [quotePartners]
  );
  const insurerClientId = insurer?.clients?.id || null;
  // Cliente do processo — é o parceiro da Venda.
  const sellClientId = quote?.client_id || null;

  // Sem seguradora vinculada, cai no padrão cadastrado na empresa.
  const { data: companyDefault } = useQuery({
    queryKey: ['company-seguro-taxa-default', companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await (supabase as any)
        .from('companies')
        .select('seguro_taxa_pct_default')
        .eq('id', companyId)
        .maybeSingle();
      if (error) throw error;
      return data as { seguro_taxa_pct_default: number } | null;
    },
    enabled: !!companyId && !insurer,
  });

  const insurerRate = insurer?.clients?.insurance_rate_pct;
  const taxaResolved = insurerRate != null
    ? Number(insurerRate)
    : (companyDefault?.seguro_taxa_pct_default != null ? Number(companyDefault.seguro_taxa_pct_default) : null);
  const taxaSourceLabel = insurerRate != null
    ? `Seguradora: ${insurer?.clients?.name || 'sem nome'}`
    : (taxaResolved != null ? 'Padrão da empresa (nenhuma seguradora vinculada ao processo)' : null);

  const hasRate = taxaResolved != null;
  const taxaPct = taxaResolved ?? 0;
  // `localAuto` manda enquanto não for resetado (troca de processo) — só cai
  // pro valor vindo do servidor/cache quando ainda não houve clique local.
  const auto = localAuto !== null ? localAuto : quote?.seguro_auto === true; // seguro nasce desmarcado; só liga quando o usuário marca

  const breakdown = useMemo(() => calcSeguroInternacional({
    custoUsd: custoCargaUsd,
    freteUsd: Number(basis?.frete_intl_usd || 0),
    taxaPct,
  }), [custoCargaUsd, basis, taxaPct]);

  const hasBasis = breakdown.custo > 0 || breakdown.frete > 0;
  const canCalc = hasBasis && hasRate;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['quote-charge-auto-insurance', quoteId] });
    qc.invalidateQueries({ queryKey: ['quote-charges', quoteId] });
    qc.invalidateQueries({ queryKey: ['quote-detail', quoteId] });
    qc.invalidateQueries({ queryKey: ['cost-estimate', quoteId] });
  };

  // Mantém as duas taxas automáticas (Compra com a Seguradora, Venda com o
  // Cliente) sincronizadas com o valor calculado e com os parceiros certos
  // sempre que o checkbox estiver marcado (ex.: mudou o câmbio, o frete, a
  // seguradora ou o cliente do processo etc.).
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    // Espera a consulta das taxas automáticas já existentes terminar de
    // carregar antes de decidir se insere ou atualiza. Sem isso, a CADA
    // remount do card (ex.: F5 na página, troca de aba e volta) o hook
    // começa com `autoCharges=[]` (valor padrão enquanto a query ainda não
    // resolveu) — o efeito lia isso como "não existe taxa nenhuma ainda" e
    // inseria um par novo de Compra/Venda antes da consulta real chegar,
    // duplicando a taxa a cada recarregamento da tela.
    if (!chargesFetched) return;
    if (!auto || !canCalc || readOnly || !companyId) return;
    const key = `${buyCharge?.id || ''}:${sellCharge?.id || ''}:${breakdown.valorSeguro}:${insurerClientId || ''}:${sellClientId || ''}`;
    if (syncedRef.current === key) return;

    const buyOk = buyCharge
      && Number(buyCharge.buy_amount) === breakdown.valorSeguro
      && (buyCharge.partner_id || null) === insurerClientId;
    const sellOk = sellCharge
      && Number(sellCharge.sell_amount) === breakdown.valorSeguro
      && (sellCharge.partner_id || null) === sellClientId;
    if (buyOk && sellOk) {
      syncedRef.current = key;
      return;
    }
    syncedRef.current = key;
    (async () => {
      const baseRow = {
        quote_id: quoteId,
        company_id: companyId,
        description: 'SEGURO INTERNACIONAL (CÁLCULO AUTOMÁTICO)',
        charge_type: 'freight',
        leg: 'freight',
        currency: 'USD',
        billing_unit: 'fixed',
        is_auto_insurance: true,
      };
      const ops: Promise<any>[] = [];
      if (buyCharge) {
        ops.push((supabase as any).from('quote_charges')
          .update({ buy_amount: breakdown.valorSeguro, sell_amount: 0, partner_id: insurerClientId })
          .eq('id', buyCharge.id));
      } else {
        ops.push((supabase as any).from('quote_charges').insert({
          ...baseRow, buy_amount: breakdown.valorSeguro, sell_amount: 0, partner_id: insurerClientId,
        }));
      }
      if (sellCharge) {
        ops.push((supabase as any).from('quote_charges')
          .update({ sell_amount: breakdown.valorSeguro, buy_amount: 0, partner_id: sellClientId })
          .eq('id', sellCharge.id));
      } else {
        ops.push((supabase as any).from('quote_charges').insert({
          ...baseRow, sell_amount: breakdown.valorSeguro, buy_amount: 0, partner_id: sellClientId,
        }));
      }
      await Promise.all(ops);
      invalidateAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargesFetched, auto, canCalc, readOnly, breakdown.valorSeguro, buyCharge?.id, sellCharge?.id, insurerClientId, sellClientId, companyId]);

  const handleToggle = async (checked: boolean) => {
    if (readOnly) return;
    // Seta o override local ANTES de qualquer await: o efeito de sincronização
    // acima passa a ler `auto=false` já no próximo render, então não existe
    // mais janela de tempo em que ele possa recriar a(s) taxa(s) recém
    // apagada(s) com base num `quote?.seguro_auto` do cache ainda desatualizado.
    setLocalAuto(checked);
    try {
      const { error: qErr } = await (supabase as any).from('quotes').update({ seguro_auto: checked }).eq('id', quoteId);
      if (qErr) throw qErr;

      if (!checked) {
        // Apaga as duas linhas (Compra e Venda) pela combinação
        // quote_id + is_auto_insurance direto no banco — NÃO depende do
        // que já está carregado no cache local. Antes, se o usuário
        // desmarcasse antes dessa consulta terminar (ou em qualquer
        // situação em que o cache estivesse desatualizado), a exclusão
        // podia ser pulada e a(s) taxa(s) ficavam órfãs: o processo
        // marcado como "sem seguro" mas as taxas continuavam lançadas.
        const { data: deleted, error: delErr } = await (supabase as any)
          .from('quote_charges')
          .delete()
          .eq('quote_id', quoteId)
          .eq('is_auto_insurance', true)
          .select('id');
        if (delErr) throw delErr;
        // Remove na hora do cache das duas listas que alimentam a tela —
        // sem isso a linha de Compra/Venda podia continuar visível na aba
        // Taxas até o próximo refetch em segundo plano terminar.
        qc.setQueryData(['quote-charge-auto-insurance', quoteId], []);
        qc.setQueryData(['quote-charges', quoteId], (old: any[] | undefined) =>
          old ? old.filter((c) => !c.is_auto_insurance) : old
        );
        if (!deleted || deleted.length === 0) {
          console.warn('Nenhuma taxa de seguro automática foi encontrada/apagada para este processo.');
        }
      }
      // Reflete o novo seguro_auto no cache do quote-detail imediatamente,
      // pelo mesmo motivo acima (evita o efeito ler um valor desatualizado).
      qc.setQueryData(['quote-detail', quoteId], (old: any) => (old ? { ...old, seguro_auto: checked } : old));

      invalidateAll();
      toast.success(checked ? 'Seguro incluído no processo (compra e venda).' : 'Seguro removido do processo.');
    } catch (err: any) {
      setLocalAuto(!checked); // reverte o override local em caso de falha
      toast.error(err.message || 'Erro ao atualizar o seguro do processo.');
    }
  };

  const canExpand = hasRate && hasBasis;

  return (
    <Card className="glass border-primary/20">
      <CardHeader className="h-9 py-0 flex flex-row items-center justify-between space-y-0 flex-nowrap gap-2">
        <button
          type="button"
          onClick={() => canExpand && setExpanded((e) => !e)}
          disabled={!canExpand}
          className={cn('flex items-center gap-2 text-left', canExpand ? 'cursor-pointer' : 'cursor-default')}
        >
          {canExpand && (
            <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform shrink-0', expanded && 'rotate-180')} />
          )}
          <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          <CardTitle className="text-sm font-medium">Seguro Internacional</CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info
                  className="w-3.5 h-3.5 text-muted-foreground cursor-help"
                  onClick={(e) => e.stopPropagation()}
                />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Calculado automaticamente: (Custo + Frete + 10% Despesas + 10% Lucro Esperado + Impostos) x Taxa da seguradora
                vinculada ao processo (aba Parceiros). Impostos = (Custo + Frete) x 0,5. Gera uma taxa de Compra com a
                Seguradora e uma de Venda com o Cliente. Marque para incluir no processo — desmarcar remove as duas.
                Clique na seta para ver o detalhamento.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {canExpand && (
            <span className="text-xs text-muted-foreground font-mono ml-1">US$ {fmtUSD(breakdown.valorSeguro)}</span>
          )}
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center">
              <Checkbox
                id={`seguro-auto-${quoteId}`}
                checked={auto}
                disabled={readOnly || !hasRate}
                onCheckedChange={(c) => handleToggle(!!c)}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent className="text-xs">Incluir no processo</TooltipContent>
        </Tooltip>
      </CardHeader>
      {!hasRate ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground italic py-2">
            Nenhuma taxa de seguro disponível. Vincule uma Seguradora ao processo na aba Parceiros (Cadastros &gt; Parceiros,
            categoria "Seguradora", com a Taxa de Seguro preenchida) ou defina uma taxa padrão em Configurações &gt; Empresa.
          </p>
        </CardContent>
      ) : !hasBasis ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground italic py-2">
            Informe o Valor da Carga (em USD) na aba Resumo da Carga para calcular o seguro automaticamente.
          </p>
        </CardContent>
      ) : expanded ? (
        <CardContent className="pt-0">
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground block">Custo</span>
                <span className="font-mono">US$ {fmtUSD(breakdown.custo)}</span>
                {cargaTemOutraMoeda && <span className="text-amber-600 text-[10px] block">* há itens de carga em outra moeda, não somados</span>}
              </div>
              <div><span className="text-muted-foreground block">Frete</span><span className="font-mono">US$ {fmtUSD(breakdown.frete)}</span></div>
              <div><span className="text-muted-foreground block">Despesas (10%)</span><span className="font-mono">US$ {fmtUSD(breakdown.despesas)}</span></div>
              <div><span className="text-muted-foreground block">Lucro Esperado (10%)</span><span className="font-mono">US$ {fmtUSD(breakdown.lucroEsperado)}</span></div>
              <div><span className="text-muted-foreground block">Impostos</span><span className="font-mono">US$ {fmtUSD(breakdown.impostos)}</span></div>
              <div><span className="text-muted-foreground block">Soma das Verbas</span><span className="font-mono">US$ {fmtUSD(breakdown.somaVerbas)}</span></div>
              <div>
                <span className="text-muted-foreground block">Taxa (fixa)</span>
                <span className="font-mono">{taxaPct.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%</span>
              </div>
              <div className="rounded-md bg-primary/5 px-2 py-1 flex flex-col justify-center">
                <span className="text-muted-foreground block">Valor do Seguro</span>
                <span className="font-mono font-bold text-primary">US$ {fmtUSD(breakdown.valorSeguro)}</span>
              </div>
            </div>
            {!insurerClientId && (
              <p className="text-[10px] text-amber-600 italic">
                Sem Seguradora vinculada na aba Parceiros — a taxa de Compra fica sem parceiro definido.
              </p>
            )}
            {!sellClientId && (
              <p className="text-[10px] text-amber-600 italic">
                Processo sem Cliente definido — a taxa de Venda fica sem parceiro definido.
              </p>
            )}
            {taxaSourceLabel && (
              <p className="text-[10px] text-muted-foreground italic">{taxaSourceLabel}</p>
            )}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
